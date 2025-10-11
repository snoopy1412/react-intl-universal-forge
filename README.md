<div align="center">

# 🔧 react-intl-universal-forge

**React 国际化提取与自动翻译工具集**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-blue)](https://www.typescriptlang.org/)

基于 AST 分析的 React 国际化自动化工具，支持 AI 智能 Key 生成与多语言自动翻译

</div>

---

## 🌟 特性亮点

- 🎯 **AST 级精准提取** - 基于 Babel AST 深度扫描 TS/TSX/JS/JSX 源码
- 🤖 **AI 智能 Key 生成** - 支持语义化、哈希与 AI 三种策略,对接 OpenAI 兼容模型
- 🌍 **多语言自动翻译** - 集成主流 AI Provider,增量翻译,占位符校验
- ⚙️ **灵活配置加载** - 支持 JSON/YAML/JS/TS 等多种配置格式
- 📦 **TypeScript 原生支持** - 完整类型定义,类型安全的构建链
- 🚀 **CLI 开箱即用** - 简洁命令行工具,轻松集成到现有项目
- 🧪 **可执行示例** - `example/` 目录提供一键运行的提取/翻译 demo

---

## 📦 安装

```bash
# 使用 npm
npm install react-intl-universal-forge --save-dev

# 使用 pnpm
pnpm add -D react-intl-universal-forge

# 使用 yarn
yarn add -D react-intl-universal-forge
```

---

## 🚀 快速开始

### 1. 创建配置文件

在项目根目录创建 `forge-i18n.config.ts`:

```typescript
import { defineConfig } from 'react-intl-universal-forge/config'

export default defineConfig({
  input: ['src/**/*.{ts,tsx}'],
  localesDir: 'locales',
  languages: {
    source: 'zh_CN',
    targets: ['zh_CN', 'en_US']
  },
  keyGeneration: {
    strategy: 'ai', // 'semantic' | 'hash' | 'ai'
    ai: {
      enabled: true,
      fallbackToSemantic: true
    }
  },
  aiProvider: {
    apiKey: process.env.AI_PROVIDER_KEY ?? '',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 1024
  }
})
```

### 2. 运行命令

```bash
# 提取国际化 key
npx forge-i18n extract

# 自动翻译
npx forge-i18n translate
```

### 3. 集成到项目

```json
// package.json
{
  "scripts": {
    "i18n:extract": "forge-i18n extract",
    "i18n:translate": "forge-i18n translate",
    "i18n": "pnpm i18n:extract && pnpm i18n:translate"
  }
}
```

---

## 📖 配置说明

### 核心配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `input` | `string[]` | `['src/**/*.{ts,tsx,js,jsx}']` | 源码文件 Glob 匹配模式 |
| `localesDir` | `string` | `'locales'` | 多语言文件输出目录 |
| `languages.source` | `string` | `'zh_CN'` | 源语言代码 |
| `languages.targets` | `string[]` | `['zh_CN', 'en_US']` | 目标语言列表 |
| `keyGeneration.strategy` | `'semantic' \| 'hash' \| 'ai'` | `'semantic'` | Key 生成策略 |

### AI Provider 配置

```typescript
aiProvider: {
  apiKey: string              // API 密钥
  apiUrl: string              // 服务地址
  model: string               // 模型名称
  temperature?: number        // 温度参数 (0-2)
  maxTokens?: number          // 最大 token 数
  requestsPerMinute?: number  // 请求频率限制
  maxRetries?: number         // 最大重试次数
  request?: {
    headers?: Record<string, string>  // 自定义请求头
  }
}
```

### 支持的配置文件格式

- `forge-i18n.config.json`
- `forge-i18n.config.js` / `.mjs` / `.cjs`
- `forge-i18n.config.ts` / `.mts` / `.cts`
- `forge-i18n.config.yaml` / `.yml`

---

## 🛠️ CLI 命令

### `forge-i18n extract`

扫描源码并提取国际化文本

```bash
forge-i18n extract [options]

选项:
  -c, --config <path>   指定配置文件路径
  --mode <mode>         运行模式 (development/production)
  -h, --help            显示帮助信息
```

### `forge-i18n translate`

自动翻译多语言文件

```bash
forge-i18n translate [options]

选项:
  -c, --config <path>   指定配置文件路径
  -l, --lang <langs>    指定目标语言 (逗号分隔)
  -f, --force           强制重新翻译所有内容
  -h, --help            显示帮助信息
```

---

## 📂 项目结构

```
react-intl-universal-forge/
├── src/                    # TypeScript 源码
│   ├── cli/               # CLI 命令实现
│   ├── config/            # 配置加载与验证
│   ├── core/              # 核心功能
│   │   ├── extract.ts     # AST 提取逻辑
│   │   ├── translate.ts   # 翻译功能
│   │   └── ai-key-generator.ts  # AI Key 生成
│   ├── utils/             # 工具函数
│   └── types.ts           # 类型定义
├── dist/                   # 编译输出
├── __tests__/             # 测试文件
├── scripts/               # 构建脚本
└── forge-i18n.config.*    # 配置文件示例
```

---

## 🧪 开发

### 环境要求

- Node.js >= 18.18.0
- pnpm (推荐)

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/your-org/react-intl-universal-forge.git
cd react-intl-universal-forge

# 安装依赖
pnpm install

# 构建项目
pnpm build

# 运行测试
pnpm test

# 代码检查
pnpm lint
pnpm format
```

### 示例项目

`example/` 目录包含一个可运行的 demo，演示如何：

- 使用 `defineConfig` 配置 `aiProvider`
- 调用 `extract` 与 `translate` 脚本
- 直接执行 `src/demo.ts` 获取配置与运行结果

快速体验：

```bash
cd example
pnpm install
pnpm run extract
AI_PROVIDER_KEY=your-key pnpm run translate
AI_PROVIDER_KEY=your-key pnpm run build
```

### 测试

```bash
# 运行所有测试
pnpm test

# 运行单个测试文件
node --test __tests__/extract.test.js
```

---

## 🚀 发布流程

自动化流程基于 GitHub Actions，在发布 Release 时会构建并推送到 npm。首次使用前请完成以下准备：

1. 在 npm 获取具有发布权限的令牌，并在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中新增 `NPM_TOKEN`。
2. 确保 `main` 分支代码已合并，执行 `npm version <patch|minor|major>` 更新版本号并推送标签，例如 `git push origin v0.1.1`.
3. 在 GitHub 创建对应标签的 Release 并点击发布，工作流会自动运行 `pnpm run format`、`pnpm run lint`、`pnpm test`，最后执行 `pnpm publish --access public --no-git-checks`。

发布事件成功后，npm 上的 `react-intl-universal-forge` 将同步更新至对应版本。如需撤销或重发，请在 npm 管理后台执行操作。

---

## 🤝 贡献指南

我们欢迎任何形式的贡献!

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

### 提交前检查

确保以下命令全部通过:

```bash
pnpm format && pnpm lint && pnpm test
```

---

## 📝 许可证

本项目基于 [MIT License](./LICENSE) 开源。

---

## 🔗 相关资源

- [react-intl-universal](https://github.com/alibaba/react-intl-universal) - React 国际化解决方案
- [Babel Parser](https://babeljs.io/docs/en/babel-parser) - JavaScript 解析器
- [OpenAI API](https://platform.openai.com/docs/api-reference) - AI 模型接口

---

## 💬 联系我们

- 问题反馈: [GitHub Issues](https://github.com/your-org/react-intl-universal-forge/issues)
- 讨论交流: [GitHub Discussions](https://github.com/your-org/react-intl-universal-forge/discussions)

---

<div align="center">

Made with ❤️ by GPM Team

[⬆ 回到顶部](#-react-intl-universal-forge)

</div>
