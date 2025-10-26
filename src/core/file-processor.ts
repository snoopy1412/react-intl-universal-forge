// @ts-nocheck
/**
 * 文件转换处理器
 */

import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import * as t from '@babel/types'
import fs from 'node:fs'

import { getConfig } from '../config/index.js'
import { generateKey } from './key-generator.js'
import { generateAIKeysBatch, buildSafeFallbackKey } from './ai-key-generator.js'
import { identifyTextType } from './common-utils.js'
import {
  parseTemplateLiteral,
  createIntlGetCallExpression,
  shouldSkipNode,
  getFunctionName,
  shouldSkipFunctionCall,
  getObjectPropertyKey,
  extractValue,
  isIntlGetCall,
  buildTemplateLiteralFromBinaryExpression
} from './ast-utils.js'

const traverseFn: typeof traverse = (traverse as unknown as { default?: typeof traverse }).default ?? traverse
const generateFn: typeof generate = (generate as unknown as { default?: typeof generate }).default ?? (generate as unknown as typeof generate)

// 中文正则
const CHINESE_REGEX = /[\u4e00-\u9fa5]/

const SAMPLE_NODE_TYPES = {
  STRING_LITERAL: 'string-literal',
  TEMPLATE_LITERAL: 'template-literal',
  JSX_TEXT: 'jsx-text'
}

function getNodeLocation(node) {
  const line = node?.loc?.start?.line
  const column = node?.loc?.start?.column
  return {
    line: typeof line === 'number' ? line : null,
    column: typeof column === 'number' ? column : null
  }
}

function buildSampleKey(node, nodeType, text) {
  const { line, column } = getNodeLocation(node)
  const safeLine = line ?? -1
  const safeColumn = column ?? -1
  return `${nodeType}:${safeLine}:${safeColumn}:${text}`
}

function normalizeJSXTextContent(value = '') {
  return value.replace(/\r?\n\s*/g, '')
}

function buildTemplateExpressionFromGroup(group) {
  let buffer = ''
  const quasis = []
  const expressions = []

  const pushQuasi = (text) => {
    quasis.push(
      t.templateElement({
        raw: text,
        cooked: text
      })
    )
  }

  group.forEach((item) => {
    if (item.type === 'text') {
      buffer += item.value
    } else if (item.type === 'expression') {
      pushQuasi(buffer)
      buffer = ''
      expressions.push(t.cloneNode(item.expression, true))
    }
  })

  pushQuasi(buffer)

  return t.jsxExpressionContainer(t.templateLiteral(quasis, expressions))
}

function mergeJSXTextWithExpressions(ast) {
  traverseFn(ast, {
    JSXElement(path) {
      path.node.children = mergeChildren(path.node.children)
    },
    JSXFragment(path) {
      path.node.children = mergeChildren(path.node.children)
    }
  })
}

function fileContainsJSX(ast) {
  let hasJSX = false

  traverseFn(ast, {
    JSXElement(path) {
      hasJSX = true
      path.stop()
    },
    JSXFragment(path) {
      hasJSX = true
      path.stop()
    }
  })

  return hasJSX
}

function mergeChildren(children) {
  if (!Array.isArray(children) || children.length === 0) {
    return children
  }

  const newChildren = []
  let index = 0

  while (index < children.length) {
    const child = children[index]

    const isText = t.isJSXText(child)
    const isExpression =
      t.isJSXExpressionContainer(child) &&
      !t.isJSXEmptyExpression(child.expression)

    if (!isText && !isExpression) {
      newChildren.push(child)
      index += 1
      continue
    }

    const group = []
    let cursor = index
    let hasChinese = false
    let hasExpression = false

    while (cursor < children.length) {
      const current = children[cursor]

      if (t.isJSXText(current)) {
        const normalized = normalizeJSXTextContent(current.value)
        group.push({ type: 'text', value: normalized })
        if (normalized && CHINESE_REGEX.test(normalized)) {
          hasChinese = true
        }
        cursor += 1
        continue
      }

      if (
        t.isJSXExpressionContainer(current) &&
        !t.isJSXEmptyExpression(current.expression)
      ) {
        group.push({ type: 'expression', expression: current.expression })
        hasExpression = true
        cursor += 1
        continue
      }

      break
    }

    const hasMeaningfulText = group.some(
      (item) => item.type === 'text' && item.value.trim().length > 0
    )

    if (hasChinese && hasExpression && hasMeaningfulText) {
      newChildren.push(buildTemplateExpressionFromGroup(group))
      index = cursor
    } else {
      newChildren.push(child)
      index += 1
    }
  }

  return newChildren
}

/**
 * 更新导入状态和统计信息
 * @param {string} fileType - 文件类型
 * @param {Object} flags - 标志对象 { needsIntlImport }
 * @param {Object} stats - 统计对象
 */
function updateImportStats(_fileType, flags, stats) {
  flags.needsIntlImport = true
  stats.extracted++
}

function isInsideRuntimeScope(path) {
  return Boolean(
    path.findParent(
      (p) =>
        p.isFunctionDeclaration() ||
        p.isFunctionExpression() ||
        p.isArrowFunctionExpression() ||
        p.isObjectMethod() ||
        p.isClassMethod() ||
        p.isClassPrivateMethod?.()
    )
  )
}

function getSkippedFunctionForPath(path, config) {
  const callParent = path.findParent((p) => p.isCallExpression() || p.isOptionalCallExpression())
  if (!callParent) return null

  const funcName = getFunctionName(callParent.node.callee)
  if (!shouldSkipFunctionCall(funcName, config)) {
    return null
  }

  let current = path
  while (current && current !== callParent) {
    if (current.parentPath === callParent && current.listKey === 'arguments') {
      return funcName || 'anonymous'
    }
    current = current.parentPath
  }

  return null
}

function createLazyGetterFromProperty(prop, returnExpression) {
  const keyNode = t.cloneNode(prop.key)
  const getter = t.objectMethod('get', keyNode, [], t.blockStatement([t.returnStatement(returnExpression)]))

  getter.computed = prop.computed
  getter.async = false
  getter.generator = false

  if (prop.leadingComments) {
    getter.leadingComments = prop.leadingComments
  }
  if (prop.trailingComments) {
    getter.trailingComments = prop.trailingComments
  }

  return getter
}

/**
 * 从文件路径推断上下文
 * @param {string} filePath - 文件路径
 * @returns {string} 推断的上下文名称
 */
export function inferContext(filePath) {
  const match = filePath.match(/pages\/([^/]+)/)
  if (match) return match[1]

  const componentMatch = filePath.match(/components\//)
  if (componentMatch) return 'common'

  const hookMatch = filePath.match(/hooks\//)
  if (hookMatch) return 'common'

  const constantMatch = filePath.match(/constants\/([^/]+)/)
  if (constantMatch) return constantMatch[1]

  const routerMatch = filePath.match(/router\//)
  if (routerMatch) return 'common'

  return 'common'
}

/**
 * 解析文件并创建 AST
 * @param {string} filePath - 文件路径
 * @returns {Object} { code, ast, context, isDataFile, fileType }
 */
function parseFileToAST(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8')
  const context = inferContext(filePath)
  const fileType = detectFileType(filePath)

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript', 'decorators-legacy'],
    sourceFilename: filePath,
    errorRecovery: true,
    ranges: true,
    tokens: true
  })

  const containsJSX = fileContainsJSX(ast)
  /**
   * 数据配置文件若包含 JSX，则视为组件文件，允许正常抽取文案
   */
  const isDataFile = isDataConfigFile(filePath) && !containsJSX

  return { code, ast, context, isDataFile, fileType }
}

/**
 * 处理 import 语句添加
 * @param {Object} ast - AST 对象
 * @param {Object} flags - import 标志
 * @param {boolean} isDataFile - 是否为数据文件
 * @param {string} fileType - 文件类型
 */
function handleImportsAndGenerate(ast, flags) {
  if (flags.needsIntlImport) {
    addImports(ast, flags)
  }

  const output = generateFn(ast, {
    retainLines: false,
    compact: false,
    concise: false,
    comments: true,
    jsescOption: {
      minimal: true // 保留 Unicode 字符，不转义为 \uXXXX
    }
  })

  return output.code
}

/**
 * 收集文本并生成 keys（支持 AI 和非 AI 模式）
 * @param {Object} ast - AST 对象
 * @param {string} context - 文件上下文
 * @param {string} filePath - 文件路径
 * @param {string} fileType - 文件类型
 * @param {boolean} isDataFile - 是否为数据文件
 * @param {Object} translations - 翻译字典
 * @param {boolean} useAI - 是否使用 AI 模式
 * @returns {Promise<Array>} 带有生成 key 的文本列表
 */
async function collectAndGenerateKeys(
  ast,
  context,
  filePath,
  fileType,
  isDataFile,
  translations,
  useAI,
  config,
  stats,
  diagnostics = {}
) {
  const textsToTranslate = []
  const recordUnrecognized =
    typeof diagnostics.recordUnrecognized === 'function' ? diagnostics.recordUnrecognized : null

  const recordSkippedSample = (path, text, nodeType) => {
    if (!recordUnrecognized) return false
    const skippedFunc = getSkippedFunctionForPath(path, config)
    if (!skippedFunc) return false
    recordUnrecognized(path.node, text, nodeType, `skipFunctionCall:${skippedFunc}`)
    return true
  }

  // 第一遍: 收集所有中文文本
  traverseFn(ast, {
    JSXText(path) {
      const text = path.node.value.trim()
      if (!text || !CHINESE_REGEX.test(text)) {
        return
      }
      if (isDataFile) {
        if (recordUnrecognized) {
          recordUnrecognized(path.node, text, SAMPLE_NODE_TYPES.JSX_TEXT, 'data-file-skip')
        }
        return
      }
      if (shouldSkipNode(path)) {
        return
      }
      // 使用 node 的位置作为唯一标识
      textsToTranslate.push({
        text,
        type: 'jsx-text',
        nodeStart: path.node.start,
        nodeEnd: path.node.end
      })
    },
    TemplateLiteral(path) {
      if (shouldSkipNode(path) || path.parentPath.isObjectProperty()) return
      const result = parseTemplateLiteral(path.node)
      if (!CHINESE_REGEX.test(result.text)) return
      if (recordSkippedSample(path, result.text, SAMPLE_NODE_TYPES.TEMPLATE_LITERAL)) {
        return
      }
      textsToTranslate.push({
        text: result.text,
        type: 'template',
        nodeStart: path.node.start,
        nodeEnd: path.node.end,
        vars: result.vars
      })
    },
    StringLiteral(path) {
      const text = path.node.value
      if (!CHINESE_REGEX.test(text) || shouldSkipNode(path)) return
      if (recordSkippedSample(path, text, SAMPLE_NODE_TYPES.STRING_LITERAL)) {
        return
      }
      if (path.findParent((p) => p.isBinaryExpression({ operator: '+' }))) return
      const extracted = extractValue(path.node, context, filePath, fileType, {}, 0)
      if (extracted?.hasExtraction) {
        textsToTranslate.push({
          text,
          type: 'string',
          nodeStart: path.node.start,
          nodeEnd: path.node.end
        })
      }
    },
    BinaryExpression(path) {
      if (!path.isBinaryExpression({ operator: '+' })) return
      if (path.parentPath.isBinaryExpression({ operator: '+' })) return
      if (shouldSkipNode(path)) return

      const conversion = buildTemplateLiteralFromBinaryExpression(path.node)
      if (!conversion) return

      const result = parseTemplateLiteral(conversion.templateLiteral)
      if (!CHINESE_REGEX.test(result.text)) return
      if (recordSkippedSample(path, result.text, SAMPLE_NODE_TYPES.TEMPLATE_LITERAL)) {
        return
      }

      textsToTranslate.push({
        text: result.text,
        type: 'binary',
        nodeStart: path.node.start,
        nodeEnd: path.node.end,
        vars: result.vars
      })
    }
  })

  // 防止重复：先检查文本是否已存在
  const newTexts = []
  const existingKeys = []

  for (const item of textsToTranslate) {
    // 查找是否已有相同文本和相同插值变量的 key
    const existingKey = Object.entries(translations).find(([_key, value]) => {
      const existingText = typeof value === 'string' ? value : value.text
      const existingVars = typeof value === 'string' ? [] : (value.interpolations || [])
      const currentVars = item.vars?.map((v) => v.name) || []
      // 文本相同且插值变量相同才能复用
      return existingText === item.text &&
             JSON.stringify(existingVars.sort()) === JSON.stringify(currentVars.sort())
    })?.[0]

    if (existingKey) {
      // 复用已有 key
      item.key = existingKey
      existingKeys.push(item.text)
      if (stats) {
        stats.reusedKeys += 1
      }
    } else {
      // 需要生成新 key
      newTexts.push(item)
      if (stats) {
        stats.interpolations += item.vars?.length ?? 0
      }
    }
  }

  // 为新文本生成 keys
  if (newTexts.length > 0) {
    if (useAI) {
      // AI 模式：批量生成
      const { ai } = config.keyGeneration
      const batchSize = ai.batchSize || 10
      const fallbackToSemantic = ai.fallbackToSemantic !== false

      // 分批处理（避免单次请求过大）
      for (let i = 0; i < newTexts.length; i += batchSize) {
        const batch = newTexts.slice(i, i + batchSize)
        if (stats) {
          stats.aiGenerated += batch.length
        }

        // 使用批量 API 调用
        const keys = await generateAIKeysBatch(
          batch.map((item) => ({
            text: item.text,
            context: { filePath, fileType, textType: identifyTextType(item.text) }
          })),
          config
        )

        // 将生成的 keys 存储到 translations
        for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
          const item = batch[batchIndex]
          const key = keys[batchIndex]
          // 验证 key 的有效性
          if (key && typeof key === 'string' && key.length > 0 && !/^(null|undefined)$/i.test(key)) {
            const fullKey = `${context}.${key}`
            translations[fullKey] = {
              text: item.text,
              context: filePath,
              interpolations: item.vars?.map((v) => v.name) || []
            }
            item.key = fullKey
          } else {
            // AI 生成失败，使用降级策略
            if (fallbackToSemantic) {
              console.warn(`警告: AI 生成无效 key: "${key}", 降级到语义化策略, 文本: "${item.text.substring(0, 20)}..."`)
              const safeFallbackKey = `${context}.${buildSafeFallbackKey(item.text, config)}`
              translations[safeFallbackKey] = {
                text: item.text,
                context: filePath,
                interpolations: item.vars?.map((v) => v.name) || []
              }
              item.key = safeFallbackKey
            } else {
              console.error(`错误: AI 生成失败且未启用降级, 文本: "${item.text.substring(0, 20)}..."`)
            }
          }
        }
      }
    } else {
      // 非 AI 模式：逐个生成（但使用 Promise.all 并行）
      await Promise.all(
        newTexts.map(async (item) => {
          const key = await generateKey(item.text, context, { filePath, fileType }, config)
          translations[key] = {
            text: item.text,
            context: filePath,
            interpolations: item.vars?.map((v) => v.name) || []
          }
          item.key = key
        })
      )
    }
  }

  if (existingKeys.length > 0) {
    console.log(`  复用 ${existingKeys.length} 个已有 key`)
  }

  return textsToTranslate
}

/**
 * 检测文件类型
 * @param {string} filePath - 文件路径
 * @returns {'component'|'data'|'router'|'constants'|'utils'} 文件类型
 */
export function detectFileType(filePath) {
  // React 组件文件
  if (
    filePath.endsWith('.tsx') &&
    !filePath.includes('/data.tsx') &&
    !filePath.includes('/data.ts')
  ) {
    return 'component'
  }

  // 数据配置文件
  if (filePath.includes('/data.tsx') || filePath.includes('/data.ts')) {
    return 'data'
  }

  // 路由配置
  if (filePath.includes('/router/config')) {
    return 'router'
  }

  // 常量文件
  if (filePath.includes('/constants/')) {
    return 'constants'
  }

  // 其他 .ts 文件
  return 'utils'
}

/**
 * 检查是否是数据配置文件
 * @param {string} filePath - 文件路径
 * @returns {boolean} 是否为数据配置文件
 */
export function isDataConfigFile(filePath) {
  return /\/(data|constants|.*Data)\.tsx?$/.test(filePath) || filePath.includes('/router/config')
}

/**
 * 添加或更新 import 声明 (优化版：单次遍历)
 */
function addImports(ast, flags) {
  if (!flags.needsIntlImport) return

  const importState = {
    hasIntlImport: false,
    existingImportPath: null
  }

  traverseFn(ast, {
    ImportDeclaration(path) {
      if (path.node.source.value !== 'react-intl-universal') return

      const defaultSpecifier = path.node.specifiers.find((spec) =>
        t.isImportDefaultSpecifier(spec)
      )

      if (defaultSpecifier) {
        const localName = defaultSpecifier.local.name
        if (localName === 'intl') {
          importState.hasIntlImport = true
        } else {
          const programBody = path.parentPath.node.body
          const hasAliasDeclaration = programBody.some(
            (node) =>
              t.isVariableDeclaration(node) &&
              node.declarations.some(
                (decl) =>
                  t.isIdentifier(decl.id, { name: 'intl' }) &&
                  t.isIdentifier(decl.init, { name: localName })
              )
          )

          if (!hasAliasDeclaration) {
            path.insertAfter(
              t.variableDeclaration('const', [
                t.variableDeclarator(t.identifier('intl'), t.identifier(localName))
              ])
            )
          }

          importState.hasIntlImport = true
        }
        path.stop()
        return
      }

      importState.existingImportPath = path
    }
  })

  if (importState.hasIntlImport) return

  if (importState.existingImportPath) {
    importState.existingImportPath.node.specifiers.push(
      t.importDefaultSpecifier(t.identifier('intl'))
    )
    return
  }

  const importDeclaration = t.importDeclaration(
    [t.importDefaultSpecifier(t.identifier('intl'))],
    t.stringLiteral('react-intl-universal')
  )

  ast.program.body.unshift(importDeclaration)
}

function collectResidualChinese(ast, addMissingSample, recordedUnrecognizedKeys) {
  traverseFn(ast, {
    JSXText(path) {
      const text = path.node.value.trim()
      if (!text || !CHINESE_REGEX.test(text)) return
      const key = buildSampleKey(path.node, SAMPLE_NODE_TYPES.JSX_TEXT, text)
      if (recordedUnrecognizedKeys.has(key)) return
      addMissingSample(path.node, text, SAMPLE_NODE_TYPES.JSX_TEXT)
    },
    StringLiteral(path) {
      const text = path.node.value
      if (!CHINESE_REGEX.test(text)) return

      const inIntlCall = path.findParent(
        (parent) =>
          (parent.isCallExpression() || parent.isOptionalCallExpression()) &&
          isIntlGetCall(parent.node.callee)
      )
      if (inIntlCall) return

      const key = buildSampleKey(path.node, SAMPLE_NODE_TYPES.STRING_LITERAL, text)
      if (recordedUnrecognizedKeys.has(key)) return
      addMissingSample(path.node, text, SAMPLE_NODE_TYPES.STRING_LITERAL)
    },
    TemplateLiteral(path) {
      const result = parseTemplateLiteral(path.node)
      if (!CHINESE_REGEX.test(result.text)) return

      const parent = path.parentPath
      if (
        parent &&
        (parent.isCallExpression() || parent.isOptionalCallExpression()) &&
        isIntlGetCall(parent.node.callee)
      ) {
        return
      }

      const key = buildSampleKey(path.node, SAMPLE_NODE_TYPES.TEMPLATE_LITERAL, result.text)
      if (recordedUnrecognizedKeys.has(key)) return
      addMissingSample(path.node, result.text, SAMPLE_NODE_TYPES.TEMPLATE_LITERAL)
    }
  })
}

/**
 * 转换单个文件，提取中文文本并替换为 i18n 调用
 * @param {string} filePath - 文件路径
 * @param {Object.<string, {text: string, context: string, interpolations: string[]}>} translations - 全局翻译字典（会被修改）
 * @returns {Promise<{code: string, stats: {extracted: number, skipped: number, dataConstants: number}}>} 转换后的代码和统计信息
 */
export async function transformFile(filePath, translations, config = getConfig()) {
  // 解析文件
  const { ast, context, isDataFile, fileType } = parseFileToAST(filePath)

  const stats = {
    extracted: 0,
    skipped: 0,
    dataConstants: 0,
    reusedKeys: 0,
    aiGenerated: 0,
    interpolations: 0,
    topLevelConstants: [],
    missingSamples: [],
    unrecognizedSamples: []
  }

  const recordedMissingKeys = new Set()
  const recordedUnrecognizedKeys = new Set()

  const addUnrecognizedSample = (node, text, nodeType, reason) => {
    const key = buildSampleKey(node, nodeType, text)
    if (recordedUnrecognizedKeys.has(key)) return
    recordedUnrecognizedKeys.add(key)
    stats.unrecognizedSamples.push({
      text,
      nodeType,
      reason,
      loc: getNodeLocation(node)
    })
  }

  const addMissingSample = (node, text, nodeType, reason = 'postTransformScan') => {
    const key = buildSampleKey(node, nodeType, text)
    if (recordedUnrecognizedKeys.has(key) || recordedMissingKeys.has(key)) return
    recordedMissingKeys.add(key)
    stats.missingSamples.push({
      text,
      nodeType,
      reason,
      loc: getNodeLocation(node)
    })
  }

  const collectUnrecognizedFromArguments = (callPath, reason) => {
    if (!reason || typeof callPath?.get !== 'function') return
    const argumentPaths = callPath.get('arguments') || []
    argumentPaths.forEach((argPath) => {
      argPath.traverse(
        {
          StringLiteral(innerPath) {
            const text = innerPath.node.value
            if (!CHINESE_REGEX.test(text)) return
            addUnrecognizedSample(innerPath.node, text, SAMPLE_NODE_TYPES.STRING_LITERAL, reason)
            innerPath.skip()
          },
          TemplateLiteral(innerPath) {
            const result = parseTemplateLiteral(innerPath.node)
            if (!CHINESE_REGEX.test(result.text)) return
            addUnrecognizedSample(innerPath.node, result.text, SAMPLE_NODE_TYPES.TEMPLATE_LITERAL, reason)
          },
          JSXText(innerPath) {
            const value = innerPath.node.value.trim()
            if (!value || !CHINESE_REGEX.test(value)) return
            addUnrecognizedSample(innerPath.node, value, SAMPLE_NODE_TYPES.JSX_TEXT, reason)
          }
        },
        callPath.scope
      )
    })
  }

  // 使用对象以便通过引用修改
  const flags = { needsIntlImport: false }

  // 检查是否需要 AI 模式
  const useAI = config.keyGeneration.strategy === 'ai' && config.keyGeneration.ai.enabled

  mergeJSXTextWithExpressions(ast)

  // 收集文本并批量生成 keys（支持 AI 和非 AI 模式）
  const textsToTranslate = await collectAndGenerateKeys(
    ast,
    context,
    filePath,
    fileType,
    isDataFile,
    translations,
    useAI,
    config,
    stats,
    {
      recordUnrecognized: addUnrecognizedSample
    }
  )

  // 第二遍: 替换文本
  traverseFn(ast, {
    // ============================================
    // 场景1: JSX 文本
    // ============================================
    JSXText(path) {
      if (isDataFile) return

      const text = path.node.value.trim()
      if (!text || !CHINESE_REGEX.test(text) || shouldSkipNode(path)) {
        return
      }

      // 使用预生成的 key（通过 node 位置匹配）
      const item = textsToTranslate.find(
        (t) => t.nodeStart === path.node.start &&
               t.nodeEnd === path.node.end &&
               t.type === 'jsx-text'
      )
      const key = item?.key
      if (!key) return // 如果没找到,跳过

      path.replaceWith(t.jsxExpressionContainer(createIntlGetCallExpression(key)))
      updateImportStats(fileType, flags, stats)
    },

    // ============================================
    // 场景1b: JSX ExpressionContainer 中的纯字符串
    // ============================================
    JSXExpressionContainer(path) {
      if (isDataFile) return
      // 不跳过 AI 模式，让 extractValue 正常处理

      if (!path.parent || !t.isJSXElement(path.parent)) return
      if (path.parentPath.isJSXAttribute()) return

      const { expression } = path.node
      const extracted = extractValue(expression, context, filePath, fileType, translations, 0)
      if (extracted?.hasExtraction) {
        path.node.expression = extracted.replacementNode
        updateImportStats(fileType, flags, stats)
      }
    },

    // ============================================
    // 场景2: JSX 属性
    // ============================================
    JSXAttribute(path) {
      const { value } = path.node

      const extracted = extractValue(value, context, filePath, fileType, translations, 0)
      if (extracted?.hasExtraction) {
        path.node.value = t.jsxExpressionContainer(extracted.replacementNode)
        updateImportStats(fileType, flags, stats)
      }
    },

    // ============================================
    // 场景3: 模板字符串
    // ============================================
    TemplateLiteral(path) {
      if (shouldSkipNode(path)) return
      if (path.parentPath.isObjectProperty()) return

      const result = parseTemplateLiteral(path.node)
      if (!CHINESE_REGEX.test(result.text)) return

      // 使用预生成的 key（通过 node 位置匹配）
      const item = textsToTranslate.find(
        (t) => t.nodeStart === path.node.start &&
               t.nodeEnd === path.node.end &&
               t.type === 'template'
      )
      const key = item?.key
      if (!key) return // 如果没找到,跳过

      path.replaceWith(createIntlGetCallExpression(key, result.vars))
      updateImportStats(fileType, flags, stats)
    },

    // ============================================
    // 场景4: 函数调用参数提取
    // ============================================
    CallExpression(path) {
      const { callee, arguments: args } = path.node

      // 警告: 跳过翻译调用,防止双重包裹
      const isIntlGetCall =
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: 'intl' }) &&
        t.isIdentifier(callee.property) &&
        (callee.property.name === 'get' || callee.property.name === 'getHTML')

      const isTranslationCall = t.isIdentifier(callee, { name: 't' }) || isIntlGetCall

      if (isTranslationCall) {
        return // 不提取翻译调用的参数
      }

      // 特殊处理: Promise.reject
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: 'Promise' }) &&
        t.isIdentifier(callee.property, { name: 'reject' }) &&
        args.length > 0
      ) {
        const extracted = extractValue(args[0], context, filePath, fileType, translations, 0)
        if (extracted?.hasExtraction) {
          args[0] = extracted.replacementNode
          updateImportStats(fileType, flags, stats)
        }
        return
      }

      // 通用函数调用处理
      const funcName = getFunctionName(callee)
      if (shouldSkipFunctionCall(funcName, config)) {
        const reason = `skipFunctionCall:${funcName || 'unknown'}`
        collectUnrecognizedFromArguments(path, reason)
        return
      }

      let hasAnyExtraction = false
      args.forEach((arg, index) => {
        const extracted = extractValue(arg, context, filePath, fileType, translations, 0)
        if (extracted?.hasExtraction) {
          args[index] = extracted.replacementNode
          hasAnyExtraction = true
          updateImportStats(fileType, flags, stats)
        }
      })

      if (hasAnyExtraction) {
        // 标志已在 updateImportStats 中更新
      }
    },

    // ============================================
    // 场景: 通用对象属性提取
    // ============================================
    ObjectProperty(path) {
      if (shouldSkipNode(path)) return

      if (path.findParent((p) => p.isVariableDeclarator())) {
        const declarator = path.findParent((p) => p.isVariableDeclarator())
        if (declarator && t.isArrayExpression(declarator.node.init)) {
          return
        }
      }

      const inRuntimeScope = isInsideRuntimeScope(path)
      const extracted = extractValue(
        path.node.value,
        context,
        filePath,
        fileType,
        translations,
        0
      )

      const replacement = extracted?.hasExtraction ? extracted.replacementNode : path.node.value

      const shouldUseGetter =
        !inRuntimeScope &&
        !path.node.computed &&
        !path.node.shorthand &&
        (t.isIdentifier(path.node.key) || t.isStringLiteral(path.node.key)) &&
        t.isCallExpression(replacement) &&
        isIntlGetCall(replacement.callee)

      if (extracted?.hasExtraction) {
        updateImportStats(fileType, flags, stats)
      }

      if (shouldUseGetter) {
        path.replaceWith(createLazyGetterFromProperty(path.node, replacement))
        stats.dataConstants++
      } else if (extracted?.hasExtraction) {
        path.node.value = replacement
      }
    },

    // ============================================
    // 场景5: notification.show({ title, body })
    // ============================================
    ObjectExpression(path) {
      const parent = path.findParent((p) => {
        const isCall = p.isCallExpression() || p.isOptionalCallExpression()
        const isMember =
          t.isMemberExpression(p.node.callee) || t.isOptionalMemberExpression(p.node.callee)
        const calleeCode = isMember ? generateFn(p.node.callee).code : ''
        const hasNotification = calleeCode.includes('notification') && calleeCode.includes('show')

        return isCall && isMember && hasNotification
      })

      if (!parent) return

      path.node.properties.forEach((prop) => {
        const keyName = getObjectPropertyKey(prop)
        if (['title', 'body'].includes(keyName)) {
          const extracted = extractValue(prop.value, context, filePath, fileType, translations, 0)
          if (extracted?.hasExtraction) {
            prop.value = extracted.replacementNode
            updateImportStats(fileType, flags, stats)
          }
        }
      })
    },

    // ============================================
    // 场景6: 常量数组/对象提取
    // ============================================
    VariableDeclarator(path) {
      const { id } = path.node
      let { init } = path.node

      if (!t.isIdentifier(id)) return

      if (init && (t.isTSAsExpression(init) || t.isTSTypeAssertion(init))) {
        init = init.expression
      }

      const inRuntimeScope = isInsideRuntimeScope(path)

      const applyReplacement = (replacement) => {
        const shouldRecordTopLevelIntl =
          !inRuntimeScope && t.isCallExpression(replacement) && isIntlGetCall(replacement.callee)

        if (shouldRecordTopLevelIntl) {
          const intlKeyArg = replacement.arguments?.[0]
          const intlKey = t.isStringLiteral(intlKeyArg) ? intlKeyArg.value : null
          stats.topLevelConstants.push({
            name: id.name,
            intlKey,
            line: path.node.loc?.start?.line ?? null,
            column: path.node.loc?.start?.column ?? null
          })
        }

        path.node.init = replacement
        init = replacement
      }

      if (init && !t.isObjectExpression(init) && !t.isArrayExpression(init)) {
        if (!inRuntimeScope && t.isCallExpression(init) && isIntlGetCall(init.callee)) {
          const intlKeyArg = init.arguments?.[0]
          const intlKey = t.isStringLiteral(intlKeyArg) ? intlKeyArg.value : null
          stats.topLevelConstants.push({
            name: id.name,
            intlKey,
            line: path.node.loc?.start?.line ?? null,
            column: path.node.loc?.start?.column ?? null
          })
        }

        const extracted = extractValue(init, context, filePath, fileType, translations, 0)
        if (extracted?.hasExtraction) {
          const replacement = extracted.replacementNode
          updateImportStats(fileType, flags, stats)

          applyReplacement(replacement)
          return
        }
      }

      if (t.isArrayExpression(init)) {
        const extractedArray = extractValue(init, context, filePath, fileType, translations, 0)
        if (extractedArray?.hasExtraction) {
          updateImportStats(fileType, flags, stats)
          applyReplacement(extractedArray.replacementNode)
        }
      }

      const processObjectExpression = (objectExpression) => {
        objectExpression.properties = objectExpression.properties.map((prop) => {
          if (!t.isObjectProperty(prop)) return prop

          const result = extractValue(
            prop.value,
            context,
            filePath,
            fileType,
            translations,
            0
          )

          let replacement = result?.hasExtraction ? result.replacementNode : prop.value

          if (result?.hasExtraction) {
            updateImportStats(fileType, flags, stats)
          }

          const shouldUseGetter =
            !inRuntimeScope &&
            !prop.computed &&
            !prop.shorthand &&
            (t.isIdentifier(prop.key) || t.isStringLiteral(prop.key)) &&
            t.isCallExpression(replacement) &&
            isIntlGetCall(replacement.callee)

          if (shouldUseGetter) {
            stats.dataConstants++
            return createLazyGetterFromProperty(prop, replacement)
          }

          if (result?.hasExtraction) {
            prop.value = replacement
          }

          return prop
        })
      }

      if (t.isObjectExpression(init)) {
        processObjectExpression(init)
        return
      }

      if (t.isArrayExpression(init)) {
        init.elements.forEach((element) => {
          if (!t.isObjectExpression(element)) return
          processObjectExpression(element)
        })
      }
    },

    // ============================================
    // 场景7: new Error() 调用提取
    // ============================================
    NewExpression(path) {
      const { callee, arguments: args } = path.node

      if (t.isIdentifier(callee, { name: 'Error' }) && args.length > 0) {
        const firstArg = args[0]
        const extracted = extractValue(firstArg, context, filePath, fileType, translations, 0)
        if (extracted?.hasExtraction) {
          args[0] = extracted.replacementNode
          updateImportStats(fileType, flags, stats)
        }
      }
    },

    // ============================================
    // 场景8: 赋值表达式提取
    // ============================================
    AssignmentExpression(path) {
      const { left, right } = path.node

      if (!t.isIdentifier(left)) return

      const extracted = extractValue(right, context, filePath, fileType, translations, 0)
      if (extracted?.hasExtraction) {
        path.node.right = extracted.replacementNode
        updateImportStats(fileType, flags, stats)
      }
    },

    // ============================================
    // 场景9: return 语句中的字符串
    // ============================================
    ReturnStatement(path) {
      const { argument } = path.node
      if (!argument) return

      const extracted = extractValue(argument, context, filePath, fileType, translations, 0)
      if (extracted?.hasExtraction) {
        path.node.argument = extracted.replacementNode
        updateImportStats(fileType, flags, stats)
      }
    },

    // ============================================
    // 场景11: 可选调用表达式参数
    // ============================================
    OptionalCallExpression(path) {
      const { callee, arguments: args } = path.node

      const funcName = getFunctionName(callee)
      if (shouldSkipFunctionCall(funcName, config)) {
        const reason = `skipFunctionCall:${funcName || 'unknown'}`
        collectUnrecognizedFromArguments(path, reason)
        return
      }

      if (args && args.length > 0) {
        args.forEach((arg, index) => {
          const extracted = extractValue(arg, context, filePath, fileType, translations, 0)
          if (extracted?.hasExtraction) {
            args[index] = extracted.replacementNode
            updateImportStats(fileType, flags, stats)
          }
        })
      }
    },

    // ============================================
    // 场景12: 函数参数默认值
    // ============================================
    'FunctionDeclaration|ArrowFunctionExpression|FunctionExpression|ObjectMethod'(path) {
      const { params } = path.node
      if (!params || params.length === 0) return

      params.forEach((param) => {
        // 简单参数默认值
        if (t.isAssignmentPattern(param)) {
          const extracted = extractValue(param.right, context, filePath, fileType, translations, 0)
          if (extracted?.hasExtraction) {
            param.right = extracted.replacementNode
            updateImportStats(fileType, flags, stats)
          }
        }

        // 对象解构参数默认值
        if (t.isObjectPattern(param)) {
          param.properties.forEach((prop) => {
            if (t.isObjectProperty(prop) && t.isAssignmentPattern(prop.value)) {
              const extracted = extractValue(
                prop.value.right,
                context,
                filePath,
                fileType,
                translations,
                0
              )
              if (extracted?.hasExtraction) {
                prop.value.right = extracted.replacementNode
                updateImportStats(fileType, flags, stats)
              }
            }
          })
        }
      })
    },

    // ============================================
    // 场景13: 二元比较表达式
    // ============================================
    BinaryExpression(path) {
      const { operator, left, right } = path.node

      if (!['===', '==', '!==', '!='].includes(operator)) return

      const leftExtracted = extractValue(left, context, filePath, fileType, translations, 0)
      if (leftExtracted?.hasExtraction) {
        path.node.left = leftExtracted.replacementNode
        updateImportStats(fileType, flags, stats)
      }

      const rightExtracted = extractValue(right, context, filePath, fileType, translations, 0)
      if (rightExtracted?.hasExtraction) {
        path.node.right = rightExtracted.replacementNode
        updateImportStats(fileType, flags, stats)
      }
    }
  })

  collectResidualChinese(ast, addMissingSample, recordedUnrecognizedKeys)

  // 处理 import 并生成最终代码
  const code = handleImportsAndGenerate(ast, flags)

  return { code, stats }
}
