export { extract } from './core/extract.js'
export { translate } from './core/translate.js'
export type {
  ForgeI18nConfig,
  ForgeUserConfig,
  ExtractResult,
  TranslateOptions,
  TranslateResult,
  KeyCollision,
  KeyReport,
  TransformResult,
  TransformStats,
  TranslationCollection,
  TranslationDetail,
  TranslationValue,
  ForgeConfigEnv,
  ForgeConfigInput,
  ForgeConfigFactory
} from './types.js'

export {
  createConfig,
  loadConfig,
  getConfig,
  setActiveConfig,
  resetConfig,
  resolveConfigPath,
  defineConfig
} from './config/index.js'

export {
  generateKey,
  generateKeySync,
  detectKeyCollisions,
  generateKeyReport,
  identifyTextType,
  extractSemantic,
  extractContextInfo
} from './core/key-generator.js'
