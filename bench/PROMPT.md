# Bench 闭环优化提示

把下面整段交给 AI。目标是：根据 `report.json` 里的失败项改代码，再跑同一套 bench，用 `diff.mjs` 看是否真的变好。

## 约束

1. 只改 Agent 工作台相关代码（`packages/program-tracer`、`packages/*-adapter`、`.cursor/hooks*`、`bench/`、`docs/agent-workbench/`）。不要顺手改 Beside 产品业务。
2. 先跑通本地 bench，不要引入需要外网或 API Key 的场景。
3. 改完后必须重新跑 **同一组 scenario**，并产出 after 报告。
4. 若 `diff` 出现 `regressed`，视为失败，继续修。

## 命令

```bash
# 1) 基线
node bench/run.mjs --label before

# 2) 按 report 中 failures 修改代码

# 3) 复测
node bench/run.mjs --label after

# 4) 对比（把路径换成实际 results 目录）
node bench/diff.mjs --before bench/results/<before-dir> --after bench/results/<after-dir>
```

## 怎么读分数

- `link_rate`：程序记录挂上代理工具编号的比例，越高越好。
- `parent_child_accuracy`：父子调用边是否齐全，越高越好。
- `explore_noise_ratio`：探查类工具占比；过高说明列表噪音大，过低则折叠/聚合没东西可验。
- `incomplete_rate`：未完成调用占比，越低越好。
- `silent_drop`：解析损坏或关键记录丢失，必须为 `false`。
- `latency_overhead_p50`：进程级粗开销（含 preload 启动），越低越好；只作粗信号。

## 成功标准

- after 报告 `summary.pass === true`
- diff 无 `regressed`
- 至少一项原先失败的 scenario 变为 `fixed`，或本来全过则分数不恶化
