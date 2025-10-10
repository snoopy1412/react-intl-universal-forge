import { defineConfig } from 'react-intl-universal-forge/config'

export default defineConfig(({ command, mode }) => ({
  input: ['src/**/*.{ts,tsx,js,jsx,tsx}'],
  localesDir: 'locales',
  languages: {
    source: 'zh_CN',
    targets: ['zh_CN', 'en_US']
  },
  keyGeneration: {
    strategy: 'ai',
    ai: {
      enabled: true,
      fallbackToSemantic: true
    }
  },
  aiProvider: {
    apiKey: process.env.AI_PROVIDER_KEY ?? '',
    apiUrl:
      process.env.AI_PROVIDER_URL ?? 'https://api.openai.com/v1/chat/completions',
    model: process.env.AI_PROVIDER_MODEL ?? 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 1024,
    requestsPerMinute: 60,
    maxRetries: 2
  },
  reporting: {
    topLevelWarningsPath: `docs/${mode}-${command}-warnings.md`
  }
}))
