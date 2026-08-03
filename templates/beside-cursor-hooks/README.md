# Beside 用 Cursor hooks 模板

复制到 Beside 仓库：

1. 设置 `AGENT_WORKBENCH_HOME` 指向本工作台仓根目录
2. 将本目录的 `hooks.json` 与 `*.mjs` 放到 Beside 的 `.cursor/` / `.cursor/hooks/`
3. 在工作台仓执行 `pnpm --filter @agent-workbench/program-tracer build`
