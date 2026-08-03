# 验证页展示规范

操作流展示规范。本地验证页与 Electron 桌面壳共用同一套模型（`packages/timeline`）。

## 分层

1. **执行轮次**  
   优先按 `generationId` 分组；没有时退回 `conversationId` 或「未分组」。

2. **探查工具组（默认折叠）**  
   - `Read`
   - `Grep`
   - `Glob`
   - `SemanticSearch`
   - `WebSearch` / `WebFetch`（若出现）

   展示为：`文件探查 × N`，详情里给各类计数。勾选「展开探查」后才逐条列出。

3. **主操作工具（默认展开）**  
   - `Shell`：可挂程序调用子树  
   - `Write` / `StrReplace` / `Delete` / `EditNotebook`  
   - `Task` / `AwaitShell`

4. **程序调用**  
   - 挂在对应 `Shell`（进程来源编号 = 工具编号）下  
   - 程序内部再用 `parentCallId` 表达父子

## 不做什么

- 不把探查工具默认当成父步骤去挂程序追踪  
- 不在验证页假装 Cursor transcript 已有完整工具输出；有 hooks 记录时优先用 hooks

## 模拟数据

```text
node packages/program-tracer/scripts/seed-mock-timeline.mjs
pnpm --filter @agent-workbench/program-tracer view
```

会写入两轮对话：大量探查 + Write/Shell，以及多条程序调用（含父子与一次失败）。
