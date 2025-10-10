#!/usr/bin/env node

import { runCLI } from '../cli/index.js'

runCLI().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('运行失败:', message)
  if (error instanceof Error && error.stack) {
    console.error(error.stack)
  }
  process.exit(1)
})
