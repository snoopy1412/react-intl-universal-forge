import test from 'node:test'
import assert from 'node:assert/strict'

import { generateKey, generateKeySync, generateKeysBatch } from '../dist/core/key-generator.js'
import { createConfig, setActiveConfig } from '../dist/config/index.js'

test('语义化策略生成 key', async () => {
  const config = createConfig({
    keyGeneration: {
      strategy: 'semantic',
      hashLength: 4,
      maxSemanticLength: 6,
      useTypePrefix: true
    }
  })
  setActiveConfig(config)

  const key = await generateKey('确认删除吗？', 'common')
  assert.ok(key.startsWith('common.confirm.'), key)
})

test('哈希策略生成 key', () => {
  const config = createConfig({
    keyGeneration: {
      strategy: 'hash',
      hashLength: 6,
      maxSemanticLength: 6,
      useTypePrefix: false
    }
  })
  setActiveConfig(config)

  const key = generateKeySync('保存成功', 'tips')
  assert.ok(/^tips\.[0-9a-f]{6}$/.test(key), key)
})

test('generateKeysBatch 在非 AI 模式下支持对象输入', async () => {
  const config = createConfig({
    keyGeneration: {
      strategy: 'semantic',
      ai: {
        enabled: false
      }
    }
  })
  setActiveConfig(config)

  const result = await generateKeysBatch(
    [
      { text: '提交成功', context: { filePath: 'components/Form.tsx' } },
      { text: '请填写用户名', context: { filePath: 'components/Form.tsx' } }
    ],
    'form',
    config
  )

  assert.equal(result.length, 2)
  assert.ok(result[0].startsWith('form.success.'), result[0])
  assert.ok(result[1].startsWith('form.input.'), result[1])
})

test('generateKeysBatch 在 AI 模式下支持字符串输入', async () => {
  const originalFetch = global.fetch
  let requestCount = 0
  global.fetch = async () => {
    requestCount += 1
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(['autoKeyOne', 'autoKeyTwo'])
            }
          }
        ]
      })
    }
  }

  try {
    const config = createConfig({
      keyGeneration: {
        strategy: 'ai',
        ai: {
          enabled: true,
          batchSize: 5,
          fallbackToSemantic: false,
          cache: {
            enabled: false
          }
        }
      },
      aiProvider: {
        apiKey: 'test-key',
        requestsPerMinute: 60000,
        maxRetries: 1
      }
    })
    setActiveConfig(config)

    const result = await generateKeysBatch(['确认删除吗？', '保存成功'], 'dialog', config)
    assert.deepEqual(result, ['dialog.autoKeyOne', 'dialog.autoKeyTwo'])
    assert.equal(requestCount, 1)
  } finally {
    global.fetch = originalFetch
  }
})
