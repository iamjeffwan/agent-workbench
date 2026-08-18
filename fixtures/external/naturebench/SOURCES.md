# Phase A 外部真实会话样本

## 来源

- 数据集：FrontisAI/NatureBench-traces
- 地址：https://huggingface.co/datasets/FrontisAI/NatureBench-traces
- 用途：Phase A 的原始日志格式盘点与 Adapter 早期回归样本
- 下载日期：2026-08-17
- 说明：样本来自公开研究数据集，保留其原始会话文件和任务结果元数据；不把它们当作本项目最终的同任务验收样本。

## 当前选择

### Codex

- 配置目录：`codex__gpt-5.4`
- 样本数：3
- 任务标识：`s41467-025-63412-3`、`s41551-024-01257-9`、`s41592-024-02191-z`
- 原始文件：各样本目录下的 `transcript.jsonl`
- 元数据：各样本目录下的 `result.json`

### Claude Code

- 配置目录：`claude-code__opus-4.7`
- 样本数：3
- 任务标识：`s41467-025-63412-3`、`s41551-024-01257-9`、`s41592-024-02191-z`
- 原始文件：各样本目录下的 `transcript.jsonl`
- 元数据：各样本目录下的 `result.json`

## 使用约定

1. `transcript.jsonl`（逐行会话日志）保持原样，不在原文件上做脱敏或重排。
2. `result.json`（任务结果元数据）只用于补充任务、模型和运行信息，不作为原始会话解析的替代品。
3. 后续 Adapter 测试应引用这些文件的 SHA-256（文件内容指纹），避免样本被静默替换。
4. 公开样本可能仍包含路径、代码、命令输出或其他敏感内容；在提交版本库前必须重新检查。
