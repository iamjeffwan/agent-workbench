# Agent Workbench Bench

本地闭环脚本：跑场景 → 结构化 `report.json` → 按失败项改代码 → 再跑 → `diff` 对比。

## 用法

```bash
pnpm bench -- --label before
pnpm bench -- --label after
pnpm bench:diff -- --before bench/results/<before> --after bench/results/<after>
```

或直接：

```bash
node bench/run.mjs --label before
node bench/diff.mjs --before <dir-a> --after <dir-b>
```

给 AI 用的说明见 `PROMPT.md`。

## 场景

| id | 说明 |
| --- | --- |
| `A_mock_multi_call` | 确定性 mock：多工具 + 父子程序调用 |
| `B_local_shell_link` | 本地 sample-app 注入，校验工具编号关联 |
| `C_explore_noise` | 探查工具占比可测 |
| `D_trace_overhead` | 有/无 preload 的进程级粗开销 |

不依赖外网和 API Key。`B`/`D` 会在缺少 preload 时自动 `pnpm --filter @agent-workbench/program-tracer build`。
