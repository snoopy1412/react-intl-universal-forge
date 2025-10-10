#!/usr/bin/env node

/**
 * 简易格式检查：检测源码与测试目录中的行尾空白。
 * 保持实现无外部依赖，便于在受限环境运行。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const TARGET_DIRS = ['src', '__tests__']
const TARGET_EXTENSIONS = new Set(['.js', '.ts', '.tsx', '.json', '.md'])

function collectFiles(root, result = []) {
  const entries = readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      collectFiles(fullPath, result)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name)
      if (TARGET_EXTENSIONS.has(ext)) {
        result.push(fullPath)
      }
    }
  }
  return result
}

function hasTrailingWhitespace(filePath) {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split(/\r?\n/)
  const violations = []
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      violations.push(`${filePath}:${index + 1}`)
    }
  })
  return violations
}

function main() {
  const violations = []

  for (const dir of TARGET_DIRS) {
    const absDir = path.resolve(process.cwd(), dir)
    if (!statSafe(absDir)) continue
    const files = collectFiles(absDir)
    for (const file of files) {
      violations.push(...hasTrailingWhitespace(file))
    }
  }

  if (violations.length > 0) {
    console.error('格式检查失败，存在行尾空白：')
    violations.slice(0, 20).forEach((item) => console.error(` - ${item}`))
    if (violations.length > 20) {
      console.error(` - 其余 ${violations.length - 20} 项省略`)
    }
    process.exit(1)
  }

  console.log('格式检查通过')
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
