import { DEFAULT_LOCALE_KEY, LOCALE_DEFINITIONS, LOCALE_LABELS, toLocale } from './locales.js'
import type { ForgeConfigDefaults, LocaleLabelsMap } from '../types.js'

const LANGUAGE_MAP = LOCALE_DEFINITIONS.reduce((acc, def) => {
  acc[def.localeKey] = {
    name: def.label,
    code: def.locale
  }
  return acc
}, {} as LocaleLabelsMap)

export const DEFAULT_CONFIG: ForgeConfigDefaults = {
  projectRoot: undefined,
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    apiUrl: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    temperature: 0.3,
    maxTokens: 2000,
    requestsPerMinute: 20,
    maxRetries: 3
  },
  languages: {
    source: DEFAULT_LOCALE_KEY,
    targets: LOCALE_DEFINITIONS.map((def) => def.localeKey),
    map: LANGUAGE_MAP
  },
  translation: {
    batchSize: 10,
    maxTokensPerRequest: 1000,
    batchDelay: 300
  },
  keyGeneration: {
    strategy: 'semantic',
    hashLength: 4,
    maxSemanticLength: 6,
    useTypePrefix: true,
    ai: {
      enabled: false,
      batchSize: 10,
      fallbackToSemantic: true,
      cache: {
        filePath: '.forge-cache/i18n-ai-cache.json',
        ttl: 30,
        enabled: true
      }
    }
  },
  input: ['src/**/*.{ts,tsx,js,jsx}'],
  ignore: [
    '**/node_modules/**',
    '**/locales/**',
    '**/*.d.ts',
    '**/*.test.{ts,tsx,js,jsx}',
    '**/*.spec.{ts,tsx,js,jsx}',
    '**/dist/**'
  ],
  skipFunctionCalls: ['console', 'require', 'import'],
  localesDir: 'locales',
  namespace: 'translation',
  normalizeLocaleCode(code) {
    return typeof code === 'string' ? toLocale(code).replace('_', '-') : code
  },
  reporting: {
    topLevelWarningsPath: 'docs/i18n-top-level-warnings.md'
  },
  postCommands: []
}

export const DEFAULT_LANGUAGE_LABELS = LOCALE_LABELS
