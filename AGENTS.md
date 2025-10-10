# 自动化检查要求

## 必须执行的命令
1. `pnpm run lint` - 调用项目内脚本执行语法解析检查。
2. `pnpm run format` - 校验代码格式是否符合约定。
3. `pnpm test` - 运行基于 Node `node:test` 的测试套件（会自动触发 `pnpm run build`）。

## 环境与注意事项
- Node.js 版本要求为 >= 18.18.0。
- 不得依赖外部网络服务进行测试，如需模拟网络返回需 stub `global.fetch`。
- 测试过程中产生的临时文件应在用例结束后清理，保持工作区干净。
