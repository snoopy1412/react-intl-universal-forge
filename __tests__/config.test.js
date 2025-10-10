import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

import { createConfig, loadConfig } from '../dist/config/index.js'

test('createConfig 解析相对路径并生成函数', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-config-'))
  try {
    const config = createConfig(
      {
        localesDir: 'resources/i18n',
        languages: {
          source: 'zh_CN',
          targets: ['zh_CN', 'en_US']
        }
      },
      { cwd: tempDir }
    )

    assert.equal(config.projectRoot, tempDir)
    assert.equal(
      config.getOutputPath('zh_CN'),
      path.join(tempDir, 'resources/i18n', 'zh-CN', 'translation.json')
    )
    assert.equal(
      config.getOutputPath('en_US', { absolute: false }),
      path.join('resources/i18n', 'en-US', 'translation.json')
    )
    assert.deepEqual(config.languages.targets, ['zh_CN', 'en_US'])
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('createConfig 支持自定义 skipFunctionCalls', () => {
  const config = createConfig({
    skipFunctionCalls: ['logger']
  })
  assert.ok(Array.isArray(config.skipFunctionCalls))
  assert(config.skipFunctionCalls.includes('logger'))
})

test('createConfig 多次调用不会污染默认配置', () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-config-a-'))
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-config-b-'))

  try {
    const configA = createConfig({}, { cwd: dirA })
    const configB = createConfig({}, { cwd: dirB })

    assert.ok(configA.getOutputPath('zh_CN').startsWith(dirA))
    assert.ok(configB.getOutputPath('zh_CN').startsWith(dirB))
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true })
    fs.rmSync(dirB, { recursive: true, force: true })
  }
})

test('loadConfig 支持 YAML 配置文件', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-config-yaml-'))
  try {
    const yamlPath = path.join(tempDir, 'forge-i18n.config.yaml')
    fs.writeFileSync(
      yamlPath,
      [
        'namespace: yamlNamespace',
        'localesDir: locales',
        'translation:',
        '  batchSize: 5'
      ].join('\n'),
      'utf-8'
    )

    const config = await loadConfig({ cwd: tempDir })
    assert.equal(config.namespace, 'yamlNamespace')
    assert.equal(config.translation.batchSize, 5)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('loadConfig 支持 TypeScript 配置文件', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-config-ts-'))
  try {
    const tsPath = path.join(tempDir, 'forge-i18n.config.ts')
    fs.writeFileSync(
      tsPath,
      [
        'export default {',
        "  namespace: 'tsNamespace',",
        "  localesDir: 'i18n',",
        '  languages: {',
        "    source: 'zh_CN',",
        "    targets: ['zh_CN', 'en_US']",
        '  }',
        '};'
      ].join('\n'),
      'utf-8'
    )

    const config = await loadConfig({ cwd: tempDir })
    assert.equal(config.namespace, 'tsNamespace')
    assert.equal(path.basename(config.paths.localesDir), 'i18n')
    assert.deepEqual(config.languages.targets, ['zh_CN', 'en_US'])
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
