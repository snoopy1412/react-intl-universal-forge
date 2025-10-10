export interface LocaleDefinition {
  localeKey: string
  locale: string
  label: string
}

export interface LocaleLabel {
  name: string
  code: string
}

export type LocaleLabelsMap = Record<string, LocaleLabel>

export type KeyGenerationStrategy = 'semantic' | 'hash' | 'ai'

export interface AICacheConfig {
  filePath: string
  ttl: number
  enabled: boolean
}

export interface AIKeyGenerationConfig {
  enabled: boolean
  batchSize: number
  fallbackToSemantic: boolean
  cache: AICacheConfig
}

export interface KeyGenerationConfig {
  strategy: KeyGenerationStrategy
  hashLength: number
  maxSemanticLength: number
  useTypePrefix: boolean
  ai: AIKeyGenerationConfig
}

export interface AIRequestOverrides {
  headers?: Record<string, string>
  body?: Record<string, unknown>
}

export interface AIProviderConfig {
  apiKey: string
  apiUrl: string
  model: string
  temperature: number
  maxTokens: number
  requestsPerMinute: number
  maxRetries: number
  request?: AIRequestOverrides
}

export interface TranslationBatchConfig {
  batchSize: number
  maxTokensPerRequest: number
  batchDelay: number
}

export interface LanguagesConfig {
  source: string
  targets: string[]
  map: LocaleLabelsMap
}

export interface ReportingConfig {
  topLevelWarningsPath?: string
}

export interface ForgePathsConfig {
  localesDir: string
  aiCache: string | null
  topLevelWarnings: string
}

export interface NormalizeLocaleOptions {
  absolute?: boolean
}

export interface ForgeI18nConfig {
  projectRoot: string
  aiProvider: AIProviderConfig
  languages: LanguagesConfig
  translation: TranslationBatchConfig
  keyGeneration: KeyGenerationConfig
  input: string[]
  ignore: string[]
  skipFunctionCalls: string[]
  localesDir: string
  namespace: string
  normalizeLocaleCode: (locale: string) => string
  getOutputPath: (locale: string, options?: NormalizeLocaleOptions) => string
  getOutputDetailPath: (locale: string, options?: NormalizeLocaleOptions) => string
  getOutputReportPath: (locale: string, options?: NormalizeLocaleOptions) => string
  reporting: ReportingConfig
  postCommands: string[]
  paths: ForgePathsConfig
  keyGenerationOverride?: unknown
}

export interface TranslationDetail {
  text: string
  context?: string
  interpolations?: string[]
}

export type TranslationValue = string | TranslationDetail

export type TranslationCollection = Record<string, TranslationValue>

export interface KeyCollision {
  key: string
  texts: string[]
}

export interface KeyReport {
  total: number
  byContext: Record<string, number>
  byType: Record<string, number>
  avgKeyLength: number
  longestKey: string
  shortestKey: string
}

export interface ExtractResult {
  filesProcessed: number
  changedFiles: string[]
  collisions: KeyCollision[]
  errors: Array<{ file: string; error: Error }>
  keyReport: KeyReport
}

export type LoggerLike = Pick<Console, 'log' | 'warn'>

export interface ExtractOptions {
  config?: ForgeI18nConfig
  cwd?: string
  logger?: LoggerLike
}

export interface TranslateOptions {
  config?: ForgeI18nConfig
  force?: boolean
  targetLanguages?: string[]
}

export interface TranslateResult {
  force: boolean
  targetLangs: string[]
  duration: number
}

export interface TransformStats {
  extracted: number
  dataConstants: number
  reusedKeys: number
  topLevelConstants: Array<{
    name?: string
    line?: number
    intlKey?: string
  }>
  aiGenerated?: number
  interpolations?: number
}

export interface TransformResult {
  code: string
  stats: TransformStats
}

export type TextType =
  | 'confirm'
  | 'error'
  | 'success'
  | 'action'
  | 'input'
  | 'label'
  | 'text'

export interface ExtractedContextInfo {
  area?: string
  componentName?: string
}

export interface KeyGenerationContext {
  filePath?: string
  fileType?: string
  textType?: TextType
  componentName?: string
  functionName?: string
}

export interface BatchKeyInput {
  text: string
  context?: KeyGenerationContext
  filePath?: string
  fileType?: string
}

export type GenerateKeyBatchInput = string | BatchKeyInput

export interface AICacheStats {
  total: number
  filePath: string | null
  enabled: boolean
  ttl: number
}

export type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[Key] extends ReadonlyArray<infer R>
      ? ReadonlyArray<DeepPartial<R>>
      : T[Key] extends object
        ? DeepPartial<T[Key]>
        : T[Key]
}

export type ForgeUserConfig = DeepPartial<Omit<
  ForgeI18nConfig,
  | 'projectRoot'
  | 'paths'
  | 'getOutputPath'
  | 'getOutputDetailPath'
  | 'getOutputReportPath'
  | 'normalizeLocaleCode'
>> & {
  normalizeLocaleCode?: (locale: string) => string
  postCommands?: string[]
}

export type ForgeConfigDefaults = Omit<
  ForgeI18nConfig,
  'projectRoot' | 'paths' | 'getOutputPath' | 'getOutputDetailPath' | 'getOutputReportPath'
> & {
  projectRoot?: string
  paths?: Partial<ForgePathsConfig>
}

export interface ForgeConfigEnv {
  command: string
  mode: string
}

export type ForgeConfigResult = ForgeUserConfig | Promise<ForgeUserConfig>

export type ForgeConfigFactory = (env: ForgeConfigEnv) => ForgeConfigResult

export type ForgeConfigInput = ForgeUserConfig | Promise<ForgeUserConfig> | ForgeConfigFactory
