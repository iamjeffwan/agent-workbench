# 用 Beside 做狗粮

Agent 工作台已独立仓库。Beside 只是被观察的业务项目。

## 约定

1. 工作台仓与 Beside 仓并列时，默认 `BESIDE_ROOT=../Beside`。
2. 在 Beside 中写入的观察结果仍落在该项目的 `.agent-workbench/`。
3. Cursor hooks 需要能找到工作台仓里的 preload 与 `run-with-trace.mjs`。

## 接入 hooks

在 Beside 设置环境变量后，使用本仓提供的模板：

```text
AGENT_WORKBENCH_HOME=F:\agent-workbench
```

将 `templates/beside-cursor-hooks/` 下的文件复制到 Beside 的 `.cursor/`（或按模板改写现有 hooks），使 preload 路径指向：

```text
%AGENT_WORKBENCH_HOME%\packages\program-tracer\dist\guest\preload.js
```

## 常用验收

```bash
# 在工作台仓
pnpm build
pnpm --filter @agent-workbench/program-tracer seed:mock
pnpm desktop

# 桌面应用里打开 Beside 或工作台仓本身（有 .agent-workbench 即可）
```

对 Beside worker 的真实追踪：

```bash
set BESIDE_ROOT=F:\Beside
pnpm --filter @agent-workbench/program-tracer seed:codex-demo
```
