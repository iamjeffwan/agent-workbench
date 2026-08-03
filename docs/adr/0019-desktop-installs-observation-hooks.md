# 打开项目时由桌面注入观察配置

使用者在桌面应用中选择项目后，工作台自动把托管的 Cursor hooks 写入该项目（`.agent-workbench/cursor-hooks/`），并合并进 `.cursor/hooks.json`。用户不必预先自备适配 hooks。重新打开或刷新项目时会按同一规则更新托管条目，并保留项目里原有的非托管 hooks。
