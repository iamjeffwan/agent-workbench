# Cursor hooks 补全（验证用）

Cursor 自带的 `agent-transcripts` JSONL 通常缺少工具输出，且不一定带稳定工具编号。项目里用 hooks 在工具执行前后补记账，并对会启动 Node 的 `Shell` 自动对齐程序追踪。

## 配置

- `.cursor/hooks.json`
- `.cursor/hooks/record-agent-tool.mjs`：工具结束后记账
- `.cursor/hooks/inject-shell-trace.mjs`：Shell 启动前注入
- `.cursor/hooks/run-with-trace.mjs`：带进程来源编号和预加载执行命令
- `.cursor/hooks/record-code-state.mjs`：轮次开始和结束时记录代码状态

监听：

- `preToolUse`（matcher: `Shell`）
- `postToolUse`
- `postToolUseFailure`
- `beforeSubmitPrompt`
- `stop`

## 写出位置

- 代理步骤：`.agent-workbench/agent-steps.jsonl`
- 程序记录：`.agent-workbench/trace-records.jsonl`
- 代码变化：`.agent-workbench/code-changes.jsonl`

代理步骤关键字段：

- `id`：优先用 Cursor 的 `tool_use_id`（也是进程来源编号）
- `name`：工具名
- `arguments` / `output`：摘要后的参数和输出
- `provider`: `cursor`
- `source`: `cursor-hook`
- `launchesProcess`：是否可能启动进程（如 Shell）

## Shell 自动对齐

当 `Shell` 命令看起来会启动 Node / npm / pnpm / yarn / bun，且：

- `AGENT_WORKBENCH_HOME`（默认本仓根）下的 `packages/program-tracer/dist/guest/preload.js` 已构建
- 被观察项目已有追踪清单（`.agent-workbench/trace-manifest.json` 或 Beside worker 下同名文件）

外部项目接入见 `dogfood-beside.md` 与 `templates/beside-cursor-hooks/`。

hooks 会把命令改写成经 `run-with-trace.mjs` 执行，并注入：

- `AGENT_WORKBENCH_PROCESS_ORIGIN_ID=<tool_use_id>`
- `NODE_OPTIONS=--import <preload>`
- 清单与记录路径

验证页即可看到：

```text
Shell
  └─ 边界方法（程序追踪）
```

不匹配 Node 启动的命令（例如纯 `git status`）不会改写。

## 怎么验收

1. 构建追踪包：`pnpm --filter @agent-workbench/program-tracer build`
2. 准备清单：`node packages/program-tracer/dist/host/cli.js apps/worker --out .agent-workbench/trace-manifest.json`
3. 确认 Cursor 已加载项目 hooks（必要时重载窗口）
4. 让代理用 Shell 跑一条 Node 相关命令（例如 worker dogfood / `node -e ...` 且会加载清单中的模块）
5. 打开验证页：`pnpm --filter @agent-workbench/program-tracer view`

## 和旁路 transcript 的关系

| 来源 | 作用 |
|------|------|
| `cursor-adapter` 读 transcript | 事后回放；常无输出 |
| hooks 实时追加 | 开发调试主路径；有 `tool_use_id` 和输出 |
| Shell preToolUse 注入 | 把程序追踪挂到对应 Shell 工具步骤下 |

## 尚未做

- Task / 非 Shell 启动路径的自动注入
- 非 Git 项目的轮次代码差异
