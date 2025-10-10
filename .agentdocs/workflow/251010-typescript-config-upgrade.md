# TypeScript 迁移与配置扩展

## 背景
现有代码以 ESM JavaScript 形式存在，配置加载仅支持 JSON/JS，缺乏 TypeScript 类型约束与常见格式支持，仓库文档和元信息亦不完整。

## 目标
- 将核心源码与测试迁移为 TypeScript，建立稳定的编译与类型检查流程。
- 扩展 `forge-i18n` 配置文件解析能力，支持 TS 与 YAML 等多种形式，确保用户任选。
- 补齐 `.gitignore`、README（中英双语）及开源许可证文本，提升仓库规范度。
- 维持现有 CLI 与测试行为，保证自动化检查全数通过。

## 约束与考虑
- 继续使用 ESM 生态，构建产物需服务 CLI 入口与对外导出。
- 避免重复造轮子，优先复用现有工具链（如 deepMerge、验证逻辑）并保留既有 API。
- 新增依赖需保持体积与维护成本可控，优先选择社区常用方案。
- 所有注释与文档使用中文描述关键逻辑（保留必要英文专业名词）。

## 技术要点与方案草案
- 使用 `tsconfig` + `tsc` 输出到 `dist/`，更新 `package.json` 的 `exports`/`bin` 指向编译产物。
- 引入 `ts-node`/`tsx` 作为测试运行 loader，保持 `node --test` 工作流程。
- 配置加载新增 `.ts`/`.mts`/`.cts`、`.yaml`/`.yml`，必要时借助 `ts-node/register` 与 `yaml` 库。
- 类型定义覆盖核心流程：AST 处理、键生成、文件读写等，明确输入输出结构。

## TODO
- [x] 盘点源码结构与类型定义需求，输出 TypeScript 接口草稿。
- [x] 搭建 TypeScript 编译环境（依赖、tsconfig、构建脚本）并迁移源码。
- [x] 扩展配置读取逻辑与类型验证，完善测试覆盖多格式场景。
- [x] 更新 `.gitignore`、README（中英双语）、LICENSE，并调整包导出信息。
- [x] 执行 `pnpm run format`、`pnpm run lint`、`pnpm test` 验证通过，整理文档索引。
