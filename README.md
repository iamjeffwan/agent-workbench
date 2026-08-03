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

打开桌面应用后选择任意项目目录；默认读取该目录下 `.agent-workbench/agent-steps.jsonl` 与 `trace-records.jsonl`。

## 给 Beside 等外部项目接入

见 `docs/dogfood-beside.md`。
