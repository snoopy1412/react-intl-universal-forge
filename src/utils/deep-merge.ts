/**
 * 深度合并工具，仅处理普通对象与数组。
 * 目标：在不引入外部依赖的情况下合并配置。
 */

type PlainObject = Record<string, unknown>

export function deepMerge<T extends PlainObject, U extends PlainObject>(target: T, source: U): T & U {
  const targetObj: PlainObject = isPlainObject(target) ? target : {}
  const sourceObj: PlainObject = isPlainObject(source) ? source : {}

  const result: PlainObject = {}
  const keys = new Set([...Object.keys(targetObj), ...Object.keys(sourceObj)])

  for (const key of keys) {
    const targetValue = targetObj[key]
    const sourceValue = sourceObj[key]

    if (sourceValue === undefined) {
      result[key] = cloneDeep(targetValue)
      continue
    }

    if (targetValue === undefined) {
      result[key] = cloneDeep(sourceValue)
      continue
    }

    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      result[key] = deepMerge(targetValue, sourceValue)
      continue
    }

    result[key] = cloneDeep(sourceValue)
  }

  return result as T & U
}

function isPlainObject(value: unknown): value is PlainObject {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneDeep(item)) as unknown as T
  }
  if (isPlainObject(value)) {
    const clonedEntries: [string, unknown][] = Object.entries(value).map(([key, child]) => [
      key,
      cloneDeep(child)
    ])
    return Object.fromEntries(clonedEntries) as T
  }
  return value
}
