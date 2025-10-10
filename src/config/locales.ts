import type { LocaleDefinition, LocaleLabelsMap } from '../types.js'

export const DEFAULT_LOCALE_KEY = 'zh_CN'

export const LOCALE_DEFINITIONS = Object.freeze([
  {
    localeKey: 'zh_CN',
    locale: 'zh-CN',
    label: '简体中文'
  },
  {
    localeKey: 'en_US',
    locale: 'en-US',
    label: 'English'
  }
]) as ReadonlyArray<LocaleDefinition>

export const LOCALE_LABELS = Object.freeze(
  LOCALE_DEFINITIONS.reduce((acc, def) => {
    acc[def.localeKey] = {
      name: def.label,
      code: def.locale
    }
    return acc
  }, {} as LocaleLabelsMap)
) as Readonly<LocaleLabelsMap>

export function toLocale(localeKey: string | null | undefined): string {
  if (!localeKey || typeof localeKey !== 'string') return 'zh-CN'
  const normalized = localeKey.replace('_', '-').trim()
  const match = LOCALE_DEFINITIONS.find((def) => def.localeKey === localeKey || def.locale === normalized)
  return match ? match.locale : normalized
}
