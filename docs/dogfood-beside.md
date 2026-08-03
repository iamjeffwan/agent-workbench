# 用 Beside 做狗粮

Agent 工作台已独立仓库。Beside 只是被观察的业务项目。

## 推荐用法（桌面）

1. 在工作台仓执行 `pnpm build`，再 `pnpm desktop`
2. 在桌面应用里「打开项目」，选择 Beside 目录
3. 工作台会自动注入 Cursor 观察配置到该项目：
   - `.agent-workbench/cursor-hooks/`（托管脚本）
   - `.cursor/hooks.json`（合并工作台条目，保留你已有的其他 hooks）
   - `.agent-workbench/observation.json`（安装信息）
4. 之后在 Cursor 打开同一项目并使用代理；工具步骤会写入 `.agent-workbench/agent-steps.jsonl`

不必再手动拷贝 hooks，也不必设置 `AGENT_WORKBENCH_HOME`（桌面会把工作台路径写进托管脚本）。

## 手动模板（仅排障）

若不能使用桌面注入，仍可参考 `templates/beside-cursor-hooks/`，并自行设置：

```text
AGENT_WORKBENCH_HOME=F:\agent-workbench
```

## 真实程序追踪验收

```bash
set BESIDE_ROOT=F:\Beside
pnpm --filter @agent-workbench/program-tracer seed:codex-demo
pnpm desktop
```
