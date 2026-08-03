# Agent Workbench

旁路观察编程代理与程序内部活动的本地工作台。Beside 等业务仓库只作狗粮目标，不是本产品的母仓。

## 组成

- `packages/program-tracer` — 边界分析、预加载追踪、JSONL 记录
- `packages/codex-adapter` / `packages/cursor-adapter` — 只读会话适配
- `packages/agent-workbench-security` — 凭据隐藏
- `packages/timeline` — 执行轮次 / 探查折叠 / 操作流模型
- `apps/desktop` — Electron 观察壳（读项目 `.agent-workbench`）
- `bench/` — 可重复闭环打分
- `.cursor/hooks*` — 本仓 dogfood 用的 Cursor 钩子

## 常用命令

```bash
pnpm install
pnpm build
pnpm test
pnpm bench -- --label smoke
pnpm desktop:dev
```

第一次可先创建桌面图标：

```bash
pnpm desktop:shortcut
```

之后双击桌面上的 `Agent Workbench` 即可打开（不必再进命令行）。

打开后选择任意项目目录。工作台会自动注入 Cursor 观察配置，并读取该目录下：

- `.agent-workbench/agent-steps.jsonl`
- `.agent-workbench/trace-records.jsonl`

用户不必先手写 hooks。说明见 `docs/dogfood-beside.md`。
