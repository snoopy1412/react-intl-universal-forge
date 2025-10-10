#!/usr/bin/env node

/**
 * 使用 Babel Parser 对源码进行语法解析，兼容 ESM/JSX/TS。
 * 优先使用本包依赖，如未安装则尝试复用 offline-frontend 的 node_modules。
 */

import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(process.cwd(), 'src')
const require = createRequire(import.meta.url)

let babelParser
try {
  babelParser = require('@babel/parser')
} catch (error) {
  try {
    babelParser = require(
      path.resolve(process.cwd(), '../offline-frontend/node_modules/@babel/parser')
    )
  } catch (innerError) {
    console.error('无法加载 @babel/parser，请先安装依赖或复用 offline-frontend/node_modules')
    process.exit(1)
  }
}

const { parse } = babelParser

const SUPPORTED_EXT = ['.js', '.ts', '.jsx', '.tsx']

function collectJsFiles(dir, result = []) {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectJsFiles(fullPath, result)
    } else if (entry.isFile() && SUPPORTED_EXT.includes(path.extname(entry.name))) {
      result.push(fullPath)
    }
  }
  return result
}

function checkFileSyntax(filePath) {
  const code = readFileSync(filePath, 'utf-8')
  parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript', 'decorators-legacy']
  })
}

function main() {
  if (!statSafe(ROOT)) {
    console.log('src 目录不存在，跳过语法检查')
    process.exit(0)
  }

  const files = collectJsFiles(ROOT)
  if (files.length === 0) {
    console.log('未找到需要校验的 JS 文件')
    process.exit(0)
  }

  const errors = []
  for (const file of files) {
    try {
      checkFileSyntax(file)
    } catch (error) {
      errors.push({ file, message: error.message })
    }
  }

  if (errors.length > 0) {
    console.error('语法检查失败：')
    errors.forEach((err) => {
      console.error(` - ${err.file}: ${err.message}`)
    })
    process.exit(1)
  }

  console.log(`语法检查通过，共解析 ${files.length} 个文件`)
}

function statSafe(targetPath) {
  try {
    statSync(targetPath)
    return true
  } catch (error) {
    return false
  }
}

main()
