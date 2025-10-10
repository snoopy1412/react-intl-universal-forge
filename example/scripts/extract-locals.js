#!/usr/bin/env node

import { loadConfig, extract } from 'react-intl-universal-forge'

async function run() {
  const config = await loadConfig({ cwd: process.cwd(), command: 'extract', mode: 'example' })
  const result = await extract({ config })
  console.log('提取完成:', JSON.stringify(result, null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
