# Phase A 真实字段映射与 Schema 对照

> 目的：用真实 Codex、Claude Code 会话记录，核对《Agent 原始日志与可观测能力矩阵 v0.1》中的字段假设，为 Adapter 和 Schema v1 提供证据。
>
> 本文是证据补充，不替换原能力矩阵。原矩阵中的“未确认”字段，在本文完成真实日志核对前不改成稳定结论。

## 1. 样本范围

来源：`FrontisAI/NatureBench-traces`（公开研究会话数据集）

样本目录：`F:\agent-workbench\fixtures\external\naturebench`

样本情况：

| Agent | 样本数 | 运行配置 | 有效记录 | 运行状态 |
|---|---:|---|---:|---|
| Codex | 3 | CLI `0.121.0`，模型 `gpt-5.4` | 3,220 | 3 个成功 |
| Claude Code | 3 | CLI `2.1.150`，模型 `claude-opus-4.7` | 1,658 | 2 个成功，1 个超时 |

6 个 `transcript.jsonl`（逐行会话日志）均能完整解析，非法行数为 0。每个样本同时保存 `result.json`（运行结果元数据）。

详细哈希和逐文件统计见：

- `F:\agent-workbench\fixtures\external\naturebench\SOURCES.md`
- `F:\agent-workbench\fixtures\external\naturebench\inventory\inventory.json`
- `F:\agent-workbench\fixtures\external\naturebench\inventory\event-catalog.md`

## 2. 字段来源标记

| 标记 | 含义 |
|---|---|
| `direct`（直接） | 原始会话中有明确字段，可以直接读取 |
| `derived`（推导） | Adapter 根据多个原始记录或事件顺序推导 |
| `supplemented`（补采集） | 需要工作台从运行环境、Git 或文件系统额外采集 |
| `unavailable`（不可用） | 当前样本或当前模式下无法可靠获得 |
| `not_observed`（未观察到） | 当前样本没有出现，不能直接等同于永久不可用 |

## 3. Session 字段映射

| 统一字段 | Codex 真实位置 | Claude Code 真实位置 | 来源结论 | Schema 建议 |
|---|---|---|---|---|
| `session_id`（会话标识） | `session_meta.payload.id` | 顶层 `sessionId` | 两家均为 `direct` | 必填 |
| `source_agent`（来源 Agent） | 原始记录没有统一值，Adapter 注入 | 原始记录没有统一值，Adapter 注入 | `supplemented` | 必填 |
| `source_version`（来源版本） | `session_meta.payload.cli_version`，样本为 `0.121.0` | 顶层 `version`，样本为 `2.1.150` | 两家均为 `direct` | 必填 |
| `model`（模型） | `turn_context.payload.model`，部分记录也有模型相关信息 | `message.model` | 两家均为 `direct`，粒度不同 | 可选 |
| `provider`（模型提供方） | `session_meta.payload.model_provider` | 当前样本未见稳定提供方字段 | Codex `direct`；Claude `not_observed` | 可选 |
| `cwd`（工作目录） | `session_meta.payload.cwd`、`turn_context.payload.cwd` | 顶层 `cwd` | 两家均为 `direct` | 可选但建议保留 |
| `project_id`（工作台项目标识） | 原始记录未见 | 原始记录未见 | `supplemented` | 工作台生成 |
| `start/end time`（起止时间） | 顶层 `timestamp`；`task_started.started_at`；`task_complete.completed_at` | 顶层 `timestamp` | Codex 结束时间较明确；Claude 需要 `derived` | 可选 |
| `git metadata`（Git 信息） | 当前样本未见稳定 Git 字段 | 顶层 `gitBranch` | Claude `direct`；Codex `not_observed` | 工作台补采集 |
| `permission`（权限策略） | `turn_context.payload.approval_policy`、`sandbox_policy` | 顶层 `permissionMode` | 两家都有策略信息，但不是逐次审批决定 | 可选，不能当作审批事件 |
| `raw_ref`（原始记录引用） | Adapter 根据文件、行号、记录标识生成 | Adapter 根据文件、行号、记录标识生成 | `supplemented` | 必填 |

### Session 结论

`session_id`、`source_version`、`raw_ref` 可以进入 Session 核心字段。`project_id`、Git 信息和完整运行环境不应从 Agent 日志中强行推断，应由工作台补采集。

## 4. Turn 与 Message 映射

| 统一概念 | Codex 真实位置 | Claude Code 真实位置 | 来源结论 | 当前判断 |
|---|---|---|---|---|
| 用户输入 | `event_msg.payload.type=user_message`，内容在 `payload.message` | 顶层 `type=user`，内容在 `message.role/message.content` | `direct` | 公共核心 |
| Agent 输出 | `event_msg.payload.type=agent_message`；也有 `response_item.payload.type=message` | 顶层 `type=assistant`，内容在 `message.content` | `direct` | 公共核心 |
| native turn ID（原生 Turn 标识） | `task_started.payload.turn_id`、`task_complete.payload.turn_id` | 用户记录中的 `promptId` 可用，但语义和完整性仍需验证 | Codex `direct`；Claude `partial` | 只放入 `source_ref` |
| canonical turn ID（工作台 Turn 标识） | 不能直接使用原生 `turn_id` | 不能直接使用 `promptId` | `derived` | 按工作台 Turn 定义生成 |
| Turn 开始 | `task_started` 或用户消息 | 用户消息 | Codex `direct`；Claude `derived` | 可作为生命周期事件 |
| Turn 完成 | `task_complete`，含 `completed_at`、`duration_ms` | 当前样本没有与 Codex 对应的稳定完成记录 | Codex `direct`；Claude `derived/partial` | 不能要求两家都直接提供 |
| Token | `event_msg.payload.type=token_count`，含 `total_token_usage`、`last_token_usage` | `message.usage`，含输入、输出和缓存字段 | `direct`，结构不同 | 统一到 Usage |
| Turn 耗时 | `task_complete.payload.duration_ms` | 当前样本没有稳定的普通 Turn duration；压缩记录有 `compactMetadata.durationMs` | Codex `direct`；Claude `not_observed` | 可选 |
| reasoning summary（推理摘要） | `response_item.payload.type=reasoning`，含 `summary`、`content`、`encrypted_content` | 观察到 `message.content[].type=thinking` | Codex 有显式记录；Claude 不应直接当作公共摘要 | 可选扩展，禁止作为必填 |

### Turn 结论

工作台仍使用自己的 Turn 定义：一次用户输入开始，到下一次用户输入之前的完整执行过程。两家的原生 ID 只保存在 `source_ref`（来源引用）中。

## 5. Event 映射

| 统一 Event | Codex 原始事件 | Claude Code 原始事件 | 来源结论 | Schema v1 判断 |
|---|---|---|---|---|
| `message`（消息） | `payload.type=user_message`、`agent_message`、`message` | `type=user`、`assistant`、`system` | `direct` | 核心事件 |
| `tool_call`（工具调用） | `payload.type=function_call`；字段 `name`、`arguments`、`call_id`；另有 `custom_tool_call` | `message.content[].type=tool_use`；字段 `name`、`input`、工具标识 | `direct` | 核心事件 |
| `tool_result`（工具结果） | `payload.type=function_call_output`；字段 `call_id`、`output`；另有 `custom_tool_call_output` | `message.content[].type=tool_result`；同时有 `toolUseResult`、`sourceToolAssistantUUID` | `direct` | 核心事件 |
| `tool_category`（工具类别） | 通过 `payload.name` 识别，如 `exec_command`、`write_stdin`、`apply_patch` | 通过工具名识别，如 `Bash`、`Read`、`Write`、`Edit` | `derived` | 保留 `source_tool_name` |
| `file_change`（文件变化） | 当前样本没有独立文件变化事件；可能从工具输出或工作区差异推导 | `toolUseResult.type=create/update`，含 `filePath`、`structuredPatch`、`originalFile` 等 | Codex `not_observed`；Claude `direct/partial` | 不作为直接必填事件 |
| `error`（错误） | 当前样本没有稳定通用错误事件；结果主要表现为输出内容 | `message.content[].is_error`、`toolUseResult.success` 等 | Claude `direct/partial`；Codex `partial/not_observed` | 核心事件，但允许字段缺失 |
| `lifecycle`（生命周期） | `session_meta`、`task_started`、`task_complete`、`turn_context` | `system`、`compact_boundary`、队列记录等 | 两家 `direct`，事件集合不同 | 核心事件，允许缺失 |
| `permission_request`（权限请求） | 当前样本只有 `approval_policy`，未见逐次决定 | 当前样本只有 `permissionMode`，未见逐次决定 | `not_observed` | 后续用 Hook 或实时接口补充 |
| `context_compaction`（上下文压缩） | 当前样本未观察到对应事件 | `system.subtype=compact_boundary`，含 `compactMetadata` | Claude `direct`；Codex `not_observed` | 生命周期扩展 |
| `subagent`（子 Agent） | 当前样本未观察到独立子 Agent 事件 | 观察到 `TaskCreate`、`TaskUpdate`、`TaskOutput` 等工具和任务结果 | Claude `partial`；Codex `not_observed` | 允许缺失，先保留扩展 |
| `mcp`（MCP 调用） | 当前样本未看到稳定 MCP 服务标识 | 当前样本未看到稳定 MCP 服务标识 | `not_observed` | 仍归入 `tool_call/tool_result`，服务信息放扩展 |

## 6. Tool Call 配对结论

### Codex

当前样本可以使用：

```text
function_call.call_id
    ↕
function_call_output.call_id
```

`custom_tool_call` 和 `custom_tool_call_output` 也有对应的 `call_id`，但其工具语义需要 Adapter 根据名称和输入结构继续分类。

### Claude Code

当前样本可以使用：

```text
tool_use.id / tool_use.tool_use_id
    ↕
tool_result.tool_use_id
```

同时存在 `sourceToolAssistantUUID` 和顶层 `uuid/parentUuid`，这些字段应保留在 `source_ref`，不直接替代统一的 `event_id` 或 `turn_id`。

## 7. Schema v1 的实际收缩建议

### 建议保留为核心

```text
Session.session_id
Session.source_agent
Session.source_version
Session.raw_ref
Session.capability_manifest

Turn.canonical_turn_id
Turn.source_ref

Event.event_id
Event.turn_id
Event.sequence
Event.type
Event.actor
Event.status?
Event.source_agent
Event.source_event_type
Event.source_version
Event.adapter_version
Event.provenance
Event.fidelity
Event.raw_ref

Event.type = message | tool_call | tool_result | error | lifecycle | file_change
```

### 只能作为可选字段

```text
timestamp
model
provider
cwd
duration
exit_code
reasoning_summary
approval
MCP server metadata
subagent metadata
cost
```

### 必须由工作台补采集或推导

```text
canonical_turn_id
project_id
project profile
git metadata
TurnDiff
完整文件变化
permission_decision
```

### 不能因为当前样本未出现就直接判定不可用

```text
Codex 的独立 file_change
Codex 的 error status
两家的 MCP server metadata
Codex 的 context compaction
Claude Code 的稳定 Turn 完成事件
```

这些项目需要后续用专门的同任务 fixture（测试样本）验证。

## 8. 对 Adapter 的直接要求

1. Codex Adapter 识别 `session_meta`、`turn_context`、`user_message`、`agent_message`、`function_call`、`function_call_output`、`token_count`、`reasoning`、`task_started`、`task_complete`。
2. Claude Code Adapter 识别 `user`、`assistant`、`system`、`tool_use`、`tool_result`、`thinking`、`compact_boundary` 和文件操作结果。
3. 两家 Adapter 都必须保留原始事件类型和原始记录引用。
4. 未识别事件不能静默丢弃，必须增加 `unknown_source_event_count`。
5. 无法直接映射的字段必须记录为 `derived`、`supplemented` 或 `unavailable`，不能伪装成 `direct`。
6. 文件差异统一交给 `DiffBuilder`（差异构建器），不能把 Claude 的 `structuredPatch` 设计成公共唯一来源。

## 9. 当前尚未确认的字段

以下结论仍需用本项目自己的同任务样本完成：

1. Codex 和 Claude Code 在成功命令、失败命令中的退出码稳定表示。
2. 两家对拒绝、超时、中断的完整事件表现。
3. MCP 调用是否包含服务名、工具名和调用结果的稳定标识。
4. Edit/Write/patch 后是否可以只依靠原始日志重建完整 Diff。
5. 用户多轮输入、上下文压缩、恢复会话后的 Turn 边界。
6. 子 Agent 的父子关系是否能稳定映射成统一生命周期事件。

## 10. 当前结论

真实样本支持以下方向：

```text
Agent 原始记录
    ↓
Agent-specific Adapter
    ↓
Session / Turn / Event
    + RawRef
    + Usage
    + CapabilityManifest
    ↓
TurnDiff / ProjectEnvironment / Review
```

公共协议应围绕事件语义建立，而不是围绕某一家日志的顶层 `type` 建立。Codex 和 Claude Code 的工具调用、工具结果、消息和 Token 已经具备共同核心；文件变化、权限决定、MCP、子 Agent 和 Turn 完成状态仍必须保留可缺失性。

本表完成的是“真实字段映射”阶段，尚不代表 Schema v1 已稳定。稳定前仍需要本项目自己的同任务 fixture 和 Adapter contract test（Adapter 合约测试）。

## 11. 当前阶段边界（2026-08-19）

当前实现已经具备 `Codex`（编程智能体）统一事件、轮次差异、项目画像和环境变化，并通过真实轮次验证。公开研究数据中的 `Codex`（编程智能体）与 `Claude Code`（编程智能体）样本也已支持公共语义的初步收缩，因此可以开始第一阶段审查域开发。

当前边界约定如下：

1. 审查域先按 `Codex-first`（优先支持 Codex）的主动审查闭环开发，输入限定为标准事件、轮次差异和项目环境；证据不足时再按原始引用补充上下文。
2. 首批范围包括审查案例、审查运行、模型判断、证据、人工标注、证据包构建与结构化输出校验。
3. `Claude Code`（编程智能体）当前只有公开研究会话样本验证，尚未完成本项目真实运行测试；`Gemini CLI`（Gemini 命令行工具）暂缓测试和正式适配。两者不阻塞第一阶段主动审查。
4. 当前数据结构继续作为可演进的 `v1`（第一版）使用，但不标记为跨智能体稳定版。三家真实样本、兼容性测试和未知或有损事件解释完成后，再评估稳定标记。
5. 每日自动审查、跨轮次问题去重、优化闭环和正式多智能体兼容不进入首批开发范围。
