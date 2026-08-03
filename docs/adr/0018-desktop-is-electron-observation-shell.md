# 桌面端为 Electron 观察壳

Agent 工作台的最终观察平面是本地桌面应用。首版使用 Electron：主进程复用 Node 栈读取项目目录、监听 `.agent-workbench` 记录并组装操作流；渲染进程只负责展示。首版以文件 ingest 为主，不在第一刀实现 guest IPC 与桌面侧进程启动注入。
