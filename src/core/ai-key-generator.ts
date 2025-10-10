import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { getConfig } from '../config/index.js'
import { generateSemanticKey } from './common-utils.js'
import type {
  AICacheStats,
  ForgeI18nConfig,
  KeyGenerationContext
} from '../types.js'

const RATE_LIMIT = {
  processing: false,
  lastRequestTime: 0
}

const AI_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)*$/

const PROMPT_RULES_BASE = [
  '1. key 必须是英文，使用 camelCase 格式',
  '2. 长度控制在 3-6 个单词内',
  '3. 要准确反映文本的核心语义'
]

interface PromptConfig {
  intro: string
  rules: string[]
  example: string
}

type PromptMode = 'single' | 'batch'

const SYSTEM_PROMPT_CONFIG: Record<PromptMode, PromptConfig> = {
  single: {
    intro:
      '你是一个 i18n key 命名专家。你的任务是根据中文文本和上下文信息，生成简洁、语义化的英文 key。',
    rules: [
      ...PROMPT_RULES_BASE,
      '4. 考虑上下文信息，使 key 更具体',
      '5. 对于常见操作词，使用标准缩写：confirm（确认）、delete（删除）、save（保存）、cancel（取消）等',
      '6. 只返回 key 本身，不要有任何其他内容'
    ],
    example: `示例：\n- "确认删除吗？" → confirmDelete\n- "保存成功" → saveSuccess\n- "请输入用户名" → inputUsername\n- "导出报告" → exportReport`
  },
  batch: {
    intro:
      '你是一个 i18n key 命名专家。我会给你一批中文文本，你需要为每个文本生成一个简洁、语义化的英文 key。',
    rules: [...PROMPT_RULES_BASE, '4. 对于常见操作词，使用标准缩写', '5. 以 JSON 数组格式返回，每个 key 对应一个文本'],
    example: `格式示例：\n输入：["确认删除吗？", "保存成功", "请输入用户名"]\n输出：["confirmDelete", "saveSuccess", "inputUsername"]`
  }
}

function buildSystemPrompt(mode: PromptMode = 'single'): string {
  const config = SYSTEM_PROMPT_CONFIG[mode] ?? SYSTEM_PROMPT_CONFIG.single
  return `${config.intro}\n\n规则：\n${config.rules.join('\n')}\n\n${config.example}`
}

function sanitizeAIKey(rawKey: unknown): string {
  if (typeof rawKey !== 'string') return ''

  let key = rawKey.trim()
  if (!key) return ''

  key = key.replace(/[`'"“”‘’]/g, '')
  key = key.replace(/\{\{|\}\}/g, ' ')
  key = key.replace(/[\[\]()]/g, ' ')
  key = key.replace(/([a-z])([A-Z])/g, '$1 $2')

  const segments = key
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)

  if (segments.length === 0) return ''

  const normalized = segments
    .map((segment, index) => {
      const cleaned = segment.replace(/[^a-zA-Z0-9]/g, '')
      if (!cleaned) return ''
      const lower = cleaned.toLowerCase()
      if (index === 0) {
        return lower
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
    .replace(/^[^a-zA-Z]+/, '')

  if (!normalized) return ''

  return normalized.charAt(0).toLowerCase() + normalized.slice(1)
}

function isValidAIKey(key: string): boolean {
  return typeof key === 'string' && AI_KEY_PATTERN.test(key) && key.length >= 3 && key.length <= 60
}

function normalizeAIKey(rawKey: unknown): { sanitized: string; valid: boolean } {
  const sanitized = sanitizeAIKey(rawKey)
  return { sanitized, valid: isValidAIKey(sanitized) }
}

export function buildSafeFallbackKey(text: string, config: ForgeI18nConfig = getConfig()): string {
  const fallback = generateSemanticKey(
    text,
    config.keyGeneration.hashLength,
    config.keyGeneration.maxSemanticLength,
    true
  )
  const { sanitized, valid } = normalizeAIKey(fallback)
  if (valid) return sanitized

  const hash = crypto.createHash('md5').update(text).digest('hex').substring(0, config.keyGeneration.hashLength)
  return `auto${hash}`
}

interface CacheEntry {
  key: string
  timestamp: number
}

type CacheStore = Record<string, CacheEntry>

class CacheManager {
  private cache: CacheStore | null = null
  private cacheFilePath: string | null = null

  private get activeConfig(): ForgeI18nConfig {
    return getConfig()
  }

  private getCacheFilePath(): string | null {
    const config = this.activeConfig
    const newPath = config.keyGeneration.ai.cache.filePath
    if (this.cacheFilePath !== newPath) {
      this.cacheFilePath = newPath
      this.cache = null
    }
    return this.cacheFilePath
  }

  private ensureCache(): CacheStore {
    if (this.cache !== null) {
      return this.cache
    }

    const config = this.activeConfig
    if (!config.keyGeneration.ai.cache.enabled) {
      this.cache = {}
      return this.cache
    }

    try {
      const filePath = this.getCacheFilePath()
      if (filePath && fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, CacheEntry | string>
        this.cache = this.cleanExpiredCache(data, config)
      } else {
        this.cache = {}
      }
    } catch (error) {
      if (error instanceof Error) {
        console.warn('警告: 加载缓存失败:', error.message)
      }
      this.cache = {}
    }

    return this.cache
  }

  private cleanExpiredCache(data: Record<string, CacheEntry | string>, config: ForgeI18nConfig): CacheStore {
    const ttl = config.keyGeneration.ai.cache.ttl
    if (ttl === 0) {
      const normalized = Object.entries(data).reduce<CacheStore>((acc, [key, value]) => {
        acc[key] =
          typeof value === 'object' && value !== null && 'key' in value
            ? (value as CacheEntry)
            : { key: String(value), timestamp: Date.now() }
        return acc
      }, {})
      return normalized
    }

    const now = Date.now()
    const ttlMs = ttl * 24 * 60 * 60 * 1000
    const cleaned: CacheStore = {}

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null && 'timestamp' in value) {
        if (now - (value.timestamp ?? 0) < ttlMs) {
          cleaned[key] = {
            key: (value as CacheEntry).key,
            timestamp: value.timestamp
          }
        }
      } else {
        cleaned[key] = { key: String(value), timestamp: now }
      }
    }

    return cleaned
  }

  private saveCache(): void {
    const config = this.activeConfig

    if (!config.keyGeneration.ai.cache.enabled) return

    try {
      const filePath = this.getCacheFilePath()
      if (!filePath) return

      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(filePath, JSON.stringify(this.cache ?? {}, null, 2), 'utf-8')
    } catch (error) {
      if (error instanceof Error) {
        console.warn('警告: 保存缓存失败:', error.message)
      }
    }
  }

  private getCacheKey(text: string, context: KeyGenerationContext): string {
    return `${text}|${JSON.stringify(context)}`
  }

  get(text: string, context: KeyGenerationContext): string | null {
    const cache = this.ensureCache()
    const key = this.getCacheKey(text, context)
    const value = cache[key]

    if (!value) {
      return null
    }

    const { sanitized, valid } = normalizeAIKey(value.key)
    if (valid) {
      if (sanitized !== value.key) {
        console.warn(`警告: 缓存命中非规范 key，已规范化: "${value.key}" → "${sanitized}"`)
      }
      return sanitized
    }

    console.warn(`警告: 缓存命中非法 key，已忽略: "${value.key}"`)
    return null
  }

  set(text: string, context: KeyGenerationContext, key: string): void {
    const cache = this.ensureCache()
    const cacheKey = this.getCacheKey(text, context)
    const { sanitized, valid } = normalizeAIKey(key)

    if (!valid) {
      console.warn(`警告: 跳过缓存非法 key: "${key}"`)
      return
    }

    cache[cacheKey] = {
      key: sanitized,
      timestamp: Date.now()
    }

    this.saveCache()
  }

  clear(): void {
    this.cache = {}
    this.saveCache()
  }

  getStats(): AICacheStats {
    const config = this.activeConfig
    const cache = this.ensureCache()
    return {
      total: Object.keys(cache).length,
      filePath: this.getCacheFilePath(),
      enabled: config.keyGeneration.ai.cache.enabled,
      ttl: config.keyGeneration.ai.cache.ttl
    }
  }
}

const cacheManager = new CacheManager()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function rateLimitedFetch(
  url: string,
  options: RequestInit,
  config: ForgeI18nConfig,
  retries = config.aiProvider.maxRetries
): Promise<Response> {
  const now = Date.now()
  const timeSinceLastRequest = now - RATE_LIMIT.lastRequestTime
  const perMinute = Math.max(config.aiProvider.requestsPerMinute, 1)
  const minInterval = (60 * 1000) / perMinute

  if (timeSinceLastRequest < minInterval) {
    await delay(minInterval - timeSinceLastRequest)
  }

  RATE_LIMIT.lastRequestTime = Date.now()

  for (let index = 0; index < retries; index += 1) {
    try {
      const response = await fetch(url, options)

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') ?? '60', 10)
        console.warn(`警告: 触发速率限制，等待 ${retryAfter} 秒后重试...`)
        await delay(retryAfter * 1000)
        continue
      }

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`API 错误 ${response.status}: ${error}`)
      }

      return response
    } catch (error) {
      if (index === retries - 1) {
        throw error
      }
      if (error instanceof Error) {
        console.warn(`警告: 请求失败，${retries - index - 1} 次重试剩余: ${error.message}`)
      }
      await delay(Math.pow(2, index) * 1000)
    }
  }

  throw new Error('未知错误: rateLimitedFetch 未返回响应')
}

interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

type ChatRequestOptions = Record<string, unknown>

async function callAIProvider(
  messages: ChatMessage[],
  options: ChatRequestOptions = {},
  config: ForgeI18nConfig = getConfig()
): Promise<string> {
  const provider = config.aiProvider

  const bodyPayload = {
    model: provider.model,
    messages,
    temperature: options.temperature ?? provider.temperature,
    max_tokens:
      options.max_tokens ?? config.translation?.maxTokensPerRequest ?? provider.maxTokens,
    ...provider.request?.body,
    ...options
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
    ...(provider.request?.headers || {})
  }

  const response = await rateLimitedFetch(
    provider.apiUrl,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload)
    },
    config
  )

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content ?? ''
}

export async function generateAIKey(
  text: string,
  context: KeyGenerationContext = {},
  config: ForgeI18nConfig = getConfig()
): Promise<string> {
  if (!config.keyGeneration.ai.enabled) {
    throw new Error('未启用 AI Key 生成')
  }

  const cachedKey = cacheManager.get(text, context)
  if (cachedKey) {
    return cachedKey
  }

  const { filePath = '', componentName = '', functionName = '', textType = 'text' } = context

  const systemPrompt = buildSystemPrompt('single')

  const userPrompt = `文本: ${text}
文本类型: ${textType}
${componentName ? `组件名: ${componentName}` : ''}
${functionName ? `函数名: ${functionName}` : ''}
${filePath ? `文件路径: ${filePath}` : ''}

请生成一个语义化的 i18n key:`

  const result = await callAIProvider(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    {},
    config
  )

  const { sanitized, valid } = normalizeAIKey(result)

  if (valid) {
    cacheManager.set(text, context, sanitized)
    return sanitized
  }

  if (config.keyGeneration.ai.fallbackToSemantic) {
    const fallback = buildSafeFallbackKey(text, config)
    cacheManager.set(text, context, fallback)
    return fallback
  }

  throw new Error(`AI 未返回有效 key: ${result}`)
}

interface BatchInput {
  text: string
  context: KeyGenerationContext
  index: number
}

export async function generateAIKeysBatch(
  items: Array<{ text: string; context: KeyGenerationContext }>,
  config: ForgeI18nConfig = getConfig()
): Promise<string[]> {
  if (!config.keyGeneration.ai.enabled) {
    throw new Error('未启用 AI Key 生成')
  }

  const uncachedItems: BatchInput[] = []
  const cachedResults: string[] = []

  items.forEach((item, index) => {
    const cached = cacheManager.get(item.text, item.context ?? {})
    if (cached) {
      cachedResults[index] = cached
    } else {
      uncachedItems.push({ ...item, index })
    }
  })

  if (uncachedItems.length === 0) {
    return cachedResults
  }

  const systemPrompt = buildSystemPrompt('batch')
  const inputPayload = uncachedItems.map((item) => ({
    text: item.text,
    context: item.context ?? {}
  }))

  const userPrompt = `以下是待生成 key 的文本列表，请返回等长的 key 数组，顺序必须对应：
${JSON.stringify(inputPayload, null, 2)}`

  const rawResult = await callAIProvider(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    {},
    config
  )

  let parsed: unknown = []
  try {
    parsed = JSON.parse(rawResult)
  } catch (error) {
    if (error instanceof Error) {
      console.warn('警告: 无法解析 AI 返回结果，改用逐条生成。', error.message)
    }
    parsed = []
  }

  const results = [...cachedResults]

  for (const item of uncachedItems) {
    const aiKey = Array.isArray(parsed) ? parsed[item.index] : undefined
    const { sanitized, valid } = normalizeAIKey(aiKey)
    if (valid) {
      cacheManager.set(item.text, item.context ?? {}, sanitized)
      results[item.index] = sanitized
    } else if (config.keyGeneration.ai.fallbackToSemantic) {
      const fallback = buildSafeFallbackKey(item.text, config)
      cacheManager.set(item.text, item.context ?? {}, fallback)
      results[item.index] = fallback
    } else {
      throw new Error(`AI 未返回有效 key: ${aiKey}`)
    }
  }

  return results
}

export function getAICacheStats(): AICacheStats {
  return cacheManager.getStats()
}
