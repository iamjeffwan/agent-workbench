---
license: cc-by-4.0
pretty_name: NatureBench-traces
tags:
  - agent
  - coding-agent
  - llm-agent
  - agent-trajectories
  - agent-traces
configs:
  - config_name: index
    data_files: metadata/index.parquet
---

# NatureBench-traces

NatureBench-traces contains the full solving process 
of coding agents on the **90 tasks** of **NatureBench**.

- The task packages themselves (task brief, data, evaluator, SOTA
  scores) live in the sibling repository `FrontisAI/NatureBench`.
- This repository releases only the **process traces**: the complete conversation
  history of an agent reading the task, exploring the data, writing and debugging
  code, and submitting for scoring, together with the per-attempt score records, the
  post-hoc validity verdict, and run-level metadata.
- It does **not** include the agent's workspace snapshot (`workspace/`, i.e. the code
  and result files).

Coverage is **12 harness+model configurations × 90 tasks**. Because the evaluation
pipeline was updated during the evaluation period, the output files and fields of
some earlier runs differ in **completeness**, and a few cases are missing trace files
for storage reasons. Every trace is listed in the **index table** (browse it in the
Dataset Viewer, where you can **filter** by model, task, or compute tier); boolean
columns there flag each trace's file completeness.

| Harness | Model |
|---------|-------|
| Claude Code | Opus 4.6 / Opus 4.7 / kimi-k2.6 / MiniMax-M2.7 / MiniMax-M3 / DeepSeek-V4-Pro / glm-5.1 / glm-5.2 / Qwen 3.7 Max |
| Codex | GPT-5.4 / GPT-5.5 |
| Gemini CLI | gemini-3.5-flash |

---

## 1. Directory layout

```
NatureBench-traces/
├── README.md
├── trajectories/
│   └── <harness>__<model>/            # e.g. claude-code__opus-4.7
│       └── <case_id>/                 # paper DOI, e.g. s41467-025-63412-3 (maps one-to-one to `tasks/<case_id>/` in `FrontisAI/NatureBench`)
│           ├── transcript.jsonl       # conversation history (Claude Code / Codex; Gemini: transcript.json)
│           ├── submissions.jsonl      # per-attempt score records
│           ├── judge_verdict.json     # historical legacy validity verdict
│           ├── judge_verdict_v2.json  # current GPT-5.5 validity verdict
│           └── result.json            # run-level metadata
└── metadata/
    └── index.parquet                  # index table
```

---

## 2. Trace file

Each `<case_id>/` directory contains up to the five files below. **Not every directory
is complete**: cases from earlier evaluation pipeline versions that did not enable
full-record saving may lack `submissions.jsonl`, `judge_verdict.json`, or other
sidecars. Cases where the agent produced no scored submission also lack `submissions.jsonl` (and therefore `judge_verdict.json`, `judge_verdict_v2.json`). Missing files are flagged in the index table.

### 2.1 `transcript.jsonl` — conversation history

Records the complete multi-turn conversation of the solving run. The three harnesses
use **different record schemas**, and we **preserve each native format**.

> Note on the file carrier: Claude Code / Codex use `transcript.jsonl`, while Gemini use `transcript.json`.

Two points about the transcript:

- **Resume.** The evaluation uses checkpoint-resume to handle long tasks and
  interruptions: it continues **within the same session** via
  the harness's resume capability, and the new turns are **appended** to the same
  session. A single transcript for a resumed case is therefore the **complete history
  across multiple runs**; each run is recorded in `resume_history` in `result.json`.
- **Two record structures.** Newer versions use the harness's **native session
  format**; some earlier, non-resumed cases use an **exported stream-json format**.
  Both fully cover the conversation and differ only in field packaging.

### 2.2 `submissions.jsonl` — per-attempt scores

One submission record per line, with fields:

- `type`: submission result type (e.g. `success`)
- `attempt`: submission index (multiple submissions are allowed during a run; the
  system tracks the best automatically)
- `timestamp`: Unix timestamp
- `raw_scores`: raw metrics grouped by dataset instance, of the form
  `{"<instance>": {"<metric>": <value>, ...}}`
- `per_instance_improvement` / `aggregate_improvement`: per-instance / aggregate
  primary-metric improvement relative to the paper's SOTA

> Note: earlier-version `submissions.jsonl` has **no `type` field** and does not record
> failed submissions; the other fields are the same.

### 2.3 `judge_verdict.json` and `judge_verdict_v2.json` — validity verdicts

`judge_verdict.json` preserves the historical legacy sonnet 4.6 judgment as audit evidence.
`judge_verdict_v2.json` is the current post-hoc GPT-5.5 judgment. Both files
use the same three-field schema: `is_valid`, `reason`, and `model`.

The index column `has_judge` refers specifically to `judge_verdict_v2.json`.

### 2.4 `result.json` — run metadata

Fields: `task_name`, `agent`, `model`, `mode` (=`base`), `status`, `duration`,
`returncode`, `session_id`, `resume_history` (per run segment: `run_idx`,
`is_resume_run`, `status`, `duration`, `started_at`).

> Note: 
> 1. earlier versions did not support resume mode and contain no `session_id` or
> `resume_history`.
> 2. `duration` records orchestration-level elapsed time rather than agent solving
> time alone. It may include container preparation, GPU waiting, agent execution, and
> evaluation calls; for resumed cases, it is cumulative across `resume_history`
> segments.

### 2.5 `metadata/index.parquet` — model-case index

The index contains all **1,080 model-case identities**. 

Key score and validity columns have the following meanings:

- **`best_aggregate_improvement`** is the highest raw aggregate improvement achieved
  across all recorded submissions in the selected run, before applying the post-hoc
  validity judgment.
- **`effective_improvement`** is the aggregate improvement retained after applying the
  current validity judgment.
- **`judge_valid`** records the current V2 validity value. True no-score rows do not 
  receive a validity judgment and therefore use null.

---

## 3. Sanitization

**Sensitive-information cleaning.** The transcripts were sanitized before release. All
changes are **pure string replacement** — no conversation records are removed and no
record order is changed — so trace integrity and internal consistency are preserved:

- **Host paths** → rewritten to placeholder paths starting with `/host`. These are
  runtime file locations only, unrelated to the task solution.
- **Internal identifiers** (evaluation version numbers, batch/group labels, …) →
  removed or neutralized.
- **Keys / tokens** → removed (replaced with `[REDACTED]`).

**API errors.** Transient **API error records** that occurred during a run are
**kept** as part of the real run trace; only for those carrying **account-billing
information** is the inner `message` removed (replaced with `[REDACTED]`), while the
others are retained.

**Corrupt lines.** A few malformed lines caused by log write glitches are kept **as
is**.

---

## 4. License and provenance

This dataset is released under **CC-BY-4.0** (see the top-level [`LICENSE`](LICENSE)),
for **research and evaluation purposes**:

- **NatureBench Authors' contributions** (`submissions.jsonl` / `judge_verdict.json` /
  `judge_verdict_v2.json` / `result.json` / the index — our own outputs)
  → **CC-BY-4.0**.
- **Model-generated trajectory content** (the transcripts) → content generated by the
  respective harness / model providers, recorded and redistributed here for research
  and evaluation, and **remaining subject to each provider's terms**.
- **Tasks and third-party data** → governed by the sibling dataset
  `FrontisAI/NatureBench` and its per-task `licenses/`.
