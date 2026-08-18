# Agent 原始日志与可观测能力矩阵

> 调研日期：2026-08-17  
> 目标：为统一 `Session → Turn → Event` 协议的 `Schema v1` 提供字段级设计依据。  
> 范围：Codex、Claude Code、Gemini CLI。  
> 来源：仅采用官方文档和官方 GitHub 仓库。

## 1. 结论

统一协议采用三层：

1. 公共稳定核心：所有 Agent 都能映射，或可由工作台可靠补采集。
2. Capability Manifest：声明当前 Agent / 版本实际暴露到什么深度。
3. extensions：保留 Agent 特有能力，不污染公共 Schema。

每条规范化数据记录来源：

- `direct`：原始数据直接提供；
- `derived`：Adapter 从原始数据推导；
- `supplemented`：工作台中间件额外采集；
- `unavailable`：当前 Agent / 模式无法可靠获得。

## 2. Turn 语义

工作台继续采用自己的定义：

> `Turn` = 一次用户输入开始，到下一次用户输入之前的完整 Agent 执行过程。

上游 Agent 的 native turn/task/prompt ID 只保存在 source reference 中，不能直接作为工作台 Turn ID。

建议：

```text
canonical_turn_id
source_turn_id?
```

## 3. 数据源

| Agent | 历史会话数据 | 实时结构化接口 | Hook / Telemetry | Adapter 建议 |
|---|---|---|---|---|
| Codex | rollout JSONL | `codex exec --json` / App Server | 有扩展体系 | 历史读 rollout；受控运行优先 exec/App Server |
| Claude Code | transcript JSONL | Agent SDK typed messages / stream | Hooks 完整 | 历史读 transcript；实时用 Hooks 增强 |
| Gemini CLI | 本地 session | `stream-json` | Hooks + OpenTelemetry | 历史读 session；实时用 Hooks/stream-json |

## 4. Session 能力矩阵

符号：D=直接；P=部分/依模式；M=中间件补；O=可选。

| 字段 | Codex | Claude Code | Gemini CLI | Schema 决策 |
|---|---:|---:|---:|---|
| session_id | D | D | D | 必填 |
| source_agent | M | M | M | 必填，Adapter 注入 |
| source_version | D | M | M | 必填，Adapter 保证 |
| cwd | D | D | D | 可选但强烈建议 |
| project_id | M | M | M | 工作台统一生成 |
| model | D/P | D | D | 可选 |
| provider | D/P | D/P | P | 可选 |
| start/end time | D/P | P | P | 可选，不能依赖时间戳排序 |
| git metadata | D/P | M | M | 工作台统一补采集 |
| sandbox/permission | D/P | D | D/P | 可选 |
| raw_ref | D | D | D | 必填 |

## 5. Turn / Message

| 能力 | Codex | Claude Code | Gemini CLI | 决策 |
|---|---:|---:|---:|---|
| 用户输入 | D | D | D | Turn 核心 |
| Agent 输出 | D | D | D | message Event |
| native turn/prompt id | D/P | P | P | source ref |
| Turn 完成状态 | D | D | D | 标准字段 |
| Token | D/P | D | D | Usage |
| 耗时 | P | D | D/P | 可选 |
| reasoning summary | D/P | O | O | 绝不能必填 |
| 原始 CoT | 不依赖 | 不依赖 | 不依赖 | 不进入公共协议 |

## 6. Tool Call

| 能力 | Codex | Claude Code | Gemini CLI | 决策 |
|---|---:|---:|---:|---|
| call id | D | D | D/P | 标准 |
| tool name | D | D | D | 必填 |
| arguments | D | D | D | 标准 |
| result | D | D | D | 标准 |
| error | D/P | D | D | 标准 |
| duration | D/P | D（Hook） | D（Hook/Telemetry） | 可选 |
| approval | D/P | D | D | 可选 |
| MCP metadata | D | P | D/P | 可选扩展 |

统一：

```text
tool_call
tool_result
tool_category = shell | filesystem | search | mcp | browser | agent | other
```

保留 `source_tool_name`。

## 7. Shell

| 能力 | Codex | Claude Code | Gemini CLI | 决策 |
|---|---:|---:|---:|---|
| command | D | D | D | 标准 |
| cwd | D/P | P | P | 可选 |
| output | D | D/P | D/P | 标准内容，可 Raw 引用 |
| exit_code | D | P | P | 可选 |
| duration | D/P | D | D | 可选 |
| denied/declined | D | D | D | status |

不为了 exit_code 强行拦截所有 Agent；原生没有就空。

## 8. 文件与 Diff

| 能力 | Codex | Claude Code | Gemini CLI | 决策 |
|---|---:|---:|---:|---|
| 文件路径 | D | D | D | 标准 |
| 读写输入 | D/P | D | D | 标准/Raw |
| add/update/delete | D | D/P | D/P | 标准 |
| 原生 unified diff | D/P | 不保证 | 不保证 | 不能必填 |
| pre-edit snapshot | P | D | 不保证 | 扩展 |
| Turn 汇总 diff | 可生成 | 可生成 | 可生成 | 统一 DiffBuilder |

`DiffBuilder` 应成为跨 Agent 公共中间件，而不是 Codex 专属脚本。

## 9. Error

| 能力 | Codex | Claude Code | Gemini CLI | 决策 |
|---|---:|---:|---:|---|
| Turn error | D | D | D | error Event |
| tool failure | D | D | D | tool_result.status |
| error text | D | D | D | 标准 |
| machine-readable error type | P | D/P | D/P | 可选 |
| user interrupt | D/P | D | P | lifecycle |
| permission denial | D | D | D | approval |

## 10. Token / Cost

统一 Usage：

```text
input_tokens?
cached_input_tokens?
output_tokens?
reasoning_tokens?
total_tokens?
cost?
currency?
```

Token 三家均可获取到较丰富数据，但粒度不同。`cost` 绝不能设为必填；订阅制运行并不天然有可归因的美元成本。

## 11. MCP

仍然作为 `tool_call/tool_result`，增加：

```text
tool_category = mcp
mcp.server?
mcp.tool?
mcp.metadata?
```

不单独再造 MCP 专用事件体系。

## 12. Lifecycle / Subagent

v1 支持通用 lifecycle 类型，但全部允许缺失：

```text
session_start
session_end
turn_start
turn_end
permission_request
permission_decision
context_compaction
subagent_start
subagent_end
```

Claude Hooks 与 Gemini Hooks 在生命周期事件上非常丰富；Codex protocol/App Server 也有大量事件，但 rollout 映射需要 Adapter 兼容。

## 13. 必须自建的 5 个中间件

### DiffBuilder
统一生成 Turn 级代码变化。

### ProjectEnvironmentBuilder
生成技术栈、包管理器、关键依赖、Git branch/commit、项目规则、Skill、MCP、测试命令等工程环境。

### ToolNormalizer
统一不同工具名称的工程语义。

### SecretSanitizer
只处理高风险 Secret：API Key、Access Token、密码、Cookie/Session、OAuth Secret、数据库凭据、SSH/私钥、云凭据。

### CapabilityDetector
记录当前 Session 实际可观察能力，而不是理论能力。

## 14. Event 来源与保真度

建议每条 Event 从 v1 就带：

```text
source_agent
source_version
source_event_type
adapter_version
provenance: direct | derived | supplemented
fidelity: full | partial
raw_ref
```

不要因为字段为空，就默认“这个行为没有发生”；先看 Capability Manifest。

## 15. Capability Manifest

建议 Session 保存实际能力快照，例如：

```json
{
  "agent": "claude-code",
  "capabilities": {
    "user_message": "full",
    "agent_message": "full",
    "tool_call": "full",
    "tool_result": "full",
    "tool_duration": "full",
    "file_diff": "derived",
    "token_usage": "full",
    "reasoning_summary": "partial",
    "approval_events": "full"
  }
}
```

这是未来做 Agent 可观测深度比较的直接数据源。

## 16. Adapter 版本与回归

保存脱敏真实 fixture：

```text
fixtures/
  codex/<version>/
  claude-code/<version>/
  gemini-cli/<version>/
```

升级流程：

```text
检测 Agent 新版本
→ 收集真实日志样本
→ 兼容测试
→ 统计未知事件/解析错误/信息损失
→ 更新 Adapter
→ 尽量不动公共 Schema
```

建议持续统计：

```text
unknown_source_event_count
parse_error_count
lossy_event_count
unsupported_field_count
```

## 17. 对 Schema v1 的最终导向

第一版公共对象先控制在：

```text
Session
Turn
Event
RawRef
Usage
CapabilityManifest
```

Event 第一版核心语义：

```text
message
reasoning_summary
tool_call
tool_result
file_change
error
lifecycle
```

Shell、MCP、search、browser 等通过 category/subtype 表达。

## 18. 当前 Codex 项目怎么改

现有代码不用推倒：

1. 现有 Codex 解析器包装成 `CodexAdapter`。
2. 现有 Timeline 对象逐步迁到统一 Event。
3. Turn diff 脚本抽成 `DiffBuilder`。
4. Event 增加 `raw_ref + provenance + fidelity`。
5. Session 增加 Capability Manifest。
6. 未识别 Codex 事件必须保留 Raw 引用并统计，不能静默丢弃。
7. 先用真实 Claude/Gemini fixture 验证 Schema，再写完整 Adapter。

## 19. 还必须用真实日志确认的项目

官方资料证明能力存在，但下面这些不能只靠文档锁死：

1. Claude transcript JSONL 当前所有 line type 与字段。
2. Gemini 本地 session 文件当前实际 JSON 结构。
3. Codex 当前安装版本 rollout 中所有 `type/payload.type`。
4. 三家 interactive 模式 timestamp 的实际完整度。
5. Claude/Gemini shell result 中 exit code 的稳定表示。
6. 三家 Edit/Write 是否能无损重建 diff。
7. MCP 在各家本地 transcript 中的真实标记。
8. context compression 前后数据如何呈现。

建议制作统一 fixture 任务：

```text
普通问答
读取文件
修改文件
成功命令
失败命令
MCP 调用
多轮用户输入
子 Agent（支持时）
```

**做完真实 fixture 对照后，再锁定 Schema v1。**

## 20. 官方依据

### Codex
- https://developers.openai.com/codex/non-interactive-mode
- https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs
- https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs
- https://github.com/openai/codex/blob/main/codex-rs/docs/protocol_v1.md

### Claude Code
- https://code.claude.com/docs/en/sessions
- https://code.claude.com/docs/en/claude-directory
- https://code.claude.com/docs/en/agent-sdk/python
- https://code.claude.com/docs/en/hooks

### Gemini CLI
- https://geminicli.com/docs/cli/session-management/
- https://geminicli.com/docs/cli/headless/
- https://geminicli.com/docs/hooks/reference/
- https://geminicli.com/docs/cli/telemetry/
- https://github.com/google-gemini/gemini-cli
