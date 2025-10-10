# 测试规范概览
- 使用 Node >= 18.18.0 和官方 `node:test` 框架编写、运行单元测试。
- 提交任何代码前必须依次执行 `pnpm run lint`、`pnpm run format` 与 `pnpm test`，确保语法检查、格式校验与测试全部通过。
- 测试涉及文件系统时统一通过 `fs.mkdtempSync` 创建临时目录并在测试结束后清理，避免污染工作区。
- 需要模拟网络请求（例如 DeepSeek 翻译能力）时，应 stub `global.fetch` 并确保测试内恢复原始实现，禁止真实外网访问。
- 若需保留测试临时目录以便排查，可在运行测试时设置 `KEEP_I18N_FIXTURE=1`（默认自动清理）；如需将临时目录写入项目内自定义路径，可额外设置 `I18N_TEST_TMP_DIR=tmp/i18n-fixtures` 等自定义目录。
