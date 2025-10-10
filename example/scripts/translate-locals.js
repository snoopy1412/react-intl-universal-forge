#!/usr/bin/env node

import { loadConfig, translate } from 'react-intl-universal-forge'

async function run() {
  const config = await loadConfig({ cwd: process.cwd(), command: 'translate', mode: 'example' })
  const result = await translate({ config })
  console.log('翻译完成:', JSON.stringify(result, null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
