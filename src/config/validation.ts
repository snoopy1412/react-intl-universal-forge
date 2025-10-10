import path from 'node:path'
import type { ForgeI18nConfig } from '../types.js'

const VALID_STRATEGIES = ['semantic', 'hash', 'ai']
const UNDERSCORE_PATTERN = /^[a-z]{2}_[A-Z]{2}$/
const HYPHEN_PATTERN = /^[a-z]{2}-[A-Z]{2}$/

export function validateConfig(config: ForgeI18nConfig): true {
  if (!config || typeof config !== 'object') {
    throw new Error('配置错误: config 不能为空')
  }

  const { languages, keyGeneration, input, aiProvider } = config

  if (!languages || !languages.source || !Array.isArray(languages.targets)) {
    throw new Error('配置错误: languages 配置无效')
  }

  if (!languages.targets.includes(languages.source)) {
    throw new Error(`配置错误: 源语言 ${languages.source} 必须包含在目标语言列表中`)
  }

  const invalidCodes = languages.targets.filter(
    (code) => !UNDERSCORE_PATTERN.test(code) && !HYPHEN_PATTERN.test(code)
  )
  if (invalidCodes.length > 0) {
    throw new Error(
      `配置错误: 语言代码格式不正确: ${invalidCodes.join(', ')}，应使用 zh_CN / zh-CN 等格式`
    )
  }

  if (keyGeneration.hashLength < 4 || keyGeneration.hashLength > 8) {
    throw new Error(`配置错误: hashLength 必须在 4-8 之间`)
  }

  if (keyGeneration.maxSemanticLength < 4 || keyGeneration.maxSemanticLength > 12) {
    throw new Error(`配置错误: maxSemanticLength 必须在 4-12 之间`)
  }

  if (!VALID_STRATEGIES.includes(keyGeneration.strategy)) {
    throw new Error(`配置错误: strategy 必须是 ${VALID_STRATEGIES.join('/')} 之一`)
  }

  if (keyGeneration.strategy === 'ai' && keyGeneration.ai.enabled) {
    if (keyGeneration.ai.batchSize < 1 || keyGeneration.ai.batchSize > 50) {
      throw new Error('配置错误: ai.batchSize 必须在 1-50 之间')
    }
    if (!aiProvider?.apiKey) {
      throw new Error('配置错误: 启用 AI 策略时必须提供 aiProvider.apiKey')
    }
  }

  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('配置错误: input 必须是非空数组')
  }

  if (typeof config.getOutputPath !== 'function') {
    throw new Error('配置错误: getOutputPath 方法不存在')
  }

  const samplePath = config.getOutputPath(languages.source, { absolute: true })
  if (typeof samplePath !== 'string' || samplePath.trim().length === 0) {
    throw new Error('配置错误: getOutputPath 返回值无效')
  }

  if (!path.isAbsolute(samplePath)) {
    throw new Error('配置错误: getOutputPath 必须返回绝对路径')
  }

  return true
}
