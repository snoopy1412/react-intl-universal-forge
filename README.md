# react-intl-universal-forge

React 国际化提取与自动翻译工具集，聚焦于 AST 级别的源码解析、语义化/AI key 生成与多语言文件管理。本项目现已全面迁移至 TypeScript，实现更完善的类型约束与构建流程，同时支持多种 `forge-i18n` 配置文件格式，方便在不同技术栈中集成。

React intl automation toolkit powered by AST analysis. The project is now fully written in TypeScript and can load configuration from JSON/JS/TS/YAML, making it easy to adopt across diverse build systems.

## 功能特性 · Key Features
- **AST 精准提取 / AST Accurate Extraction**：扫描 TS/TSX/JS/JSX，识别字符串、模板、JSX 文本及常量配置，并支持顶层常量告警。
- **多策略 key 生成 / Flexible Key Strategies**：内置语义化、哈希与 AI 智能 key 三种策略，可对接任意 OpenAI 兼容模型并生成冲突报告。
- **多格式配置 / Multi-format Config Support**：自动识别 `forge-i18n.config.{js,cjs,mjs,ts,mts,cts,json,yaml,yml}`，可按需切换。
- **TypeScript 构建链 / Type-safe Build Pipeline**：源码、CLI、工具脚本以及导出都由 `tsc` 编译，发布产物位于 `dist/`。
- **AI Provider 集成 / AI Provider Integration**：默认适配 OpenAI/DeepSeek 等 Chat Completions 协议，支持自定义地址、模型、头信息及请求体，提供增量翻译与占位符校验。
- **CLI 命令 / CLI Commands**：`forge-i18n extract` 和 `forge-i18n translate` 支持自定义配置路径、目标语言、强制翻译等参数。

## 快速开始 · Quick Start
1. **安装依赖 Install dependencies**
   ```bash
   pnpm install
   ```
2. **选择配置格式 Create configuration file**  
   在项目根目录创建任意一种配置文件，例如 TypeScript 版本：
```ts
// forge-i18n.config.ts
import { defineConfig } from 'react-intl-universal-forge/config'

export default defineConfig(({ command, mode }) => ({
  input: ['src/**/*.{ts,tsx}'],
  localesDir: 'locales',
  languages: {
    source: 'zh_CN',
    targets: ['zh_CN', 'en_US']
  },
  aiProvider: {
    apiKey: process.env.AI_PROVIDER_KEY ?? '',
    apiUrl: process.env.AI_PROVIDER_URL ?? 'https://api.openai.com/v1/chat/completions',
    model: process.env.AI_PROVIDER_MODEL ?? 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 1024,
    requestsPerMinute: 60,
    maxRetries: 2,
    request: {
      headers: {
        'X-Custom-Header': 'forge-demo'
      }
    }
  },
  keyGeneration: {
    strategy: 'ai',
    ai: {
      enabled: command === 'extract',
      fallbackToSemantic: true
    }
  },
  // 可按运行场景动态调整
  reporting: {
    topLevelWarningsPath: `docs/${mode}-${command}-warnings.md`
  }
}))
```
*Supported formats: `.json`, `.yaml/.yml`, `.js/.mjs/.cjs`, `.ts/.mts/.cts`（可结合 `defineConfig` 工厂函数按命令/模式返回配置）。*
3. **执行命令 Run commands**
   ```bash
   pnpm exec forge-i18n extract    # 扫描源码并生成多语言文件 / extract keys
   pnpm exec forge-i18n translate  # 调用自定义 AI 翻译服务 / translate via AI provider
   ```
4. **编译构建 Build library**
   ```bash
   pnpm run build             # 输出到 dist/，包含 d.ts 类型声明
   ```

## 配置说明 · Configuration Highlights
- `input`: Glob 数组（默认 `src/**/*.{ts,tsx,js,jsx}`）。  
  Glob patterns for source files.
- `localesDir`: 多语言文件输出目录，默认 `locales`。  
  Output directory for locale bundles.
- `languages.targets`: 国际化目标语言，使用 `zh_CN` / `en_US` 等格式。  
  Target language codes (supports underscore or hyphen).
- `keyGeneration.strategy`: `semantic` | `hash` | `ai`，启用 AI 时需提供 `aiProvider.apiKey`。  
- `aiProvider`: 定义 OpenAI 兼容的模型地址、API Key、请求速率与额外头信息，可灵活接入 OpenAI、DeepSeek、Azure OpenAI 等供应商。  
  Key generation strategy with AI fallback behaviour.
- `postCommands`: 数组形式，在提取结束后按顺序执行额外命令。  
  Additional shell commands executed after extraction.
- `reporting.topLevelWarningsPath`: 顶层 `intl.get` 告警 Markdown 输出路径。  
  Markdown report path for top-level i18n warnings.

更多详细配置可参考 `src/config/defaults.ts` 内的默认值定义。

## PNPM Script 列表 · Available Scripts
- `pnpm run build`：使用 `tsc` 编译 `src/`，生成 `dist/`。  
- `pnpm run lint`：基于 Babel Parser 解析源码与测试文件，确保语法合法。  
- `pnpm run format`：检测源码与测试中的行尾空白。  
- `pnpm test`：先执行 `pnpm run build`，随后运行 Node `--test` 测试套件（基于 `dist/` 产物）。

> **Required pre-publish checks**: 在提交或发版前务必顺序执行 `pnpm run format && pnpm run lint && pnpm test`，保证格式、语法与测试均通过。

## 目录结构 · Project Structure
```
.
├─ src/                # TypeScript 源码（配置、核心逻辑、CLI、工具）
├─ dist/               # 由 tsc 输出的编译产物
├─ __tests__/          # Node Test 测试用例
├─ scripts/            # 轻量 lint / format 校验脚本
├─ .agentdocs/         # 面向 AI 代理的内部文档
└─ forge-i18n.config.* # 用户自定义配置文件（可选）
```

## 许可 · License
本项目基于 [MIT License](./LICENSE) 开源。  
Released under the MIT License.
