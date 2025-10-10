import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createConfig, resetConfig } from '../dist/config/index.js'
import { translate } from '../dist/core/translate.js'

const SHOULD_CLEAN_FIXTURE = process.env.KEEP_I18N_FIXTURE !== '1'

const TMP_ROOT = (() => {
  if (process.env.I18N_TEST_TMP_DIR) {
    const dir = path.resolve(process.cwd(), process.env.I18N_TEST_TMP_DIR)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }
  return os.tmpdir()
})()

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(TMP_ROOT, prefix))
}

function cleanupTempDir(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return
  if (SHOULD_CLEAN_FIXTURE) {
    fs.rmSync(dirPath, { recursive: true, force: true })
  } else {
    console.log(`测试保留临时目录: ${dirPath}`)
  }
}

const BASE_PROVIDER = Object.freeze({
  apiKey: 'test-key',
  apiUrl: 'https://fake.ai-provider.local/v1/chat/completions',
  model: 'mock-model',
  temperature: 0.3,
  maxTokens: 1024,
  requestsPerMinute: 60000,
  maxRetries: 1
})

function buildProvider(overrides = {}) {
  return { ...BASE_PROVIDER, ...overrides }
}

test('translate 在缺少 AI API key 时抛出明确错误', async (t) => {
  t.after(() => {
    resetConfig()
  })

  const config = createConfig({
    aiProvider: buildProvider({ apiKey: '' })
  })

  await assert.rejects(
    async () => translate({ config }),
    /未配置 AI 服务 API Key/,
    '缺少 API key 时必须直接抛错避免静默失败'
  )
})

test('translate 仅翻译缺失条目并保留已有译文', async (t) => {
  const tempDir = createTempDir('forge-translate-')
  const originalFetch = global.fetch
  const fetchCalls = []

  t.after(() => {
    global.fetch = originalFetch
    resetConfig()
    cleanupTempDir(tempDir)
  })

  const config = createConfig(
    {
      localesDir: 'locales',
      languages: {
        source: 'zh_CN',
        targets: ['zh_CN', 'en_US']
      },
      translation: {
        batchSize: 5,
        batchDelay: 0,
        maxTokensPerRequest: 1000
      },
      aiProvider: buildProvider({ apiUrl: 'https://fake.ai.local' })
    },
    { cwd: tempDir }
  )

  const zhPath = config.getOutputPath('zh_CN')
  fs.mkdirSync(path.dirname(zhPath), { recursive: true })
  const sourceData = {
    'common.confirm.delete': '确认删除吗？',
    'common.action.save': '保存',
    'common.status.running': '运行中'
  }
  fs.writeFileSync(zhPath, JSON.stringify(sourceData, null, 2), 'utf-8')

  const enPath = config.getOutputPath('en_US')
  fs.mkdirSync(path.dirname(enPath), { recursive: true })
  const existingEn = {
    'common.status.running': 'Running',
    'common.confirm.delete': ''
  }
  fs.writeFileSync(enPath, JSON.stringify(existingEn, null, 2), 'utf-8')

  global.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body)
    const userMessage = payload.messages.find((item) => item.role === 'user')?.content || ''
    const jsonMatch = userMessage.match(/\{[\s\S]+\}/m)

    let requested = {}
    if (jsonMatch) {
      requested = JSON.parse(jsonMatch[0])
    }

    fetchCalls.push(Object.keys(requested))

    const translated = Object.fromEntries(
      Object.entries(requested).map(([key, value]) => [key, `en:${value}`])
    )

    return {
      ok: true,
      status: 200,
      headers: {
        get() {
          return null
        }
      },
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(translated)
            }
          }
        ]
      })
    }
  }

  const result = await translate({ config })

  assert.equal(fetchCalls.length, 1, '翻译过程应按批次调用一次 API')
  assert.deepEqual(
    fetchCalls[0].sort(),
    ['common.action.save', 'common.confirm.delete'].sort(),
    '仅缺失或空的条目需要翻译'
  )

  const enData = JSON.parse(fs.readFileSync(enPath, 'utf-8'))
  assert.equal(enData['common.status.running'], 'Running', '已有翻译应原样保留')
  assert.equal(enData['common.confirm.delete'], 'en:确认删除吗？', '空值应被替换为新翻译')
  assert.equal(enData['common.action.save'], 'en:保存', '缺失条目应新增翻译')
  assert.deepEqual(result.results.en_US, enData, '返回结果应与最终文件保持一致')
})

test('translate 遇到占位符缺失时保留已有译文作为兜底', async (t) => {
  const tempDir = createTempDir('forge-translate-placeholder-')
  const originalFetch = global.fetch

  t.after(() => {
    global.fetch = originalFetch
    resetConfig()
    cleanupTempDir(tempDir)
  })

  const config = createConfig(
    {
      localesDir: 'locales',
      languages: {
        source: 'zh_CN',
        targets: ['zh_CN', 'en_US']
      },
      translation: {
        batchSize: 5,
        batchDelay: 0,
        maxTokensPerRequest: 1000
      },
      aiProvider: buildProvider({ apiUrl: 'https://fake.ai.local' })
    },
    { cwd: tempDir }
  )

  const zhPath = config.getOutputPath('zh_CN')
  fs.mkdirSync(path.dirname(zhPath), { recursive: true })
  const sourceData = {
    'common.greeting': '欢迎回来，{value0}',
    'common.notification': '操作成功'
  }
  fs.writeFileSync(zhPath, JSON.stringify(sourceData, null, 2), 'utf-8')

  const enPath = config.getOutputPath('en_US')
  fs.mkdirSync(path.dirname(enPath), { recursive: true })
  const existingEn = {
    'common.greeting': 'Welcome back, {value0}'
  }
  fs.writeFileSync(enPath, JSON.stringify(existingEn, null, 2), 'utf-8')

  global.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body)
    const userMessage = payload.messages.find((item) => item.role === 'user')?.content || ''
    const requested = JSON.parse(userMessage.match(/\{[\s\S]+\}/m)[0])

    const translated = {
      'common.greeting': 'Welcome back!', // 缺少占位符，应回退到已有翻译
      'common.notification': 'Operation successful'
    }

    return {
      ok: true,
      status: 200,
      headers: {
        get() {
          return null
        }
      },
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(
                Object.fromEntries(
                  Object.keys(requested).map((key) => [key, translated[key]])
                )
              )
            }
          }
        ]
      })
    }
  }

  await translate({ config })

  const enData = JSON.parse(fs.readFileSync(enPath, 'utf-8'))
  assert.equal(
    enData['common.greeting'],
    'Welcome back, {value0}',
    '占位符不完整时应保留原有翻译'
  )
  assert.equal(
    enData['common.notification'],
    'Operation successful',
    '其余条目仍应写入新翻译'
  )
})

test('translate 遇到占位符缺失且无兜底时抛出错误', async (t) => {
  const tempDir = createTempDir('forge-translate-missing-placeholder-')
  const originalFetch = global.fetch

  t.after(() => {
    global.fetch = originalFetch
    resetConfig()
    cleanupTempDir(tempDir)
  })

  const config = createConfig(
    {
      localesDir: 'locales',
      languages: {
        source: 'zh_CN',
        targets: ['zh_CN', 'en_US']
      },
      translation: {
        batchSize: 5,
        batchDelay: 0,
        maxTokensPerRequest: 1000
      },
      aiProvider: buildProvider({ apiUrl: 'https://fake.ai.local' })
    },
    { cwd: tempDir }
  )

  const zhPath = config.getOutputPath('zh_CN')
  fs.mkdirSync(path.dirname(zhPath), { recursive: true })
  const sourceData = {
    'common.greeting': '欢迎回来，{value0}'
  }
  fs.writeFileSync(zhPath, JSON.stringify(sourceData, null, 2), 'utf-8')

  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get() {
        return null
      }
    },
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              'common.greeting': 'Welcome back!'
            })
          }
        }
      ]
    })
  })

  let error = null
  try {
    await translate({ config })
    assert.fail('缺少占位符且无兜底翻译时应抛出错误提醒')
  } catch (err) {
    error = err
  }

  assert.ok(error)
  assert.match(
    error.message,
    /翻译失败 \d+\/\d+ 条/,
    '应提示翻译失败并包含失败数量'
  )

  const logMatch = error.message.match(/([^\s]*translation-failed-[^ \n]+)/)
  if (logMatch) {
    const logFilePath = path.resolve(process.cwd(), logMatch[1])
    if (fs.existsSync(logFilePath)) {
      fs.rmSync(logFilePath, { force: true })
    }
  }
})

test('translate 在 force 模式下会重新翻译已有条目', async (t) => {
  const tempDir = createTempDir('forge-translate-force-')
  const originalFetch = global.fetch
  const fetchKeys = []

  t.after(() => {
    global.fetch = originalFetch
    resetConfig()
    cleanupTempDir(tempDir)
  })

  const config = createConfig(
    {
      localesDir: 'locales',
      languages: {
        source: 'zh_CN',
        targets: ['zh_CN', 'en_US']
      },
      translation: {
        batchSize: 10,
        batchDelay: 0,
        maxTokensPerRequest: 1000
      },
      aiProvider: buildProvider({ apiUrl: 'https://fake.ai.local' })
    },
    { cwd: tempDir }
  )

  const zhPath = config.getOutputPath('zh_CN')
  fs.mkdirSync(path.dirname(zhPath), { recursive: true })
  const sourceData = {
    'common.confirm.delete': '确认删除吗？',
    'common.action.save': '保存'
  }
  fs.writeFileSync(zhPath, JSON.stringify(sourceData, null, 2), 'utf-8')

  const enPath = config.getOutputPath('en_US')
  fs.mkdirSync(path.dirname(enPath), { recursive: true })
  fs.writeFileSync(
    enPath,
    JSON.stringify(
      {
        'common.confirm.delete': 'Are you sure to delete?',
        'common.action.save': 'Save'
      },
      null,
      2
    ),
    'utf-8'
  )

  global.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body)
    const userMessage = payload.messages.find((item) => item.role === 'user')?.content || ''
    const requested = JSON.parse(userMessage.match(/\{[\s\S]+\}/m)[0])
    fetchKeys.push(Object.keys(requested))

    const translated = Object.fromEntries(
      Object.entries(requested).map(([key, value]) => [key, `forced:${value}`])
    )

    return {
      ok: true,
      status: 200,
      headers: {
        get() {
          return null
        }
      },
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(translated)
            }
          }
        ]
      })
    }
  }

  await translate({ config, force: true })

  assert.equal(fetchKeys.length, 1, 'force 模式应一次请求所有条目')
  assert.deepEqual(
    fetchKeys[0].sort(),
    Object.keys(sourceData).sort(),
    '即使已有译文也应进入翻译队列'
  )

  const enData = JSON.parse(fs.readFileSync(enPath, 'utf-8'))
  assert.equal(enData['common.confirm.delete'], 'forced:确认删除吗？')
  assert.equal(enData['common.action.save'], 'forced:保存')
})
