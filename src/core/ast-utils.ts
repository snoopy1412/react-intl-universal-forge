// @ts-nocheck
/**
 * AST 处理工具函数
 */

import traverse from '@babel/traverse'
import generate from '@babel/generator'
import * as t from '@babel/types'

import { getConfig } from '../config/index.js'
import { generateKeySync } from './key-generator.js'

const traverseFn: typeof traverse = (traverse as unknown as { default?: typeof traverse }).default ?? traverse
const generateFn: typeof generate = (generate as unknown as { default?: typeof generate }).default ?? (generate as unknown as typeof generate)

// 中文正则
const CHINESE_REGEX = /[\u4e00-\u9fa5]/

// 最大递归深度限制，防止栈溢出
const MAX_RECURSION_DEPTH = 10

function flattenBinaryExpressionParts(node, parts = []) {
  if (t.isBinaryExpression(node, { operator: '+' })) {
    flattenBinaryExpressionParts(node.left, parts)
    flattenBinaryExpressionParts(node.right, parts)
    return parts
  }

  parts.push(node)
  return parts
}

export function buildTemplateLiteralFromBinaryExpression(node) {
  if (!t.isBinaryExpression(node, { operator: '+' })) {
    return null
  }

  const parts = flattenBinaryExpressionParts(node)
  if (parts.length === 0) return null

  let buffer = ''
  const quasis = []
  const expressions = []
  let hasChinese = false
  let hasExpression = false

  const pushQuasi = (text) => {
    quasis.push(
      t.templateElement({ raw: text, cooked: text })
    )
  }

  for (const part of parts) {
    if (t.isStringLiteral(part)) {
      const value = part.value
      buffer += value
      if (CHINESE_REGEX.test(value)) {
        hasChinese = true
      }
      continue
    }

    if (t.isTemplateLiteral(part) && part.expressions.length === 0) {
      const value = part.quasis.map((q) => q.value.cooked).join('')
      buffer += value
      if (CHINESE_REGEX.test(value)) {
        hasChinese = true
      }
      continue
    }

    pushQuasi(buffer)
    buffer = ''
    expressions.push(t.cloneNode(part, true))
    hasExpression = true
  }

  pushQuasi(buffer)

  if (!hasExpression || !hasChinese) {
    return null
  }

  return {
    templateLiteral: t.templateLiteral(quasis, expressions),
    hasChinese,
    expressionsCount: expressions.length
  }
}

/**
 * 解析模板字符串插值
 * @param {import('@babel/types').TemplateLiteral} node - TemplateLiteral AST 节点
 * @returns {{text: string, vars: Array<{name: string, expr: import('@babel/types').Expression}>}} 解析结果
 */
export function parseTemplateLiteral(node) {
  const { quasis, expressions } = node

  let text = ''
  const vars = []

  for (let i = 0; i < quasis.length; i++) {
    text += quasis[i].value.cooked

    if (i < expressions.length) {
      const expr = expressions[i]

      let varName = 'value' + i
      if (t.isIdentifier(expr)) {
        varName = expr.name
      } else if (t.isMemberExpression(expr)) {
        varName = generateFn(expr).code.replace(/[^a-zA-Z0-9]/g, '_')
      }

      text += `{${varName}}`
      vars.push({ name: varName, expr })
    }
  }

  return { text, vars }
}

/**
 * 创建基于 intl.get() 的国际化调用表达式
 * @param {string} key - i18n key
 * @param {Array<{name: string, expr: import('@babel/types').Expression}>} vars - 插值变量列表
 * @returns {import('@babel/types').CallExpression} CallExpression AST 节点
 */
export function createIntlGetCallExpression(key, vars = []) {
  const args = [t.stringLiteral(key)]

  if (vars.length > 0) {
    const varsObj = t.objectExpression(
      vars.map((v) =>
        t.objectProperty(
          t.identifier(v.name),
          v.expr,
          false,
          t.isIdentifier(v.expr) && v.expr.name === v.name
        )
      )
    )
    args.push(varsObj)
  }

  return t.callExpression(
    t.memberExpression(t.identifier('intl'), t.identifier('get')),
    args
  )
}

/**
 * 检查是否应该跳过该节点
 * @param {Object} path - Babel 路径对象
 * @returns {boolean}
 */
export function isIntlGetCall(node) {
  return (
    t.isMemberExpression(node) &&
    t.isIdentifier(node.object, { name: 'intl' }) &&
    t.isIdentifier(node.property) &&
    (node.property.name === 'get' || node.property.name === 'getHTML')
  )
}

export function shouldSkipNode(path) {
  // 跳过已经是 intl.get()/intl.getHTML() 调用的
  if (
    path.findParent(
      (p) =>
        p.isCallExpression() &&
        isIntlGetCall(p.node.callee)
    )
  ) {
    return true
  }

  return false
}

/**
 * 获取函数调用的名称（支持成员表达式）
 * @param {Object} callee - 函数调用者 AST 节点
 * @returns {string|null}
 */
export function getFunctionName(callee) {
  if (t.isIdentifier(callee)) {
    return callee.name
  }
  if (t.isMemberExpression(callee)) {
    const object = t.isIdentifier(callee.object) ? callee.object.name : ''
    const property = t.isIdentifier(callee.property) ? callee.property.name : ''
    return object ? `${object}.${property}` : property
  }
  return null
}

/**
 * 检查函数是否应该跳过参数提取
 * @param {string} funcName - 函数名称
 * @returns {boolean}
 */
export function shouldSkipFunctionCall(funcName, config = getConfig()) {
  if (!funcName) return true

  const skipList = config.skipFunctionCalls || []

  // 检查是否在跳过列表中
  return skipList.some((skip) => {
    if (skip.includes('.')) {
      // 精确匹配 console.log
      return funcName === skip
    } else {
      // 前缀匹配 console.* 或完全匹配
      return funcName === skip || funcName.startsWith(`${skip}.`)
    }
  })
}

/**
 * 获取对象属性的 key 名称
 * @param {Object} prop - ObjectProperty AST 节点
 * @returns {string|null}
 */
export function getObjectPropertyKey(prop) {
  if (!t.isObjectProperty(prop)) return null
  if (t.isIdentifier(prop.key)) return prop.key.name
  if (t.isStringLiteral(prop.key)) return prop.key.value
  return null
}

/**
 * 通用值提取器 - 支持字符串、模板字符串、条件表达式等多种节点类型
 * @param {Object} valueNode - 值节点
 * @param {string} context - 上下文名称
 * @param {string} filePath - 文件路径
 * @param {string} fileType - 文件类型
 * @param {Object} translations - 翻译字典（会被修改）
 * @param {number} depth - 当前递归深度（默认为 0）
 * @returns {Object|null} { key, replacementNode, hasExtraction }
 */
export function extractValue(valueNode, context, filePath, fileType, translations, depth = 0) {
  // 递归深度检查，防止栈溢出
  if (depth >= MAX_RECURSION_DEPTH) {
    console.warn(`警告: 递归深度超过限制 (${MAX_RECURSION_DEPTH})，跳过节点提取`)
    return null
  }
  // 1. 处理字符串字面量
  if (t.isStringLiteral(valueNode)) {
    if (!CHINESE_REGEX.test(valueNode.value)) return null

    // 先查找是否已有相同文本的 key（支持 AI 批量生成的 key 复用）
    const existingKey = Object.entries(translations).find(([_key, value]) => {
      const existingText = typeof value === 'string' ? value : value.text
      const existingVars = typeof value === 'string' ? [] : (value.interpolations || [])
      // 字符串字面量没有插值变量
      return existingText === valueNode.value && existingVars.length === 0
    })?.[0]

    const key = existingKey || generateKeySync(valueNode.value, context)

    if (!existingKey) {
      translations[key] = {
        text: valueNode.value,
        context: filePath,
        interpolations: []
      }
    }

    return {
      key,
      replacementNode: createIntlGetCallExpression(key),
      hasExtraction: true
    }
  }

  // 2. 处理模板字符串（支持插值）
  if (t.isTemplateLiteral(valueNode)) {
    // 首先检查并提取表达式中的中文字符串字面量
    let hasNestedExtraction = false
    valueNode.expressions.forEach((expr, index) => {
      const extracted = extractValue(expr, context, filePath, fileType, translations, depth + 1)
      if (extracted?.hasExtraction) {
        valueNode.expressions[index] = extracted.replacementNode
        hasNestedExtraction = true
      }
    })

    // 然后处理模板字符串本身的静态部分
    const result = parseTemplateLiteral(valueNode)
    const hasChinese = CHINESE_REGEX.test(result.text)

    // 如果有嵌套提取或静态部分包含中文，都需要返回
    if (hasNestedExtraction && !hasChinese) {
      return {
        hasExtraction: true,
        replacementNode: valueNode
      }
    }

    if (hasChinese) {
      // 先查找是否已有相同文本和插值的 key
      const currentVars = result.vars.map((v) => v.name)
      const existingKey = Object.entries(translations).find(([_key, value]) => {
        const existingText = typeof value === 'string' ? value : value.text
        const existingVars = typeof value === 'string' ? [] : (value.interpolations || [])
        return existingText === result.text &&
               JSON.stringify(existingVars.sort()) === JSON.stringify(currentVars.sort())
      })?.[0]

      const key = existingKey || generateKeySync(result.text, context)

      if (!existingKey) {
        translations[key] = {
          text: result.text,
          context: filePath,
          interpolations: currentVars
        }
      }

      return {
        key,
        replacementNode: createIntlGetCallExpression(key, result.vars),
        hasExtraction: true
      }
    }

    return hasNestedExtraction ? { hasExtraction: true, replacementNode: valueNode } : null
  }

  // 3. 处理条件表达式
  if (t.isConditionalExpression(valueNode)) {
    const consequent = extractValue(valueNode.consequent, context, filePath, fileType, translations, depth + 1)
    const alternate = extractValue(valueNode.alternate, context, filePath, fileType, translations, depth + 1)

    if (consequent || alternate) {
      return {
        hasExtraction: true,
        replacementNode: t.conditionalExpression(
          valueNode.test,
          consequent?.replacementNode || valueNode.consequent,
          alternate?.replacementNode || valueNode.alternate
        )
      }
    }
  }

  // 4. 处理逻辑表达式（|| 和 &&）
  if (t.isLogicalExpression(valueNode)) {
    const left = extractValue(valueNode.left, context, filePath, fileType, translations, depth + 1)
    const right = extractValue(valueNode.right, context, filePath, fileType, translations, depth + 1)

    if (left || right) {
      return {
        hasExtraction: true,
        replacementNode: t.logicalExpression(
          valueNode.operator,
          left?.replacementNode || valueNode.left,
          right?.replacementNode || valueNode.right
        )
      }
    }
  }

  // 5. 处理数组表达式
  if (t.isArrayExpression(valueNode)) {
    let hasAnyExtraction = false
    const newElements = valueNode.elements.map((element) => {
      if (!element) return element

      const extracted = extractValue(element, context, filePath, fileType, translations, depth + 1)
      if (extracted?.hasExtraction) {
        hasAnyExtraction = true
        return extracted.replacementNode
      }
      return element
    })

    if (hasAnyExtraction) {
      return {
        hasExtraction: true,
        replacementNode: t.arrayExpression(newElements)
      }
    }
  }

  // 6. 处理二元表达式（字符串拼接）
  if (t.isBinaryExpression(valueNode) && valueNode.operator === '+') {
    const conversion = buildTemplateLiteralFromBinaryExpression(valueNode)
    if (conversion) {
      const converted = extractValue(
        conversion.templateLiteral,
        context,
        filePath,
        fileType,
        translations,
        depth + 1
      )
      if (converted?.hasExtraction) {
        return converted
      }
    }

    const left = extractValue(valueNode.left, context, filePath, fileType, translations, depth + 1)
    const right = extractValue(valueNode.right, context, filePath, fileType, translations, depth + 1)

    if (left || right) {
      return {
        hasExtraction: true,
        replacementNode: t.binaryExpression(
          '+',
          left?.replacementNode || valueNode.left,
          right?.replacementNode || valueNode.right
        )
      }
    }
  }

  // 7. 处理函数调用
  if (t.isCallExpression(valueNode)) {
    // 跳过已经是 intl.get()/intl.getHTML() 的调用
    const isTranslationCall = isIntlGetCall(valueNode.callee)

    if (isTranslationCall) {
      return null
    }

    const args = valueNode.arguments
    let hasExtraction = false
    const newArgs = args.map((arg) => {
      const extracted = extractValue(arg, context, filePath, fileType, translations, depth + 1)
      if (extracted?.hasExtraction) {
        hasExtraction = true
        return extracted.replacementNode
      }
      return arg
    })

    if (hasExtraction) {
      return {
        hasExtraction: true,
        replacementNode: t.callExpression(valueNode.callee, newArgs)
      }
    }
  }

  // 8. 处理对象表达式
  if (t.isObjectExpression(valueNode)) {
    let hasAnyExtraction = false
    const newProperties = valueNode.properties.map((prop) => {
      if (!t.isObjectProperty(prop)) return prop

      const extracted = extractValue(prop.value, context, filePath, fileType, translations, depth + 1)
      if (extracted?.hasExtraction) {
        hasAnyExtraction = true

        const keyName = getObjectPropertyKey(prop)
        if (keyName === 'label' && !prop.shorthand) {
          const methodBody = t.blockStatement([
            t.returnStatement(extracted.replacementNode)
          ])

          return t.objectMethod(
            'get',
            t.cloneNode(prop.key, true),
            [],
            methodBody,
            prop.computed || false
          )
        }

        return t.objectProperty(prop.key, extracted.replacementNode, prop.computed, prop.shorthand)
      }
      return prop
    })

    if (hasAnyExtraction) {
      return {
        hasExtraction: true,
        replacementNode: t.objectExpression(newProperties)
      }
    }
  }

  // 9. 处理 JSXExpressionContainer
  if (t.isJSXExpressionContainer(valueNode)) {
    return extractValue(valueNode.expression, context, filePath, fileType, translations, depth + 1)
  }

  // 10. 处理箭头函数
  if (t.isArrowFunctionExpression(valueNode) || t.isFunctionExpression(valueNode)) {
    const { body } = valueNode

    // 情况1: 隐式返回
    if (!t.isBlockStatement(body)) {
      const extracted = extractValue(body, context, filePath, fileType, translations, depth + 1)
      if (extracted?.hasExtraction) {
        valueNode.body = extracted.replacementNode
        return {
          hasExtraction: true,
          replacementNode: valueNode
        }
      }
    }

    // 情况2: 显式返回
    if (t.isBlockStatement(body)) {
      let hasAnyExtraction = false

      body.body.forEach((statement) => {
        if (t.isReturnStatement(statement) && statement.argument) {
          const extracted = extractValue(
            statement.argument,
            context,
            filePath,
            fileType,
            translations,
            depth + 1
          )
          if (extracted?.hasExtraction) {
            statement.argument = extracted.replacementNode
            hasAnyExtraction = true
          }
        }
      })

      if (hasAnyExtraction) {
        return {
          hasExtraction: true,
          replacementNode: valueNode
        }
      }
    }
  }

  return null
}

// React-intl-universal 流程统一依赖 intl.get()
