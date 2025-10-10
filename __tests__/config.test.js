import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createConfig, loadConfig } from '../dist/config/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

function ensureLocalPackage(tempDir) {
  const nodeModulesDir = path.join(tempDir, 'node_modules')
  const packageDir = path.join(nodeModulesDir, 'react-intl-universal-forge')
  fs.mkdirSync(nodeModulesDir, { recursive: true })
  try {
    fs.symlinkSync(repoRoot, packageDir, 'dir')
  } catch (error) {
    fs.mkdirSync(packageDir, { recursive: true })
    const relativeDist = path.relative(packageDir, path.join(repoRoot, 'dist')).replace(/\\/g, '/')
    const packageJson = {
      name: 'react-intl-universal-forge',
      type: 'module',
      exports: {
        '.': {
          default: `${relativeDist}/index.js`,
          types: `${relativeDist}/index.d.ts`
        },
        './config': {
          default: `${relativeDist}/config/index.js`,
          types: `${relativeDist}/config/index.d.ts`
        }
      }
    }
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf-8')
  }
}

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
    ensureLocalPackage(tempDir)
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
    ensureLocalPackage(tempDir)
    const tsPath = path.join(tempDir, 'forge-i18n.config.ts')
    fs.writeFileSync(
      tsPath,
      [
        "import { defineConfig } from 'react-intl-universal-forge/config'",
        '',
        'export default defineConfig({',
        "  namespace: 'tsNamespace',",
        "  localesDir: 'i18n',",
        '  languages: {',
        "    source: 'zh_CN',",
        "    targets: ['zh_CN', 'en_US']",
        '  }',
        '})'
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

test('loadConfig 支持 defineConfig 工厂函数', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-config-fn-'))
  try {
    ensureLocalPackage(tempDir)
    const jsPath = path.join(tempDir, 'forge-i18n.config.mjs')
    fs.writeFileSync(
      jsPath,
      [
        "import { defineConfig } from 'react-intl-universal-forge/config'",
        '',
        'export default defineConfig(({ command, mode }) => ({',
        "  namespace: `${command}-${mode}`,",
        "  localesDir: 'locales',",
        '  languages: {',
        "    source: 'zh_CN',",
        "    targets: ['zh_CN']",
        '  }',
        '}))'
      ].join('\n'),
      'utf-8'
    )

    const config = await loadConfig({ cwd: tempDir, command: 'extract', mode: 'test' })
    assert.equal(config.namespace, 'extract-test')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
