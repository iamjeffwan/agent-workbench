# `React`（界面框架）项目树开源库评估

## 目的

工作台当前的项目文档树已经有合适的视觉样式，但展开、选择、行内重命名、键盘操作和空白处右键等交互仍由页面自行维护。这次只评估可替代这部分“树控制逻辑”的开源库，不修改现有业务代码，也不要求改掉现有样式。

## 结论

后续重写项目文档树时，优先采用 `@headless-tree/react 1.7.0`（无样式树状态库）与 `@headless-tree/core 1.7.0`（树核心库）。它只提供树状态、事件和可访问属性，节点的 `DOM`（页面结构）与样式仍由工作台自己渲染，因此最符合“保留现有样式，只替换控制逻辑”的要求。[官方仓库说明](https://github.com/lukasbach/headless-tree#readme)明确说明它支持选择、展开、重命名、键盘、拖放和自主管理状态；[官方包清单](https://github.com/lukasbach/headless-tree/blob/main/packages/react/package.json)记录当前版本与 `MIT`（宽松许可证）。

`react-arborist 3.16.0`（完整树组件）也能解决当前问题，而且接入更快，但会同时引入固定的虚拟列表与 `react-dnd`（拖放库）等依赖。工作台目前文档量不大、暂时也不需要拖放，因此它更适合作为快速原型备选，而不是首选。[官方包清单](https://github.com/jameskerr/react-arborist/blob/main/modules/react-arborist/package.json)记录了版本、`MIT`（宽松许可证）及这些运行依赖。

## 对比

| 要求 | `@headless-tree/react`（无样式树状态库） | `react-arborist`（完整树组件） |
|---|---|---|
| 保留现有样式 | 最适合。库返回扁平节点和所需属性，页面自行渲染全部节点；[官方说明](https://github.com/lukasbach/headless-tree#readme) | 支持自定义节点、行、拖放预览和落点；但外层列表结构由库管理；[官方自定义渲染说明](https://github.com/jameskerr/react-arborist#custom-rendering) |
| 展开与折叠 | 内置，可由工作台管理全部或部分状态；[官方能力说明](https://headless-tree.lukasbach.com/) | 内置 `open`（展开）、`close`（折叠）和 `toggle`（切换）；[官方接口说明](https://github.com/jameskerr/react-arborist#openclose-methods) |
| 选择与受控数据 | 选择和数据加载是可组合功能；状态可交给工作台维护；[官方能力说明](https://headless-tree.lukasbach.com/) | 支持受控数据与外部同步选择；增删改移动由回调写回；[官方受控数据说明](https://github.com/jameskerr/react-arborist#control-the-tree-data) |
| 行内重命名与取消 | 内置重命名状态、`F2`（重命名快捷键）、提交和取消；输入框样式由工作台提供；[官方重命名说明](https://headless-tree.lukasbach.com/features/renaming/) | 内置编辑状态，`submit`（提交）与 `reset`（取消）均有明确接口；[官方节点接口](https://github.com/jameskerr/react-arborist#node-api-reference) |
| 键盘与可访问性 | 键盘功能可组合、可重映射，库生成可访问属性；[官方键盘说明](https://headless-tree.lukasbach.com/features/hotkeys/) | 内置键盘导航和 `ARIA`（无障碍属性）；[官方能力清单](https://github.com/jameskerr/react-arborist#features) |
| 空白处右键 | 库不限制页面事件，工作台可直接把菜单挂在树容器上 | 树容器直接提供 `onContextMenu`（右键事件），官方文档明确覆盖末行下方空白区域；[官方说明](https://github.com/jameskerr/react-arborist#handling-clicks-on-the-tree-container) |
| 虚拟化 | 不强制。需要时可接现有虚拟列表库；官方示例可处理十万级节点；[官方虚拟化说明](https://headless-tree.lukasbach.com/recipe/virtualization/) | 内置 `react-window`（虚拟列表库），所有树都会使用；[官方包清单](https://github.com/jameskerr/react-arborist/blob/main/modules/react-arborist/package.json) |
| 拖放 | 可选功能，不启用就不进入首版 | 内置并依赖 `react-dnd`（拖放库）；即使工作台暂时不用拖放，这些包仍属于运行依赖 |
| 许可证 | `MIT`（宽松许可证）；[许可证原文](https://github.com/lukasbach/headless-tree/blob/main/LICENSE) | `MIT`（宽松许可证）；[许可证原文](https://github.com/jameskerr/react-arborist/blob/main/LICENSE) |

## 推荐接入范围

第一步只启用同步数据、树结构、单选、键盘和重命名功能，继续使用工作台现有行组件与右键菜单。文件操作仍调用桌面主进程，树库只管理界面状态，不直接读写项目文件。

虚拟化和拖放暂不启用。项目文档通常不会达到需要虚拟化的规模；拖放还会引入移动文件、冲突处理和失败恢复等新的产品规则。等真实项目出现性能问题或明确需要拖放时，再加入对应功能。

`react-complex-tree`（旧树组件）不作为新选项。其官方仓库已将 `Headless Tree`（无样式树状态库）列为后继项目，新实现直接采用后继项目更合适。[官方迁移说明](https://headless-tree.lukasbach.com/guides/rct-migration/)

## 对当前问题的直接帮助

- 新建或重命名时，`Escape`（取消键）可以统一退出编辑状态，不会再留下无法处理的“未命名”输入框。
- 文件夹点击与箭头点击可以分别定义为选择和展开，不需要让页面自己维护多套临时状态。
- 右键菜单仍由工作台控制，因此文件夹、文件和树空白处可以显示不同操作，同时保持当前视觉样式。
- 数据修改成功后再刷新树；失败时保留选择并显示错误，不让树的临时状态冒充真实文件状态。
