// @ts-nocheck
/**
 * i18n 自动翻译脚本 - 基于通用开放式聊天模型 API
 *
 * 功能：
 * 1. 读取源语言文件（zh_CN.json）
 * 2. 批量翻译到目标语言
 * 3. 支持增量翻译（只翻译 value 为空的 key）
 * 4. 上下文感知的高质量翻译
 * 5. 翻译质量检查（变量占位符、空内容等）
 *
 * 使用：
 *   pnpm i18n:translate
 *   pnpm i18n:translate --lang=en_US  # 只翻译指定语言
 *   pnpm i18n:translate --force       # 强制重新翻译所有
 *
 * @typedef {Object} TranslationEntry
 * @property {string} key - i18n key
 * @property {string} text - 源文本
 *
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - 翻译是否有效
 * @property {string} [reason] - 无效原因
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getConfig, setActiveConfig } from '../config/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let activeConfigRef = null
let languageMapRef = null
let translateConfigRef = null

function setTranslateContext(config) {
  setActiveConfig(config)
  activeConfigRef = config
  languageMapRef = config.languages.map
  translateConfigRef = {
    batchSize: config.translation.batchSize,
    maxTokensPerRequest: config.translation.maxTokensPerRequest,
    batchDelay: config.translation.batchDelay,
    maxRetries: config.aiProvider.maxRetries,
    requestsPerMinute: config.aiProvider.requestsPerMinute,
    localesDir: config.localesDir
  }
}

function useConfig() {
  if (!activeConfigRef) {
    setTranslateContext(getConfig())
  }
  return activeConfigRef
}

function useLanguageMap() {
  if (!languageMapRef) {
    useConfig()
  }
  return languageMapRef
}

function useTranslateConfig() {
  if (!translateConfigRef) {
    useConfig()
  }
  return translateConfigRef
}

function resolveLogDirectory(subDir) {
  const config = useConfig()
  const primaryDir = path.join(config.projectRoot, '.forge-cache', subDir)
  try {
    fs.mkdirSync(primaryDir, { recursive: true })
    return primaryDir
  } catch (error) {
    const fallbackDir = path.join(os.tmpdir(), 'forge-i18n', subDir)
    try {
      fs.mkdirSync(fallbackDir, { recursive: true })
    } catch (innerError) {
      console.warn(
        `警告: 无法创建日志目录 ${fallbackDir}: ${(innerError && innerError.message) || innerError}`
      )
    }
    console.warn(
      `警告: 无法创建日志目录 ${primaryDir}，改用临时目录: ${(error && error.message) || error}`
    )
    return fallbackDir
  }
}

function writeTranslationLog(fileName, payload) {
  const dir = resolveLogDirectory('translation-logs')
  const filePath = path.join(dir, fileName)

  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
    return filePath
  } catch (error) {
    console.warn(`警告: 无法写入翻译日志 ${filePath}: ${(error && error.message) || error}`)
    return null
  }
}

// 请求限流状态
const RATE_LIMIT = {
  lastRequestTime: 0
}

const PROGRESS_BAR_LENGTH = 30
const SPINNER_FRAMES = ['-', '\\', '|', '/']
const SPINNER_INTERVAL = 120

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0s'
  }

  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }

  parts.push(`${seconds}s`)

  return parts.join(' ')
}

function formatProgressBar(completed, total, length = PROGRESS_BAR_LENGTH) {
  if (total <= 0) {
    const bar = '█'.repeat(length)
    return `[${bar}] 100.0% (0/0)`
  }

  const safeCompleted = Math.min(Math.max(completed, 0), total)
  const ratio = safeCompleted / total
  const filled = Math.min(length, Math.floor(ratio * length))
  const empty = Math.max(length - filled, 0)
  const bar = `${'█'.repeat(filled)}${'░'.repeat(empty)}`
  const percentage = (ratio * 100).toFixed(1)
  return `[${bar}] ${percentage}% (${safeCompleted}/${total})`
}

/**
 * 判断是否需要翻译
 * - force=true 时始终翻译
 * - 现有值为 null/undefined/空字符串时需要翻译
 * - 现有值与中文原文相同时需要翻译（说明还没翻译过）
 * - 其他情况（已有非空且不同于中文的值）视为无需翻译
 * @param {string | undefined | null} value - 现有翻译值
 * @param {string} chineseText - 中文原文
 * @param {Object} options
 * @param {boolean} [options.force=false]
 * @returns {boolean} 是否需要翻译
 */
function needsTranslation(value, chineseText, { force = false } = {}) {
  if (force) return true
  if (value === null || value === undefined) return true

  if (typeof value === 'string') {
    // 空字符串需要翻译
    if (value.trim().length === 0) return true
  }

  // 其他情况：已有非空内容 -> 不需要翻译
  return false
}

const ICU_VARIABLE_NAME_PATTERN = /^[_A-Za-z][_A-Za-z0-9]*$|^\d+$/
const ICU_SELECT_LIKE_TYPES = new Set(['select', 'plural', 'selectordinal'])

function findFirstTopLevelComma(text) {
  let depth = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      if (depth > 0) depth -= 1
    } else if (char === ',' && depth === 0) {
      return index
    }
  }
  return -1
}

function collectICUPlaceholders(message, counts) {
  if (typeof message !== 'string' || !message.includes('{')) {
    return
  }

  for (let index = 0; index < message.length; index++) {
    if (message[index] !== '{') continue

    let depth = 0
    const start = index
    let end = -1

    for (; index < message.length; index++) {
      const char = message[index]
      if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          end = index
          break
        }
      }
    }

    if (end === -1) {
      break
    }

    const block = message.slice(start, end + 1)
    processICUPlaceholderBlock(block, counts)
  }
}

function processICUPlaceholderBlock(block, counts) {
  const content = block.slice(1, -1)
  if (!content) return

  const trimmed = content.trim()
  if (!trimmed) return

  const splitIndex = findFirstTopLevelComma(trimmed)

  if (splitIndex === -1) {
    if (ICU_VARIABLE_NAME_PATTERN.test(trimmed)) {
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1)
    } else {
      collectICUPlaceholders(trimmed, counts)
    }
    return
  }

  const argName = trimmed.slice(0, splitIndex).trim()
  const remainder = trimmed.slice(splitIndex + 1).trim()

  if (ICU_VARIABLE_NAME_PATTERN.test(argName)) {
    counts.set(argName, (counts.get(argName) ?? 0) + 1)
  }

  if (!remainder) {
    return
  }

  const typeSeparatorIndex = findFirstTopLevelComma(remainder)
  let type = remainder
  let options = ''

  if (typeSeparatorIndex !== -1) {
    type = remainder.slice(0, typeSeparatorIndex).trim()
    options = remainder.slice(typeSeparatorIndex + 1).trim()
  } else {
    type = type.trim()
  }

  if (ICU_SELECT_LIKE_TYPES.has(type)) {
    processICUSelectLikeOptions(options, counts)
    return
  }

  if (options) {
    collectICUPlaceholders(options, counts)
  } else {
    collectICUPlaceholders(type, counts)
  }
}

function processICUSelectLikeOptions(options, counts) {
  if (!options) return

  let index = 0
  const { length } = options

  while (index < length) {
    while (index < length && /\s/.test(options[index])) {
      index += 1
    }

    if (options.slice(index).startsWith('offset:')) {
      index += 'offset:'.length
      while (index < length && /\s/.test(options[index])) {
        index += 1
      }
      while (index < length && /[0-9]/.test(options[index])) {
        index += 1
      }
      continue
    }

    const braceIndex = options.indexOf('{', index)
    if (braceIndex === -1) {
      break
    }

    let depth = 0
    let cursor = braceIndex

    for (; cursor < length; cursor++) {
      const char = options[cursor]
      if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          break
        }
      }
    }

    if (depth !== 0) {
      break
    }

    const blockContent = options.slice(braceIndex + 1, cursor)
    collectICUPlaceholders(blockContent, counts)

    index = cursor + 1
  }
}

function extractICUVariableCounts(message) {
  const counts = new Map()
  collectICUPlaceholders(message, counts)
  return counts
}

/**
 * 验证翻译质量
 * @param {string} original - 原文
 * @param {string} translated - 译文
 * @returns {ValidationResult} 验证结果
 */
function validateTranslation(original, translated) {
  // 类型检查：必须是字符串
  if (typeof translated !== 'string') {
    return {
      valid: false,
      reason: `翻译结果类型错误（期望 string，实际 ${typeof translated}）`
    }
  }

  // 检查是否为空翻译
  if (!translated.trim()) {
    return { valid: false, reason: '翻译结果为空' }
  }

  // 检查变量占位符是否保留: {var}
  const originalVarCounts = extractICUVariableCounts(original)
  const translatedVarCounts = extractICUVariableCounts(translated)

  if (originalVarCounts.size !== translatedVarCounts.size) {
    return {
      valid: false,
      reason: `变量占位符数量不匹配（原文 ${originalVarCounts.size} 种，译文 ${translatedVarCounts.size} 种）`
    }
  }

  for (const [name, count] of originalVarCounts.entries()) {
    if (!translatedVarCounts.has(name)) {
      return {
        valid: false,
        reason: `变量占位符缺失：${name}`
      }
    }
    const translatedCount = translatedVarCounts.get(name)
    if (translatedCount !== count) {
      return {
        valid: false,
        reason: `变量占位符次数不匹配：${name}（原文 ${count} 次，译文 ${translatedCount} 次）`
      }
    }
  }

  return { valid: true }
}


/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 限流请求
 */
async function rateLimitedFetch(url, options) {
  const config = useConfig()
  const provider = config.aiProvider
  const retries = provider.maxRetries
  const now = Date.now()
  const timeSinceLastRequest = now - RATE_LIMIT.lastRequestTime
  const minInterval = (60 * 1000) / provider.requestsPerMinute

  if (timeSinceLastRequest < minInterval) {
    await delay(minInterval - timeSinceLastRequest)
  }

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options)

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10)
        console.warn(`警告: 触发速率限制，等待 ${retryAfter} 秒后重试...`)
        await delay(retryAfter * 1000)
        continue
      }

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`API 错误 ${response.status}: ${error}`)
      }

      // 只在成功时更新请求时间
      RATE_LIMIT.lastRequestTime = Date.now()
      return response
    } catch (error) {
      if (i === retries - 1) throw error
      console.warn(`警告: 请求失败，${retries - i - 1} 次重试剩余: ${error.message}`)
      await delay(Math.pow(2, i) * 1000)
    }
  }
}

/**
 * 调用 AI 提供商接口
 * @param {Array} messages - 消息数组
 * @param {Object} options - 可选参数
 * @returns {Promise<string>} API 响应内容
 */
async function callAIProvider(messages, options = {}) {
  const config = useConfig()
  const provider = config.aiProvider
  const { headers: headerOverrides, ...bodyOverrides } = options
  const requestBody = {
    model: provider.model,
    messages,
    temperature: bodyOverrides.temperature ?? provider.temperature,
    max_tokens:
      bodyOverrides.max_tokens ?? config.translation.maxTokensPerRequest ?? provider.maxTokens,
    ...provider.request?.body,
    ...bodyOverrides
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
    ...(provider.request?.headers || {}),
    ...(headerOverrides || {})
  }

  const response = await rateLimitedFetch(provider.apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody)
  })

  const data = await response.json()

  // 健壮性检查：处理 API 错误响应
  if (data.error) {
    throw new Error(`AI 服务响应错误: ${data.error.message || JSON.stringify(data.error)}`)
  }

  if (!data.choices || data.choices.length === 0) {
    throw new Error(`AI 服务返回空结果: ${JSON.stringify(data)}`)
  }

  if (!data.choices[0].message?.content) {
    throw new Error(`AI 服务返回无效内容: ${JSON.stringify(data.choices[0])}`)
  }

  return data.choices[0].message.content
}

/**
 * 批量翻译
 * @param {TranslationEntry[]} entries - 待翻译条目
 * @param {string} targetLang - 目标语言
 * @param {Record<string, string>} existingTranslations - 现有翻译（用于缺失 key 的兜底）
 * @returns {Promise<Record<string, string>>} 翻译结果
 */
async function batchTranslate(entries, targetLang, existingTranslations = {}) {
  const config = useConfig()
  const languageMap = useLanguageMap()
  const langInfo = languageMap[targetLang]
  const sourceLangInfo = languageMap[config.languages.source]

  // 构建批量翻译的 prompt
  const systemPrompt = `你是一个专业的i18n翻译专家。你需要将${sourceLangInfo.name}文本翻译成${langInfo.name}。

翻译要求：
1. 保持专业、准确、自然的翻译
2. 保留文本中的变量占位符（如 {variable}）
3. 保持原文的语气和风格
4. 对于技术术语，使用标准译法
5. 返回的必须是有效的 JSON 对象

返回格式：JSON 对象，key 必须保持与输入一致的 i18n 标识符（不是原文内容），value 为译文。

示例：
输入：
{
  "common.确认删除吗": "确认删除吗？",
  "common.操作成功": "操作成功"
}

输出（注意 key 必须与输入完全一致）：
{
  "common.确认删除吗": "Are you sure you want to delete?",
  "common.操作成功": "Operation successful"
}`

  const inputData = {}
  for (const { key, text } of entries) {
    inputData[key] = text
  }

  const userPrompt = `请将以下${sourceLangInfo.name}文本翻译成${langInfo.name}：

${JSON.stringify(inputData, null, 2)}

请返回 JSON 格式的翻译结果：`

  try {
    const result = await callAIProvider([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ])

    // 解析 JSON 结果
    let cleanedResult = result.trim()
    // 移除 markdown 代码块
    cleanedResult = cleanedResult.replace(/^```(?:json)?\s*\n?/i, '')
    cleanedResult = cleanedResult.replace(/\n?```\s*$/i, '')

    let translations
    try {
      translations = JSON.parse(cleanedResult)
    } catch (parseError) {
      // 保存完整响应到临时文件以便排查
      const projectRoot = path.resolve(__dirname, '../..')
      const logDir = path.join(projectRoot, 'node_modules/.cache')
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }
      const errorLogPath = path.join(logDir, `translation-error-${Date.now()}.log`)
      try {
        const errorLog = {
          timestamp: new Date().toISOString(),
          targetLang,
          inputKeys: Object.keys(inputData),
          rawResponse: result,
          cleanedResponse: cleanedResult,
          error: parseError.message
        }
        fs.writeFileSync(errorLogPath, JSON.stringify(errorLog, null, 2), 'utf-8')
        console.error(`JSON 解析失败，错误日志已保存至: ${errorLogPath}`)
      } catch (logError) {
        console.error('JSON 解析失败，且无法保存错误日志:', logError.message)
      }
      console.error('API 返回内容（前 500 字符）:')
      console.error(cleanedResult.substring(0, 500))
      throw new Error(`无法解析翻译结果: ${parseError.message}`)
    }

    // 验证返回的 keys 是否完整
    const inputKeys = Object.keys(inputData)
    const missingKeys = inputKeys.filter((k) => !(k in translations))
    const validTranslations = {}

    // 对缺失的 key，如果有现有翻译就保留，否则抛出错误
    if (missingKeys.length > 0) {
      const missingWithoutFallback = []
      for (const key of missingKeys) {
        if (existingTranslations[key]) {
          // 有现有翻译，保留它
          validTranslations[key] = existingTranslations[key]
        } else {
          // 没有现有翻译，记录为失败
          missingWithoutFallback.push(key)
        }
      }

      // 如果有无法兜底的缺失 key，抛出错误
      if (missingWithoutFallback.length > 0) {
        throw new Error(
          `API 未返回 ${missingWithoutFallback.length} 个 key 的翻译且无现有翻译可用: ${missingWithoutFallback.slice(0, 5).join(', ')}${missingWithoutFallback.length > 5 ? '...' : ''}`
        )
      }
    }

    // 质量检查并保存结果
    for (const [key, translation] of Object.entries(translations)) {
      const originalText = inputData[key]
      if (originalText === undefined || originalText === null) {
        continue // 跳过不在输入中的 key
      }

      // 质量检查
      const validation = validateTranslation(originalText, translation)
      if (!validation.valid) {
        // 质量不合格的翻译
        if (existingTranslations[key]) {
          // 有现有翻译，保留它
          validTranslations[key] = existingTranslations[key]
        } else {
          // 没有现有翻译，抛出错误
          throw new Error(
            `翻译质量检查失败 [${key}]: ${validation.reason}\n` +
              `  原文: ${originalText}\n` +
              `  译文: ${translation}`
          )
        }
        continue
      }

      // 保存有效的翻译
      validTranslations[key] = translation
    }

    return validTranslations
  } catch (error) {
    console.error('批量翻译失败:', error.message)
    throw error
  }
}

/**
 * 翻译单个语言
 * @param {Record<string, string>} sourceData - 源语言数据
 * @param {string} targetLang - 目标语言
 * @param {Object} options - 配置选项
 * @param {boolean} options.force - 是否强制重新翻译
 * @returns {Promise<Record<string, string>>} 翻译结果
 */
async function translateLanguage(sourceData, targetLang, options = {}) {
  const { force = false } = options
  const config = useConfig()
  const languageMap = useLanguageMap()
  const translateConfig = useTranslateConfig()

  // 校验目标语言是否存在
  if (!languageMap[targetLang]) {
    throw new Error(
      `不支持的目标语言: ${targetLang}\n` + `支持的语言: ${Object.keys(languageMap).join(', ')}`
    )
  }

  const langInfo = languageMap[targetLang]

  console.log(`\n翻译到 ${langInfo.name} (${targetLang})...`)

  // 读取现有翻译（即使在 force 模式下也读取，作为失败时的兜底）
  const projectRoot = config.projectRoot
  const normalizedTargetLang = config.normalizeLocaleCode(targetLang)
  const targetDir = path.join(projectRoot, translateConfig.localesDir, normalizedTargetLang)
  const targetFilePath = path.join(targetDir, `${config.namespace}.json`)

  // 确保目标目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  let existingTranslations = {}
  if (fs.existsSync(targetFilePath)) {
    try {
      existingTranslations = JSON.parse(fs.readFileSync(targetFilePath, 'utf-8'))
      if (force) {
        console.log(`  已加载 ${Object.keys(existingTranslations).length} 条现有翻译作为兜底`)
      }
    } catch (error) {
      console.warn('警告: 读取现有翻译失败:', error.message)
    }
  }

  // 找出需要翻译的条目
  const toTranslate = []
  // 初始化 results：包含所有key，已有翻译的用现有值，未翻译的用空字符串
  const results = { ...existingTranslations }

  // 确保所有 sourceData 的 key 都存在于 results 中
  for (const key of Object.keys(sourceData)) {
    if (!(key in results)) {
      results[key] = ''
    }
  }

  for (const [key, text] of Object.entries(sourceData)) {
    const existingValue = existingTranslations[key]

    // 检查现有翻译是否需要重新翻译
    if (!needsTranslation(existingValue, text, { force })) {
      // 已有可用翻译 -> 保留（已在results中）
      continue
    }

    // 需要翻译（值为空、与中文原文相同、或 force 模式）
    toTranslate.push({ key, text })
  }

  if (toTranslate.length === 0) {
    console.log(`✓ 无需翻译，所有 ${Object.keys(sourceData).length} 条已存在`)
    // 即使不需要翻译，也要写入文件（可能目标文件不存在）
    fs.writeFileSync(targetFilePath, JSON.stringify(results, null, 2), 'utf-8')
    console.log(`✓ 文件已保存: ${targetFilePath}`)
    return results
  }

  console.log(`  需要翻译: ${toTranslate.length}/${Object.keys(sourceData).length} 条`)

  // 批量翻译
  const batches = []
  for (let i = 0; i < toTranslate.length; i += translateConfig.batchSize) {
    batches.push(toTranslate.slice(i, i + translateConfig.batchSize))
  }

  const progressStartTime = Date.now()
  let completed = 0
  const failedKeys = [] // 记录翻译失败的 key
  let progressRendered = false
  let maxProgressLineLength = 0
  let spinnerIndex = 0
  let spinnerTimer = null

  const getEtaText = (elapsed) => {
    if (completed === 0) return null
    const remaining = Math.max(toTranslate.length - completed, 0)
    if (remaining === 0) return null

    const averagePerItem = elapsed / completed
    if (!Number.isFinite(averagePerItem) || averagePerItem <= 0) return null

    return formatDuration(averagePerItem * remaining)
  }

  const renderProgressLine = ({ advanceFrame = false, finalIcon, withNewline = false } = {}) => {
    if (toTranslate.length === 0) return

    if (advanceFrame) {
      spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length
    }

    const icon = finalIcon || SPINNER_FRAMES[spinnerIndex]
    const progressText = formatProgressBar(completed, toTranslate.length)
    const elapsed = Date.now() - progressStartTime
    const infoParts = [`耗时 ${formatDuration(elapsed)}`]
    const eta = getEtaText(elapsed)

    if (eta) {
      infoParts.push(`剩余 ${eta}`)
    }

    const line = `  ${icon} 翻译进度: ${progressText} | ${infoParts.join(' | ')}`

    if (line.length > maxProgressLineLength) {
      maxProgressLineLength = line.length
    }

    const paddedLine = line.padEnd(maxProgressLineLength, ' ')

    if (withNewline) {
      process.stdout.write(`\r${paddedLine}\n`)
      progressRendered = false
      maxProgressLineLength = 0
      return
    }

    if (progressRendered) {
      process.stdout.write(`\r${paddedLine}`)
    } else {
      process.stdout.write(paddedLine)
      progressRendered = true
    }
  }

  const eraseProgressLine = () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer)
      spinnerTimer = null
    }

    if (!progressRendered) return

    const blankLine = ' '.repeat(maxProgressLineLength || 0)
    process.stdout.write(`\r${blankLine}\r`)
    progressRendered = false
    maxProgressLineLength = 0
  }

  const startSpinner = () => {
    if (spinnerTimer || toTranslate.length === 0) return

    renderProgressLine()
    spinnerTimer = setInterval(() => {
      renderProgressLine({ advanceFrame: true })
    }, SPINNER_INTERVAL)
  }

  const stopSpinner = ({ finalIcon } = {}) => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer)
      spinnerTimer = null
    }

    if (!progressRendered) return

    if (finalIcon) {
      renderProgressLine({ finalIcon, withNewline: true })
    } else {
      const blankLine = ' '.repeat(maxProgressLineLength || 0)
      process.stdout.write(`\r${blankLine}\r`)
      progressRendered = false
      maxProgressLineLength = 0
    }
  }

  for (const [index, batch] of batches.entries()) {
    try {
      eraseProgressLine()
      console.log(`  批次 ${index + 1}/${batches.length} (${batch.length} 条)...`)

      startSpinner()
      const translations = await batchTranslate(batch, targetLang, existingTranslations)

      for (const [key, translation] of Object.entries(translations)) {
        results[key] = translation
      }

      completed += batch.length
      renderProgressLine()

      // 每批次完成后立即保存，防止超时时丢失进度
      fs.writeFileSync(targetFilePath, JSON.stringify(results, null, 2), 'utf-8')

      // 批次间延迟（从配置读取）
      if (index < batches.length - 1) {
        await delay(translateConfig.batchDelay)
      }
    } catch (error) {
      eraseProgressLine()
      console.error(`  ✗ 批次 ${index + 1} 翻译失败:`, error.message)

      // 记录失败的 key
      for (const { key, text } of batch) {
        failedKeys.push({ key, text, error: error.message })
        // 使用现有翻译作为兜底（如果存在）
        if (existingTranslations[key]) {
          results[key] = existingTranslations[key]
        }
        // 如果没有现有翻译，则不写入（让用户明确知道这些 key 未翻译）
      }
    }
  }

  stopSpinner()

  // 如果有翻译失败，生成错误日志
  if (failedKeys.length > 0) {
    const errorLog = {
      timestamp: new Date().toISOString(),
      targetLang,
      totalFailed: failedKeys.length,
      totalAttempted: toTranslate.length,
      failureRate: `${((failedKeys.length / toTranslate.length) * 100).toFixed(1)}%`,
      failedKeys: failedKeys.map(({ key, text }) => ({
        key,
        chineseText: text
      })),
      errors: failedKeys.map(({ error }) => error).filter((v, i, a) => a.indexOf(v) === i) // 去重
    }

    const logFileName = `translation-failed-${targetLang}-${Date.now()}.json`
    const errorLogPath = writeTranslationLog(logFileName, errorLog)
    const summaryText = `翻译失败 ${failedKeys.length}/${toTranslate.length} 条`

    console.error(`\n${summaryText}`)
    if (errorLogPath) {
      console.error(`错误日志: ${errorLogPath}`)
      throw new Error(`${summaryText}，请检查错误日志:\n${errorLogPath}`)
    }

    console.error('错误日志写入失败，请检查终端告警。')
    throw new Error(`${summaryText}，错误日志写入失败，请查看终端输出。`)
  }

  // 最终验证：检查是否所有 key 都有翻译
  const missingTranslations = []
  for (const [key, text] of Object.entries(sourceData)) {
    if (!results[key]) {
      missingTranslations.push({ key, chineseText: text })
    }
  }

  if (missingTranslations.length > 0) {
    const logFileName = `translation-missing-${targetLang}-${Date.now()}.json`
    const errorLogPath = writeTranslationLog(logFileName, {
      timestamp: new Date().toISOString(),
      targetLang,
      totalMissing: missingTranslations.length,
      missingKeys: missingTranslations
    })

    const missingSummary = `翻译不完整: ${missingTranslations.length} 个 key 缺失翻译`
    const missingKeysPreview = missingTranslations
      .slice(0, 5)
      .map((m) => m.key)
      .join(', ')
    const previewSuffix = missingTranslations.length > 5 ? '...' : ''

    if (errorLogPath) {
      throw new Error(
        `${missingSummary}\n错误日志: ${errorLogPath}\n缺失的 keys: ${missingKeysPreview}${previewSuffix}`
      )
    }

    throw new Error(
      `${missingSummary}\n错误日志写入失败，请查看终端输出。\n缺失的 keys: ${missingKeysPreview}${previewSuffix}`
    )
  }

  renderProgressLine({ finalIcon: '✓', withNewline: true })

  // 保存翻译结果
  fs.writeFileSync(targetFilePath, JSON.stringify(results, null, 2), 'utf-8')
  console.log(`✓ 翻译完成: ${targetFilePath}`)

  return results
}

export async function translate(options = {}) {
  const config = options.config ?? getConfig()
  setTranslateContext(config)

  console.log('开始自动翻译...\n')

  if (!config.aiProvider?.apiKey) {
    throw new Error('未配置 AI 服务 API Key（aiProvider.apiKey）')
  }

  const force = options.force ?? false
  const languageMap = useLanguageMap()

  let targetLangs = options.targetLanguages
  if (!Array.isArray(targetLangs) || targetLangs.length === 0) {
    targetLangs = config.languages.targets.filter((lang) => lang !== config.languages.source)
  }

  for (const lang of targetLangs) {
    if (!languageMap[lang]) {
      throw new Error(
        `不支持的目标语言: ${lang}，支持的语言: ${Object.keys(languageMap).join(', ')}`
      )
    }
  }

  const sourceFilePath = config.getOutputPath(config.languages.source)
  if (!fs.existsSync(sourceFilePath)) {
    throw new Error(`源语言文件不存在: ${sourceFilePath}`)
  }

  const sourceData = JSON.parse(fs.readFileSync(sourceFilePath, 'utf-8'))

  const startTime = Date.now()
  const results = {}

  for (const targetLang of targetLangs) {
    results[targetLang] = await translateLanguage(sourceData, targetLang, { force })
  }

  const duration = (Date.now() - startTime) / 1000

  return {
    force,
    targetLangs,
    duration: Number(duration.toFixed(2)),
    results
  }
}
