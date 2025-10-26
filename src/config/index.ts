import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { load as parseYaml } from 'js-yaml'

import { DEFAULT_CONFIG, DEFAULT_LANGUAGE_LABELS } from './defaults.js'
import { validateConfig } from './validation.js'
import { deepMerge } from '../utils/deep-merge.js'
import type {
  ForgeConfigDefaults,
  ForgeConfigEnv,
  ForgeConfigInput,
  ForgeI18nConfig,
  ForgePathsConfig,
  ForgeUserConfig,
  LanguagesConfig,
  LocaleLabelsMap
} from '../types.js'

const require = createRequire(import.meta.url)

const DEFAULT_CONFIG_FILES = [
  'forge-i18n.config.mjs',
  'forge-i18n.config.js',
  'forge-i18n.config.cjs',
  'forge-i18n.config.ts',
  'forge-i18n.config.mts',
  'forge-i18n.config.cts',
  'forge-i18n.config.yaml',
  'forge-i18n.config.yml',
  'forge-i18n.config.json'
]

let activeConfig: ForgeI18nConfig | null = null

export interface CreateConfigOptions {
  cwd?: string
}

export interface LoadConfigOptions extends CreateConfigOptions {
  configPath?: string
  command?: string
  mode?: string
}

export function createConfig(overrides: ForgeUserConfig = {}, options: CreateConfigOptions = {}): ForgeI18nConfig {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const merged = deepMerge(DEFAULT_CONFIG, overrides ?? {}) as ForgeConfigDefaults
  const languages = normalizeLanguages(merged.languages)

  const aiCachePath = merged.keyGeneration?.ai?.cache?.filePath
  const aiCacheEnabled = merged.keyGeneration?.ai?.cache?.enabled !== false

  const paths: ForgePathsConfig = {
    localesDir: path.resolve(cwd, merged.localesDir),
    aiCache: aiCachePath ? path.resolve(cwd, aiCachePath) : null,
    topLevelWarnings: path.resolve(
      cwd,
      merged.reporting?.topLevelWarningsPath ?? 'docs/i18n-top-level-warnings.md'
    )
  }

  const normalizeLocaleCode =
    typeof merged.normalizeLocaleCode === 'function'
      ? (locale: string) => merged.normalizeLocaleCode!(locale)
      : (locale: string) => normalizeLocale(locale)

  const getOutputPath = (locale: string, opts: { absolute?: boolean } = {}) =>
    resolveLocalePath(paths, cwd, normalizeLocaleCode, locale, `${merged.namespace}.json`, opts.absolute !== false)

  const getOutputDetailPath = (locale: string, opts: { absolute?: boolean } = {}) =>
    resolveLocalePath(
      paths,
      cwd,
      normalizeLocaleCode,
      locale,
      `${merged.namespace}.detail.json`,
      opts.absolute !== false
    )

  const getOutputReportPath = (locale: string, opts: { absolute?: boolean } = {}) =>
    resolveLocalePath(
      paths,
      cwd,
      normalizeLocaleCode,
      locale,
      `${merged.namespace}.report.json`,
      opts.absolute !== false
    )

  const postCommands = Array.isArray(merged.postCommands) ? [...merged.postCommands] : []

  const config: ForgeI18nConfig = {
    ...merged,
    languages,
    projectRoot: cwd,
    postCommands,
    paths,
    normalizeLocaleCode,
    getOutputPath,
    getOutputDetailPath,
    getOutputReportPath
  }

  const fallbackCachePath = path.resolve(cwd, '.forge-cache/i18n-ai-cache.json')
  config.keyGeneration.ai.cache.filePath = config.paths.aiCache ?? fallbackCachePath
  config.keyGeneration.ai.cache.enabled = aiCacheEnabled

  validateConfig(config)
  return config
}

export function setActiveConfig(config: ForgeI18nConfig): ForgeI18nConfig {
  activeConfig = config
  return activeConfig
}

export function getConfig(): ForgeI18nConfig {
  if (!activeConfig) {
    activeConfig = createConfig()
  }
  return activeConfig
}

export function resetConfig(): ForgeI18nConfig {
  activeConfig = createConfig()
  return activeConfig
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ForgeI18nConfig> {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const explicitPath = options.configPath ? path.resolve(cwd, options.configPath) : undefined
  const resolvedPath = resolveConfigPath(cwd, explicitPath)

  const env: ForgeConfigEnv = {
    command: options.command ?? 'load',
    mode: options.mode ?? process.env.NODE_ENV ?? 'development'
  }

  let fileConfig: ForgeConfigInput | undefined
  if (resolvedPath) {
    fileConfig = await readConfigFile(resolvedPath)
  }

  const resolvedUserConfig = await resolveConfigInput(fileConfig ?? {}, env)
  const config = createConfig(resolvedUserConfig, { cwd })
  setActiveConfig(config)
  return config
}

export function resolveConfigPath(cwd: string, explicitPath?: string): string | null {
  if (explicitPath) {
    if (fs.existsSync(explicitPath)) {
      return explicitPath
    }
    throw new Error(`找不到配置文件: ${explicitPath}`)
  }

  for (const name of DEFAULT_CONFIG_FILES) {
    const candidate = path.resolve(cwd, name)
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function normalizeLanguages(languages: ForgeUserConfig['languages'] | undefined): LanguagesConfig {
  const source = languages?.source || DEFAULT_CONFIG.languages.source

  const targetsInput = languages?.targets
  const providedTargets = Array.isArray(targetsInput)
    ? (targetsInput as Array<string | null | undefined>).filter(
        (code): code is string => typeof code === 'string' && code.trim().length > 0
      )
    : undefined

  const baseTargets =
    providedTargets && providedTargets.length > 0 ? providedTargets : DEFAULT_CONFIG.languages.targets

  const uniqueTargets: string[] = []
  const seen = new Set<string>()

  const pushTarget = (code: string | null | undefined) => {
    if (typeof code !== 'string') return
    const trimmed = code.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    uniqueTargets.push(trimmed)
  }

  pushTarget(source)
  for (const code of baseTargets) {
    pushTarget(code)
  }

  const userMap = (languages?.map ?? {}) as LocaleLabelsMap
  const map: LocaleLabelsMap = {}

  for (const code of uniqueTargets) {
    const definedLabel = userMap[code] ?? DEFAULT_LANGUAGE_LABELS[code]
    map[code] = {
      name: definedLabel?.name ?? code,
      code: definedLabel?.code ?? normalizeLocale(code)
    }
  }

  return {
    source,
    targets: uniqueTargets,
    map
  }
}

async function readConfigFile(configPath: string): Promise<ForgeConfigInput> {
  const ext = path.extname(configPath).toLowerCase()

  if (ext === '.json') {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ForgeUserConfig
  }

  if (ext === '.yaml' || ext === '.yml') {
    return parseYaml(fs.readFileSync(configPath, 'utf-8')) as ForgeUserConfig
  }

  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    const module = await import(pathToFileURL(configPath).href)
    return extractConfigExport(module)
  }

  if (ext === '.ts' || ext === '.mts' || ext === '.cts') {
    const exported = await loadTypeScriptConfig(configPath, ext === '.cts')
    return extractConfigExport(exported)
  }

  throw new Error(`不支持的配置文件扩展名: ${ext}`)
}

function extractConfigExport(moduleExport: unknown): ForgeConfigInput {
  let result = moduleExport

  if (result && typeof result === 'object' && 'default' in (result as Record<string, unknown>)) {
    result = (result as Record<string, unknown>).default
  }

  if (result && typeof result === 'object' && 'config' in (result as Record<string, unknown>)) {
    result = (result as Record<string, unknown>).config
  }

  return result as ForgeConfigInput
}

async function resolveConfigInput(
  input: ForgeConfigInput,
  env: ForgeConfigEnv
): Promise<ForgeUserConfig> {
  const maybePromise = (value: unknown): value is Promise<ForgeUserConfig> =>
    Boolean(value && typeof (value as Promise<ForgeUserConfig>).then === 'function')

  if (typeof input === 'function') {
    const result = (input as (env: ForgeConfigEnv) => ForgeConfigInput)(env)
    return resolveConfigInput(result, env)
  }

  if (maybePromise(input)) {
    const awaited = await input
    return resolveConfigInput(awaited, env)
  }

  if (!input || typeof input !== 'object') {
    throw new Error('配置文件必须导出对象、Promise 或返回对象的函数')
  }

  return input as ForgeUserConfig
}

async function loadTypeScriptConfig(configPath: string, isCommonJS: boolean): Promise<unknown> {
  let ts: typeof import('typescript')
  try {
    ts = await import('typescript')
  } catch (error) {
    throw new Error('加载 TypeScript 配置需要安装 "typescript" 依赖，请先执行 pnpm add typescript。')
  }

  const source = fs.readFileSync(configPath, 'utf-8')
  const compilerOptions: import('typescript').CompilerOptions = {
    module: isCommonJS ? ts.ModuleKind.CommonJS : ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.React
  }

  const transpiled = ts.transpileModule(source, {
    compilerOptions,
    fileName: configPath
  })

  const tempExt = isCommonJS ? '.cjs' : '.mjs'
  const tempPath = `${configPath}.${Date.now()}.tmp${tempExt}`

  fs.writeFileSync(tempPath, transpiled.outputText, 'utf-8')

  try {
    if (isCommonJS) {
      const required = require(tempPath)
      return required
    }
    const module = await import(pathToFileURL(tempPath).href)
    return module
  } finally {
    fs.rmSync(tempPath, { force: true })
  }
}

function resolveLocalePath(
  paths: ForgePathsConfig,
  projectRoot: string,
  normalizeLocaleCode: (locale: string) => string,
  locale: string,
  filename: string,
  absolute: boolean
): string {
  const normalized = normalizeLocaleCode(locale)
  const absolutePath = path.resolve(paths.localesDir, normalized, filename)
  if (absolute) {
    return absolutePath
  }
  return path.relative(projectRoot, absolutePath)
}

function normalizeLocale(locale: string): string {
  if (locale.includes('-')) return locale
  return locale.replace('_', '-')
}

export function defineConfig(config: ForgeConfigInput): ForgeConfigInput {
  return config
}
