import fs from 'node:fs'
import path from 'node:path'

import { loadConfig, extract, translate } from 'react-intl-universal-forge'

async function main() {
  const cwd = process.cwd()
  const config = await loadConfig({ cwd, command: 'demo', mode: process.env.NODE_ENV ?? 'development' })

  console.log('当前配置:')
  console.log(JSON.stringify(config, null, 2))

  console.log('\n开始提取...')
  const extractResult = await extract({ config })
  console.log('提取完成:', {
    files: extractResult.filesProcessed,
    changed: extractResult.changedFiles.length
  })

  console.log('\n开始翻译...')
  try {
    const translateResult = await translate({ config })
    console.log('翻译完成:', translateResult)
  } catch (error) {
    if (error instanceof Error) {
      console.error('翻译失败:', error.message)
    } else {
      console.error('翻译失败:', error)
    }
  }

  const localesDir = config.paths.localesDir
  console.log('\nLocales 输出目录:', localesDir)
  if (fs.existsSync(localesDir)) {
    const files = fs.readdirSync(localesDir, { withFileTypes: true })
    for (const dirent of files) {
      if (dirent.isDirectory()) {
        const jsonFile = path.join(localesDir, dirent.name, `${config.namespace}.json`)
        if (fs.existsSync(jsonFile)) {
          console.log(`\n${dirent.name}/${config.namespace}.json:`)
          const content = fs.readFileSync(jsonFile, 'utf-8')
          console.log(content)
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
