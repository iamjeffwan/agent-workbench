# Phase A 原始会话格式盘点

生成时间：2026-08-17T08:51:28.481Z
样本文件数：6；有效记录数：4878；非法行数：0

> 这是一份结构盘点，不是统一协议。字段值只展示少量短样本，完整提示词、命令输出和工具结果仍保留在原始文件中。

## 文件清单

| 文件 | 记录数 | 非法行 | 字节数 | SHA-256 前缀 |
| --- | --- | --- | --- | --- |
| `claude-code/opus-4.7/s41467-025-63412-3/transcript.jsonl` | 468 | 0 | 1103464 | `e88cf792151d6b38…` |
| `claude-code/opus-4.7/s41551-024-01257-9/transcript.jsonl` | 403 | 0 | 774926 | `5d4207396283cda8…` |
| `claude-code/opus-4.7/s41592-024-02191-z/transcript.jsonl` | 787 | 0 | 1757605 | `b189028b60eab4c0…` |
| `codex/gpt-5.4/s41467-025-63412-3/transcript.jsonl` | 1763 | 0 | 1145134 | `6168a339cd4e9e09…` |
| `codex/gpt-5.4/s41551-024-01257-9/transcript.jsonl` | 416 | 0 | 366014 | `f898299e52137d26…` |
| `codex/gpt-5.4/s41592-024-02191-z/transcript.jsonl` | 1041 | 0 | 878691 | `14449ffed4e5239e…` |

## 类型字段统计

| 字段路径=值 | 次数 |
| --- | --- |
| `type=response_item` | 2266 |
| `type=event_msg` | 946 |
| `message.type=message` | 792 |
| `type=assistant` | 792 |
| `payload.type=function_call` | 751 |
| `payload.type=function_call_output` | 750 |
| `payload.type=token_count` | 737 |
| `type=user` | 543 |
| `message.content[].type=tool_use` | 538 |
| `message.content[].caller.type=direct` | 538 |
| `message.content[].type=tool_result` | 537 |
| `payload.type=reasoning` | 485 |
| `message.usage.iterations[].type=message` | 433 |
| `payload.type=message` | 208 |
| `payload.type=agent_message` | 195 |
| `payload.content[].type=output_text` | 195 |
| `message.content[].type=thinking` | 189 |
| `type=ai-title` | 98 |
| `type=last-prompt` | 96 |
| `type=attachment` | 88 |
| `message.content[].type=text` | 65 |
| `attachment.type=task_reminder` | 52 |
| `type=queue-operation` | 38 |
| `payload.type=custom_tool_call` | 36 |
| `payload.type=custom_tool_call_output` | 36 |
| `toolUseResult.type=create` | 20 |
| `toolUseResult.type=update` | 19 |
| `attachment.type=queued_command` | 16 |
| `payload.content[].type=input_text` | 16 |
| `attachment.type=file` | 15 |
| `attachment.content.type=text` | 15 |
| `toolUseResult.type=text` | 11 |
| `payload.type=task_started` | 5 |
| `type=turn_context` | 5 |
| `payload.sandbox_policy.type=danger-full-access` | 5 |
| `payload.type=user_message` | 5 |
| `payload.type=task_complete` | 4 |
| `attachment.type=skill_listing` | 3 |
| `type=system` | 3 |
| `subtype=compact_boundary` | 3 |
| `type=session_meta` | 3 |
| `attachment.type=edited_text_file` | 1 |
| `attachment.type=date_change` | 1 |

## 工具名称统计

| 名称 | 次数 |
| --- | --- |
| `write_stdin` | 536 |
| `Bash` | 393 |
| `exec_command` | 215 |
| `Write` | 39 |
| `apply_patch` | 36 |
| `TaskOutput` | 30 |
| `Edit` | 27 |
| `TaskUpdate` | 22 |
| `Read` | 11 |
| `TaskCreate` | 11 |
| `TaskStop` | 3 |
| `TaskList` | 1 |
| `ScheduleWakeup` | 1 |

## 主要字段路径

| 字段路径 | 出现次数 |
| --- | --- |
| `type` | 4878 |
| `timestamp` | 4684 |
| `payload` | 3220 |
| `payload.type` | 3212 |
| `sessionId` | 1658 |
| `payload.call_id` | 1573 |
| `parentUuid` | 1426 |
| `isSidechain` | 1426 |
| `uuid` | 1426 |
| `userType` | 1426 |
| `entrypoint` | 1426 |
| `cwd` | 1426 |
| `version` | 1426 |
| `gitBranch` | 1426 |
| `message` | 1335 |
| `message.role` | 1335 |
| `message.content` | 1335 |
| `message.content[]` | 1329 |
| `message.content[].type` | 1329 |
| `message.id` | 792 |
| `message.type` | 792 |
| `message.model` | 792 |
| `message.usage` | 792 |
| `message.usage.input_tokens` | 792 |
| `message.usage.cache_creation_input_tokens` | 792 |
| `message.usage.cache_read_input_tokens` | 792 |
| `message.usage.output_tokens` | 792 |
| `message.usage.cache_creation` | 792 |
| `message.usage.cache_creation.ephemeral_5m_input_tokens` | 792 |
| `message.usage.cache_creation.ephemeral_1h_input_tokens` | 792 |
| `payload.name` | 787 |
| `payload.output` | 786 |
| `payload.arguments` | 751 |
| `payload.info` | 737 |
| `payload.rate_limits` | 737 |
| `payload.rate_limits.limit_id` | 737 |
| `payload.rate_limits.limit_name` | 737 |
| `payload.rate_limits.primary` | 737 |
| `payload.rate_limits.primary.used_percent` | 737 |
| `payload.rate_limits.primary.window_minutes` | 737 |
| `payload.rate_limits.primary.resets_at` | 737 |
| `payload.rate_limits.secondary` | 737 |
| `payload.rate_limits.secondary.used_percent` | 737 |
| `payload.rate_limits.secondary.window_minutes` | 737 |
| `payload.rate_limits.secondary.resets_at` | 737 |
| `payload.rate_limits.credits` | 737 |
| `payload.rate_limits.plan_type` | 737 |
| `payload.info.total_token_usage` | 734 |
| `payload.info.total_token_usage.input_tokens` | 734 |
| `payload.info.total_token_usage.cached_input_tokens` | 734 |
| `payload.info.total_token_usage.output_tokens` | 734 |
| `payload.info.total_token_usage.reasoning_output_tokens` | 734 |
| `payload.info.total_token_usage.total_tokens` | 734 |
| `payload.info.last_token_usage` | 734 |
| `payload.info.last_token_usage.input_tokens` | 734 |
| `payload.info.last_token_usage.cached_input_tokens` | 734 |
| `payload.info.last_token_usage.output_tokens` | 734 |
| `payload.info.last_token_usage.reasoning_output_tokens` | 734 |
| `payload.info.last_token_usage.total_tokens` | 734 |
| `payload.info.model_context_window` | 734 |
| `payload.content` | 693 |
| `promptId` | 543 |
| `message.content[].id` | 538 |
| `message.content[].name` | 538 |
| `message.content[].input` | 538 |
| `message.content[].caller` | 538 |
| `message.content[].caller.type` | 538 |
| `message.content[].tool_use_id` | 537 |
| `message.content[].content` | 537 |
| `toolUseResult` | 537 |
| `sourceToolAssistantUUID` | 537 |
| `slug` | 502 |
| `payload.summary` | 490 |
| `payload.summary[]` | 485 |
| `payload.encrypted_content` | 485 |
| `message.usage.server_tool_use` | 433 |
| `message.usage.server_tool_use.web_search_requests` | 433 |
| `message.usage.server_tool_use.web_fetch_requests` | 433 |
| `message.usage.service_tier` | 433 |
| `message.usage.inference_geo` | 433 |
| `message.usage.iterations` | 433 |
| `message.usage.iterations[]` | 433 |
| `message.usage.iterations[].input_tokens` | 433 |
| `message.usage.iterations[].output_tokens` | 433 |
| `message.usage.iterations[].cache_read_input_tokens` | 433 |
| `message.usage.iterations[].cache_creation_input_tokens` | 433 |
| `message.usage.iterations[].cache_creation` | 433 |
| `message.usage.iterations[].type` | 433 |
| `message.usage.speed` | 433 |
| `message.stop_reason` | 433 |
| `message.stop_details` | 433 |
| `message.content[].input.description` | 405 |
| `message.content[].input.command` | 393 |
| `message.content[].is_error` | 392 |
| `payload.phase` | 390 |
| `toolUseResult.stdout` | 370 |
| `toolUseResult.stderr` | 370 |
| `toolUseResult.interrupted` | 370 |
| `toolUseResult.isImage` | 370 |
| `toolUseResult.noOutputExpected` | 370 |
| `payload.content[].type` | 211 |
| `payload.content[].text` | 211 |
| `payload.role` | 208 |
| `payload.content[]` | 208 |
| `payload.message` | 200 |
| `payload.memory_citation` | 195 |
| `message.content[].thinking` | 189 |
| `message.content[].signature` | 189 |
| `attachment.content[].id` | 184 |
| `attachment.content[].subject` | 184 |
| `attachment.content[].description` | 184 |
| `attachment.content[].status` | 184 |
| `attachment.content[].blocks` | 184 |
| `attachment.content[].blocks[]` | 184 |
| `attachment.content[].blockedBy` | 184 |
| `attachment.content[].blockedBy[]` | 184 |
| `toolUseResult.structuredPatch[].oldStart` | 155 |
| `toolUseResult.structuredPatch[].oldLines` | 155 |
| `toolUseResult.structuredPatch[].newStart` | 155 |
| `toolUseResult.structuredPatch[].newLines` | 155 |
| `toolUseResult.structuredPatch[].lines` | 155 |
| `toolUseResult.structuredPatch[].lines[]` | 155 |
| `message.content[].input.timeout` | 135 |
| `aiTitle` | 98 |
| `lastPrompt` | 96 |
| `leafUuid` | 96 |
| `attachment` | 88 |
| `attachment.type` | 88 |
| `attachment.content[].activeForm` | 84 |
| `message.content[].input.file_path` | 77 |
| `attachment.content` | 70 |
| `toolUseResult.filePath` | 66 |
| `toolUseResult.structuredPatch` | 66 |
| `toolUseResult.structuredPatch[]` | 66 |
| `toolUseResult.originalFile` | 66 |
| `toolUseResult.userModified` | 66 |
| `message.content[].text` | 65 |
| `attachment.content[]` | 52 |
| `attachment.itemCount` | 52 |
| `toolUseResult.type` | 50 |
| `toolUseResult.task` | 41 |
| `message.content[].input.content` | 39 |
| `toolUseResult.content` | 39 |
| `operation` | 38 |
| `payload.status` | 36 |
| `payload.input` | 36 |
| `message.content[].input.task_id` | 33 |
| `message.content[].input.block` | 30 |
| `toolUseResult.retrieval_status` | 30 |
| `toolUseResult.task.task_id` | 30 |
| `toolUseResult.task.task_type` | 30 |
| `toolUseResult.task.status` | 30 |
| `toolUseResult.task.description` | 30 |
| `toolUseResult.task.output` | 30 |
| `toolUseResult.task.exitCode` | 30 |
| `message.content[].input.replace_all` | 27 |
| `message.content[].input.old_string` | 27 |
| `message.content[].input.new_string` | 27 |
| `toolUseResult.oldString` | 27 |
| `toolUseResult.newString` | 27 |

## 关键字段短样本

| 字段路径 | 样本值 |
| --- | --- |
| `type` | `queue-operation`<br>`user`<br>`attachment`<br>`ai-title`<br>`assistant`<br>`last-prompt`<br>`system`<br>`session_meta`<br>`event_msg`<br>`response_item`<br>`turn_context` |
| `sessionId` | `c2e3ca59-fad5-4773-be58-e3733035fc44`<br>`c3536732-94ff-4262-aac9-c83834f2e581`<br>`c1728e8f-4edd-49b5-bf9c-61ea0a9fb248` |
| `message.role` | `user`<br>`assistant` |
| `cwd` | `/workspace` |
| `attachment.type` | `skill_listing`<br>`task_reminder`<br>`queued_command`<br>`edited_text_file`<br>`file`<br>`date_change` |
| `message.type` | `message` |
| `message.model` | `claude-opus-4-7` |
| `message.content[].type` | `thinking`<br>`tool_use`<br>`tool_result`<br>`text` |
| `message.content[].name` | `Bash`<br>`Read`<br>`TaskCreate`<br>`TaskUpdate`<br>`Write`<br>`TaskOutput`<br>`TaskStop`<br>`Edit`<br>`TaskList`<br>`ScheduleWakeup` |
| `message.content[].caller.type` | `direct` |
| `message.content[].tool_use_id` | `toolu_01PY9JdNVGHy7qamSD3hanna`<br>`toolu_01JqoiRxrYVTXS5mFVf5RgdD`<br>`toolu_01VCFgpDgYLCMHWTKWxGSQjq`<br>`toolu_01EZh3dLcpJjXTRXen7ovbQ4`<br>`toolu_01UEAXXMhKqjrbfMt2md6XS9`<br>`toolu_012WUK2Vpr6XJ4SAs3RGS9CU`<br>`toolu_015K14YXaqCngpeUB8zGNfu4`<br>`toolu_01NywRwrTbAknYr9q64FMBTT`<br>`toolu_016dSMenBpCJLmpsy7w5yTvK`<br>`toolu_01C2S9X9FKd6RAXhL7BezUmm`<br>`toolu_01RXoq9ZNsJmVLg1Sm4DJQoA`<br>`toolu_01DfuXqcCTnRwTcn917YbKoA` |
| `message.content[].is_error` | `false`<br>`true` |
| `toolUseResult.type` | `text`<br>`create`<br>`update` |
| `message.usage.iterations[].type` | `message` |
| `message.content[].input.status` | `in_progress`<br>`completed` |
| `attachment.content[].status` | `in_progress`<br>`pending`<br>`completed` |
| `toolUseResult.task.status` | `running`<br>`completed` |
| `toolUseResult.task.exitCode` | `null`<br>`0` |
| `subtype` | `compact_boundary` |
| `compactMetadata.durationMs` | `61050`<br>`68945`<br>`71575` |
| `attachment.content.type` | `text` |
| `toolUseResult.tasks[].status` | `completed`<br>`in_progress` |
| `payload.cwd` | `/workspace` |
| `payload.type` | `task_started`<br>`message`<br>`user_message`<br>`token_count`<br>`agent_message`<br>`function_call`<br>`function_call_output`<br>`reasoning`<br>`custom_tool_call`<br>`custom_tool_call_output`<br>`task_complete` |
| `payload.role` | `developer`<br>`user`<br>`assistant` |
| `payload.content[].type` | `input_text`<br>`output_text` |
| `payload.sandbox_policy.type` | `danger-full-access` |
| `payload.model` | `gpt-5.4` |
| `payload.collaboration_mode.settings.model` | `gpt-5.4` |
| `payload.name` | `exec_command`<br>`write_stdin`<br>`apply_patch` |
| `payload.status` | `completed` |
| `payload.duration_ms` | `1099365`<br>`2949166`<br>`1711771`<br>`7330240` |

## 按 Agent 分组

### claude-code

样本文件数：3；有效记录数：1658；非法行数：0

类型字段：

| 字段路径=值 | 次数 |
| --- | --- |
| `message.type=message` | 792 |
| `type=assistant` | 792 |
| `type=user` | 543 |
| `message.content[].type=tool_use` | 538 |
| `message.content[].caller.type=direct` | 538 |
| `message.content[].type=tool_result` | 537 |
| `message.usage.iterations[].type=message` | 433 |
| `message.content[].type=thinking` | 189 |
| `type=ai-title` | 98 |
| `type=last-prompt` | 96 |
| `type=attachment` | 88 |
| `message.content[].type=text` | 65 |
| `attachment.type=task_reminder` | 52 |
| `type=queue-operation` | 38 |
| `toolUseResult.type=create` | 20 |
| `toolUseResult.type=update` | 19 |
| `attachment.type=queued_command` | 16 |
| `attachment.type=file` | 15 |
| `attachment.content.type=text` | 15 |
| `toolUseResult.type=text` | 11 |
| `attachment.type=skill_listing` | 3 |
| `type=system` | 3 |
| `subtype=compact_boundary` | 3 |
| `attachment.type=edited_text_file` | 1 |
| `attachment.type=date_change` | 1 |

工具名称：

| 名称 | 次数 |
| --- | --- |
| `Bash` | 393 |
| `Write` | 39 |
| `TaskOutput` | 30 |
| `Edit` | 27 |
| `TaskUpdate` | 22 |
| `Read` | 11 |
| `TaskCreate` | 11 |
| `TaskStop` | 3 |
| `TaskList` | 1 |
| `ScheduleWakeup` | 1 |

主要字段路径：

| 字段路径 | 出现次数 |
| --- | --- |
| `type` | 1658 |
| `sessionId` | 1658 |
| `timestamp` | 1464 |
| `parentUuid` | 1426 |
| `isSidechain` | 1426 |
| `uuid` | 1426 |
| `userType` | 1426 |
| `entrypoint` | 1426 |
| `cwd` | 1426 |
| `version` | 1426 |
| `gitBranch` | 1426 |
| `message` | 1335 |
| `message.role` | 1335 |
| `message.content` | 1335 |
| `message.content[]` | 1329 |
| `message.content[].type` | 1329 |
| `message.id` | 792 |
| `message.type` | 792 |
| `message.model` | 792 |
| `message.usage` | 792 |
| `message.usage.input_tokens` | 792 |
| `message.usage.cache_creation_input_tokens` | 792 |
| `message.usage.cache_read_input_tokens` | 792 |
| `message.usage.output_tokens` | 792 |
| `message.usage.cache_creation` | 792 |
| `message.usage.cache_creation.ephemeral_5m_input_tokens` | 792 |
| `message.usage.cache_creation.ephemeral_1h_input_tokens` | 792 |
| `promptId` | 543 |
| `message.content[].id` | 538 |
| `message.content[].name` | 538 |
| `message.content[].input` | 538 |
| `message.content[].caller` | 538 |
| `message.content[].caller.type` | 538 |
| `message.content[].tool_use_id` | 537 |
| `message.content[].content` | 537 |
| `toolUseResult` | 537 |
| `sourceToolAssistantUUID` | 537 |
| `slug` | 502 |
| `message.usage.server_tool_use` | 433 |
| `message.usage.server_tool_use.web_search_requests` | 433 |
| `message.usage.server_tool_use.web_fetch_requests` | 433 |
| `message.usage.service_tier` | 433 |
| `message.usage.inference_geo` | 433 |
| `message.usage.iterations` | 433 |
| `message.usage.iterations[]` | 433 |
| `message.usage.iterations[].input_tokens` | 433 |
| `message.usage.iterations[].output_tokens` | 433 |
| `message.usage.iterations[].cache_read_input_tokens` | 433 |
| `message.usage.iterations[].cache_creation_input_tokens` | 433 |
| `message.usage.iterations[].cache_creation` | 433 |
| `message.usage.iterations[].type` | 433 |
| `message.usage.speed` | 433 |
| `message.stop_reason` | 433 |
| `message.stop_details` | 433 |
| `message.content[].input.description` | 405 |
| `message.content[].input.command` | 393 |
| `message.content[].is_error` | 392 |
| `toolUseResult.stdout` | 370 |
| `toolUseResult.stderr` | 370 |
| `toolUseResult.interrupted` | 370 |
| `toolUseResult.isImage` | 370 |
| `toolUseResult.noOutputExpected` | 370 |
| `message.content[].thinking` | 189 |
| `message.content[].signature` | 189 |
| `attachment.content[].id` | 184 |
| `attachment.content[].subject` | 184 |
| `attachment.content[].description` | 184 |
| `attachment.content[].status` | 184 |
| `attachment.content[].blocks` | 184 |
| `attachment.content[].blocks[]` | 184 |
| `attachment.content[].blockedBy` | 184 |
| `attachment.content[].blockedBy[]` | 184 |
| `toolUseResult.structuredPatch[].oldStart` | 155 |
| `toolUseResult.structuredPatch[].oldLines` | 155 |
| `toolUseResult.structuredPatch[].newStart` | 155 |
| `toolUseResult.structuredPatch[].newLines` | 155 |
| `toolUseResult.structuredPatch[].lines` | 155 |
| `toolUseResult.structuredPatch[].lines[]` | 155 |
| `message.content[].input.timeout` | 135 |
| `aiTitle` | 98 |
| `lastPrompt` | 96 |
| `leafUuid` | 96 |
| `attachment` | 88 |
| `attachment.type` | 88 |
| `attachment.content[].activeForm` | 84 |
| `message.content[].input.file_path` | 77 |
| `attachment.content` | 70 |
| `toolUseResult.filePath` | 66 |
| `toolUseResult.structuredPatch` | 66 |
| `toolUseResult.structuredPatch[]` | 66 |
| `toolUseResult.originalFile` | 66 |
| `toolUseResult.userModified` | 66 |
| `message.content[].text` | 65 |
| `attachment.content[]` | 52 |
| `attachment.itemCount` | 52 |
| `toolUseResult.type` | 50 |
| `toolUseResult.task` | 41 |
| `message.content[].input.content` | 39 |
| `toolUseResult.content` | 39 |
| `operation` | 38 |

### codex

样本文件数：3；有效记录数：3220；非法行数：0

类型字段：

| 字段路径=值 | 次数 |
| --- | --- |
| `type=response_item` | 2266 |
| `type=event_msg` | 946 |
| `payload.type=function_call` | 751 |
| `payload.type=function_call_output` | 750 |
| `payload.type=token_count` | 737 |
| `payload.type=reasoning` | 485 |
| `payload.type=message` | 208 |
| `payload.type=agent_message` | 195 |
| `payload.content[].type=output_text` | 195 |
| `payload.type=custom_tool_call` | 36 |
| `payload.type=custom_tool_call_output` | 36 |
| `payload.content[].type=input_text` | 16 |
| `payload.type=task_started` | 5 |
| `type=turn_context` | 5 |
| `payload.sandbox_policy.type=danger-full-access` | 5 |
| `payload.type=user_message` | 5 |
| `payload.type=task_complete` | 4 |
| `type=session_meta` | 3 |

工具名称：

| 名称 | 次数 |
| --- | --- |
| `write_stdin` | 536 |
| `exec_command` | 215 |
| `apply_patch` | 36 |

主要字段路径：

| 字段路径 | 出现次数 |
| --- | --- |
| `timestamp` | 3220 |
| `type` | 3220 |
| `payload` | 3220 |
| `payload.type` | 3212 |
| `payload.call_id` | 1573 |
| `payload.name` | 787 |
| `payload.output` | 786 |
| `payload.arguments` | 751 |
| `payload.info` | 737 |
| `payload.rate_limits` | 737 |
| `payload.rate_limits.limit_id` | 737 |
| `payload.rate_limits.limit_name` | 737 |
| `payload.rate_limits.primary` | 737 |
| `payload.rate_limits.primary.used_percent` | 737 |
| `payload.rate_limits.primary.window_minutes` | 737 |
| `payload.rate_limits.primary.resets_at` | 737 |
| `payload.rate_limits.secondary` | 737 |
| `payload.rate_limits.secondary.used_percent` | 737 |
| `payload.rate_limits.secondary.window_minutes` | 737 |
| `payload.rate_limits.secondary.resets_at` | 737 |
| `payload.rate_limits.credits` | 737 |
| `payload.rate_limits.plan_type` | 737 |
| `payload.info.total_token_usage` | 734 |
| `payload.info.total_token_usage.input_tokens` | 734 |
| `payload.info.total_token_usage.cached_input_tokens` | 734 |
| `payload.info.total_token_usage.output_tokens` | 734 |
| `payload.info.total_token_usage.reasoning_output_tokens` | 734 |
| `payload.info.total_token_usage.total_tokens` | 734 |
| `payload.info.last_token_usage` | 734 |
| `payload.info.last_token_usage.input_tokens` | 734 |
| `payload.info.last_token_usage.cached_input_tokens` | 734 |
| `payload.info.last_token_usage.output_tokens` | 734 |
| `payload.info.last_token_usage.reasoning_output_tokens` | 734 |
| `payload.info.last_token_usage.total_tokens` | 734 |
| `payload.info.model_context_window` | 734 |
| `payload.content` | 693 |
| `payload.summary` | 490 |
| `payload.summary[]` | 485 |
| `payload.encrypted_content` | 485 |
| `payload.phase` | 390 |
| `payload.content[].type` | 211 |
| `payload.content[].text` | 211 |
| `payload.role` | 208 |
| `payload.content[]` | 208 |
| `payload.message` | 200 |
| `payload.memory_citation` | 195 |
| `payload.status` | 36 |
| `payload.input` | 36 |
| `payload.turn_id` | 14 |
| `payload.cwd` | 8 |
| `payload.started_at` | 5 |
| `payload.model_context_window` | 5 |
| `payload.collaboration_mode_kind` | 5 |
| `payload.current_date` | 5 |
| `payload.timezone` | 5 |
| `payload.approval_policy` | 5 |
| `payload.sandbox_policy` | 5 |
| `payload.sandbox_policy.type` | 5 |
| `payload.model` | 5 |
| `payload.personality` | 5 |
| `payload.collaboration_mode` | 5 |
| `payload.collaboration_mode.mode` | 5 |
| `payload.collaboration_mode.settings` | 5 |
| `payload.collaboration_mode.settings.model` | 5 |
| `payload.collaboration_mode.settings.reasoning_effort` | 5 |
| `payload.collaboration_mode.settings.developer_instructions` | 5 |
| `payload.realtime_active` | 5 |
| `payload.truncation_policy` | 5 |
| `payload.truncation_policy.mode` | 5 |
| `payload.truncation_policy.limit` | 5 |
| `payload.images` | 5 |
| `payload.images[]` | 5 |
| `payload.local_images` | 5 |
| `payload.local_images[]` | 5 |
| `payload.text_elements` | 5 |
| `payload.text_elements[]` | 5 |
| `payload.last_agent_message` | 4 |
| `payload.completed_at` | 4 |
| `payload.duration_ms` | 4 |
| `payload.id` | 3 |
| `payload.timestamp` | 3 |
| `payload.originator` | 3 |
| `payload.cli_version` | 3 |
| `payload.source` | 3 |
| `payload.model_provider` | 3 |
| `payload.base_instructions` | 3 |
| `payload.base_instructions.text` | 3 |

## 下一步解释

- 类型统计用于确定 Parser 的输入分支，不直接等同于统一 Event 类型。
- 工具调用与工具结果是否能配对，需要结合各家的标识字段继续检查。
- 字段是否能进入 Schema v1，还要区分 direct（原始提供）、derived（Adapter 推导）和 unavailable（无法可靠获得）。
