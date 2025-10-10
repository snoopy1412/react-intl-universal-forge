import process from 'node:process'

import { Command } from 'commander'

import { loadConfig } from '../config/index.js'
import { extract } from '../core/extract.js'
import { translate } from '../core/translate.js'

function parseLangOption(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export async function runCLI(): Promise<void> {
  const program = new Command()
    .name('forge-i18n')
    .description('React i18n 提取与翻译工具集')
    .version('0.1.0')

  program
    .command('extract')
    .description('扫描代码并提取中文文本，生成多语言文件')
    .option('-c, --config <file>', '指定配置文件路径，默认查找 forge-i18n.config.*')
    .action(async (options: { config?: string }) => {
      const config = await loadConfig({ cwd: process.cwd(), configPath: options.config })
      const result = await extract({ config })

      console.log('\n'.padStart(1))
      console.log('提取统计')
      console.log('='.repeat(40))
      console.log(`文件总数: ${result.filesProcessed}`)
      console.log(`改动文件: ${result.changedFiles.length}`)
      console.log(`冲突数量: ${result.collisions.length}`)
      console.log(`错误数量: ${result.errors.length}`)
      console.log('='.repeat(40))
    })

  program
    .command('translate')
    .description('调用 DeepSeek API 对目标语言进行自动翻译')
    .option('-c, --config <file>', '指定配置文件路径')
    .option('-l, --lang <codes>', '逗号分隔的目标语言列表，如 en_US,ja_JP')
    .option('-f, --force', '强制重新翻译所有条目', false)
    .action(async (options: { config?: string; lang?: string; force?: boolean }) => {
      const config = await loadConfig({ cwd: process.cwd(), configPath: options.config })
      const targetLanguages = parseLangOption(options.lang)
      const result = await translate({
        config,
        force: options.force,
        targetLanguages
      })

      console.log('\n翻译完成统计')
      console.log('='.repeat(40))
      console.log(`执行模式: ${result.force ? '强制翻译' : '增量翻译'}`)
      console.log(`目标语言: ${result.targetLangs.join(', ')}`)
      console.log(`耗时: ${result.duration}s`)
      console.log('='.repeat(40))
    })

  await program.parseAsync(process.argv)
}
