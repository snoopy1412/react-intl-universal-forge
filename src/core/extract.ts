// @ts-nocheck
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

import { glob } from 'glob'

import { getConfig, setActiveConfig } from '../config/index.js'
import { transformFile } from './file-processor.js'
import { detectKeyCollisions, generateKeyReport } from './key-generator.js'

function hasReusableTranslation(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') {
    return value.trim().length > 0
  }
  return true
}

function ensureDirectory(targetPath) {
  const dir = path.dirname(targetPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function toSimpleTranslations(translations) {
  const result = {}
  for (const [key, value] of Object.entries(translations)) {
    result[key] = typeof value === 'string' ? value : value.text || ''
  }
  return result
}

async function runPostCommands(commands, cwd, logger) {
  if (!Array.isArray(commands) || commands.length === 0) return

  for (const command of commands) {
    try {
      logger.log(`执行额外命令: ${command}`)
      execSync(command, {
        stdio: 'inherit',
        cwd
      })
    } catch (error) {
      logger.warn(`警告: 命令执行失败 (${command})，请手动检查: ${error.message}`)
    }
  }
}

export async function extract(options = {}) {
  const config = options.config ?? getConfig()
  setActiveConfig(config)
  const cwd = options.cwd ? path.resolve(options.cwd) : config.projectRoot
  const logger = options.logger ?? console

  const translations = {}
  const fileStats = {}
  const topLevelConstantsReport = []

  const files = await glob(config.input, {
    cwd,
    ignore: config.ignore,
    absolute: true
  })

  if (files.length === 0) {
    logger.log('未找到任何待处理文件')
    return {
      filesProcessed: 0,
      changedFiles: [],
      collisions: [],
      errors: []
    }
  }

  logger.log(`找到 ${files.length} 个文件，开始处理...`)

  const results = []
  const changedFiles = []
  const errors = []

  for (const file of files) {
    try {
      const result = await transformFile(file, translations, config)
      if (!result) {
        results.push({ file, skipped: true })
        continue
      }

      const { extracted = 0, dataConstants = 0, topLevelConstants = [] } = result.stats
      fileStats[file] = result.stats

      if (topLevelConstants.length > 0) {
        topLevelConstants.forEach((item) => {
          topLevelConstantsReport.push({
            file: path.relative(cwd, file),
            ...item
          })
        })
      }

      if (extracted === 0 && dataConstants === 0 && topLevelConstants.length === 0) {
        continue
      }

      fs.writeFileSync(file, result.code, 'utf-8')
      changedFiles.push(file)
      results.push({ file, stats: result.stats })
    } catch (error) {
      errors.push({ file, error })
      results.push({ file, error })
      logger.warn(`✗ 处理文件失败: ${path.relative(cwd, file)} (${error.message})`)
    }
  }

  logger.log(`文件处理完成，写入翻译文件...`)

  const collisions = detectKeyCollisions(translations)
  const keyReport = generateKeyReport(translations)

  const translationsSimple = toSimpleTranslations(translations)
  const sourceLang = config.languages.source

  for (const lang of config.languages.targets) {
    const outputPath = config.getOutputPath(lang)
    ensureDirectory(outputPath)

    let existingTranslations = {}
    if (fs.existsSync(outputPath)) {
      try {
        existingTranslations = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))
      } catch (error) {
        logger.warn(`警告: 读取 ${path.relative(cwd, outputPath)} 失败，将覆盖写入。`)
      }
    }

    const mergedTranslations = {}
    const isSourceLanguage = lang === sourceLang

    if (!isSourceLanguage) {
      for (const [key, existingValue] of Object.entries(existingTranslations)) {
        if (hasReusableTranslation(existingValue)) {
          mergedTranslations[key] = existingValue
        }
      }
    }

    for (const [key, chineseText] of Object.entries(translationsSimple)) {
      if (isSourceLanguage) {
        mergedTranslations[key] = chineseText
      } else {
        const existingValue = existingTranslations[key]
        if (hasReusableTranslation(existingValue)) {
          mergedTranslations[key] = existingValue
        } else {
          mergedTranslations[key] = ''
        }
      }
    }

    fs.writeFileSync(outputPath, JSON.stringify(mergedTranslations, null, 2), 'utf-8')

    const normalized = config.normalizeLocaleCode(lang)
    const newKeysCount = Object.keys(translationsSimple).filter(
      (key) => !Object.prototype.hasOwnProperty.call(existingTranslations, key)
    ).length
    const relativePath = path.relative(cwd, config.getOutputPath(lang, { absolute: true }))
    logger.log(`✓ ${relativePath}${newKeysCount > 0 ? ` (+${newKeysCount} 新增)` : ''}`)
  }

  const detailPath = config.getOutputDetailPath(sourceLang)
  ensureDirectory(detailPath)
  fs.writeFileSync(detailPath, JSON.stringify(translations, null, 2), 'utf-8')
  logger.log(`✓ ${path.relative(cwd, detailPath)}`)

  const reportPath = config.getOutputReportPath(sourceLang)
  ensureDirectory(reportPath)
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        summary: {
          totalFiles: files.length,
          changedFiles: changedFiles.length,
          totalExtracted: Object.values(fileStats).reduce((acc, item) => acc + (item.extracted || 0), 0),
          totalDataConstants: Object.values(fileStats).reduce(
            (acc, item) => acc + (item.dataConstants || 0),
            0
          ),
          totalMissingSamples: Object.values(fileStats).reduce(
            (acc, item) => acc + ((item.missingSamples || []).length),
            0
          ),
          totalUnrecognizedSamples: Object.values(fileStats).reduce(
            (acc, item) => acc + ((item.unrecognizedSamples || []).length),
            0
          ),
          collisions: collisions.length,
          errors: errors.length,
          languages: config.languages.targets
        },
        keyReport,
        fileStats,
        errors:
          errors.length > 0
            ? errors.map((e) => ({ file: path.relative(cwd, e.file), message: e.error.message }))
            : undefined
      },
      null,
      2
    ),
    'utf-8'
  )
  logger.log(`✓ ${path.relative(cwd, reportPath)}`)

  if (config.reporting?.topLevelWarningsPath) {
    const markdownPath = path.resolve(cwd, config.reporting.topLevelWarningsPath)
    ensureDirectory(markdownPath)

    const sortedWarnings = topLevelConstantsReport.slice().sort((a, b) => {
      if (a.file === b.file) {
        return (a.line ?? 0) - (b.line ?? 0)
      }
      return a.file.localeCompare(b.file)
    })

    let markdownContent = ''
    if (sortedWarnings.length === 0) {
      markdownContent = ['# 顶层 intl.get 使用提醒', '', '当前未检测到需要手动改造的顶层常量。', ''].join('\n')
    } else {
      const header = [
        '# 顶层 intl.get 使用提醒',
        '',
        '以下常量在模块顶层直接调用 `intl.get`，请手动改造成 getter 或工厂函数：',
        ''
      ]
      const tableHeader = '| 文件 | 常量 | 行号 | intl key |'
      const tableDivider = '| --- | --- | --- | --- |'
      const rows = sortedWarnings.map((item) => {
        const lineText = item.line ? String(item.line) : '-'
        const intlKeyText = item.intlKey ? `\`${item.intlKey}\`` : '-'
        return `| ${item.file} | ${item.name || '-'} | ${lineText} | ${intlKeyText} |`
      })
      markdownContent = [...header, tableHeader, tableDivider, ...rows, ''].join('\n')
    }

    fs.writeFileSync(markdownPath, markdownContent, 'utf-8')
    logger.log(`✓ ${path.relative(cwd, markdownPath)}`)
  }

  await runPostCommands(config.postCommands, cwd, logger)

  logger.log('提取完成。')

  return {
    filesProcessed: files.length,
    changedFiles,
    collisions,
    errors,
    keyReport
  }
}
