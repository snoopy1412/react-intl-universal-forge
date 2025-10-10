# Example: 快速体验 react-intl-universal-forge

该示例展示如何在一个独立目录中使用 `react-intl-universal-forge`，完成：

1. 创建配置文件并加载自定义 AI Provider
2. 使用 CLI/脚本提取源码里的中文文案
3. 调用可配置的 OpenAI 兼容模型生成翻译

## 目录结构

```
example/
├─ package.json             # 示例项目自身依赖（通过 file:.. 引用主包）
├─ forge-i18n.config.ts     # 示例配置文件，展示 defineConfig 用法
├─ src/
│  ├─ app.tsx               # React 示例组件，含中文文案
│  └─ demo.ts               # 可运行的脚本，演示 API 调用
└─ scripts/
   ├─ extract-locals.js     # 调用 extract API
   └─ translate-locals.js   # 调用 translate API
```

## 使用步骤

```bash
cd example
pnpm install

# 仅提取文案
pnpm run extract

# 提取 + 翻译
AI_PROVIDER_KEY=your-key pnpm run translate

# 运行 demo 脚本查看 API 返回
AI_PROVIDER_KEY=your-key pnpm run build
```

> **提示**：示例默认请求 `https://api.openai.com/v1/chat/completions`，可通过环境变量覆盖 `AI_PROVIDER_URL`、`AI_PROVIDER_MODEL` 等配置。
