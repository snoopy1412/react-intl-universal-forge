import crypto from 'node:crypto'

import { getConfig, setActiveConfig } from '../config/index.js'
import { generateAIKey, generateAIKeysBatch, buildSafeFallbackKey } from './ai-key-generator.js'
import { identifyTextType, extractSemantic, extractContextInfo } from './common-utils.js'
import type {
  ForgeI18nConfig,
  GenerateKeyBatchInput,
  KeyCollision,
  KeyGenerationContext,
  KeyReport,
  TranslationCollection
} from '../types.js'

export { identifyTextType, extractSemantic, extractContextInfo } from './common-utils.js'

interface NormalizedBatchItem {
  text: string
  context: KeyGenerationContext
}

function normalizeBatchItemInput(item: GenerateKeyBatchInput): NormalizedBatchItem {
  if (typeof item === 'string') {
    return {
      text: item,
      context: {
        textType: identifyTextType(item)
      }
    }
  }

  if (item && typeof item === 'object' && typeof item.text === 'string') {
    const normalizedContext: KeyGenerationContext = { ...(item.context ?? {}) }

    if (item.filePath && normalizedContext.filePath === undefined) {
      normalizedContext.filePath = item.filePath
    }
    if (item.fileType && normalizedContext.fileType === undefined) {
      normalizedContext.fileType = item.fileType
    }
    if (!normalizedContext.textType) {
      normalizedContext.textType = identifyTextType(item.text)
    }

    return {
      text: item.text,
      context: normalizedContext
    }
  }

  throw new Error('generateKeysBatch 需要字符串或包含 text 字段的对象')
}

export async function generateKey(
  text: string,
  context = 'common',
  aiContext: KeyGenerationContext = {},
  config: ForgeI18nConfig = getConfig()
): Promise<string> {
  setActiveConfig(config)
  const { strategy, hashLength, maxSemanticLength, useTypePrefix, ai } = config.keyGeneration

  if (strategy === 'ai' && ai.enabled) {
    try {
      const textType = identifyTextType(text)
      const pathContext = aiContext.filePath ? extractContextInfo(aiContext.filePath) : {}
      const fullContext: KeyGenerationContext = {
        textType,
        ...pathContext,
        ...aiContext
      }

      const aiKey = await generateAIKey(text, fullContext, config)

      if (aiKey) {
        return `${context}.${aiKey}`
      }
    } catch (error) {
      if (error instanceof Error && ai.fallbackToSemantic) {
        console.warn(`警告: AI 生成异常，降级到语义化策略。原因: ${error.message}`)
      } else {
        throw error
      }
    }

    if (ai.fallbackToSemantic) {
      const fallbackKey = `${context}.${buildSafeFallbackKey(text, config)}`
      console.log(`   → 降级生成: ${fallbackKey}`)
      return fallbackKey
    }
  }

  return buildSemanticKey(text, context, hashLength, maxSemanticLength, useTypePrefix, config)
}

function buildSemanticKey(
  text: string,
  context: string,
  hashLength: number,
  maxSemanticLength: number,
  useTypePrefix: boolean,
  config: ForgeI18nConfig
): string {
  const hash = crypto.createHash('md5').update(text).digest('hex').substring(0, hashLength)

  if (config.keyGeneration.strategy === 'hash') {
    return `${context}.${hash}`
  }

  let semantic = extractSemantic(text, maxSemanticLength)

  if (useTypePrefix) {
    const typePrefix = identifyTextType(text)
    semantic = `${typePrefix}.${semantic}`
  }

  return `${context}.${semantic}_${hash}`
}

export function generateKeySync(
  text: string,
  context = 'common',
  config: ForgeI18nConfig = getConfig()
): string {
  setActiveConfig(config)
  const { hashLength, maxSemanticLength, useTypePrefix } = config.keyGeneration
  if (config.keyGeneration.strategy === 'ai' && config.keyGeneration.ai.enabled) {
    const fallback = buildSafeFallbackKey(text, config)
    return `${context}.${fallback}`
  }
  return buildSemanticKey(text, context, hashLength, maxSemanticLength, useTypePrefix, config)
}

export function detectKeyCollisions(translations: TranslationCollection): KeyCollision[] {
  const collisions: KeyCollision[] = []
  const keyToTexts: Record<string, string[]> = {}

  for (const [key, value] of Object.entries(translations)) {
    const text = typeof value === 'string' ? value : value.text
    const bucket = keyToTexts[key] ?? []
    bucket.push(text)
    keyToTexts[key] = bucket
  }

  for (const [key, texts] of Object.entries(keyToTexts)) {
    if (texts.length > 1) {
      collisions.push({ key, texts })
    }
  }

  return collisions
}

export function generateKeyReport(translations: TranslationCollection): KeyReport {
  const report: KeyReport = {
    total: Object.keys(translations).length,
    byContext: {},
    byType: {},
    avgKeyLength: 0,
    longestKey: '',
    shortestKey: ''
  }

  if (report.total === 0) {
    return report
  }

  let totalLength = 0
  let longest = ''
  let shortest: string | null = null

  for (const key of Object.keys(translations)) {
    totalLength += key.length
    if (key.length > longest.length) longest = key
    if (shortest === null || key.length < shortest.length) shortest = key

    const [context] = key.split('.')
    report.byContext[context] = (report.byContext[context] || 0) + 1

    const parts = key.split('.')
    if (parts.length >= 2) {
      const type = parts[1].split('_')[0]
      report.byType[type] = (report.byType[type] || 0) + 1
    }
  }

  report.avgKeyLength = report.total > 0 ? Math.round(totalLength / report.total) : 0
  report.longestKey = longest
  report.shortestKey = shortest ?? ''

  return report
}

export async function generateKeysBatch(
  items: GenerateKeyBatchInput[],
  context = 'common',
  config: ForgeI18nConfig = getConfig()
): Promise<string[]> {
  setActiveConfig(config)
  const normalizedItems = items.map(normalizeBatchItemInput)

  if (config.keyGeneration.strategy !== 'ai' || !config.keyGeneration.ai.enabled) {
    return Promise.all(
      normalizedItems.map(({ text, context: aiContext }) => generateKey(text, context, aiContext, config))
    )
  }

  const keys = await generateAIKeysBatch(normalizedItems, config)
  return keys.map((key) => `${context}.${key}`)
}
