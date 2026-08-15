# Output contract

Return only Markdown. Do not wrap the whole document in a code fence.

Use these sections exactly once and in this order:

1. `# <task title>`
2. `## Task scope`
3. `## Process overview`
4. `## Execution metrics`
5. `## Behavior timeline`
6. `## Code and artifact changes`
7. `## Validation and outcomes`
8. `## Exceptions and evidence gaps`

## Timeline evidence notes

Do not print session file names, source line numbers, or an `Evidence` label. Put the faithful evidence excerpt directly below the corresponding numbered Behavior timeline entry as a blockquote:

```markdown
> `<faithful excerpt from the captured event>`
```

Use one or more evidence notes when an entry depends on multiple events. Keep excerpts short enough to read, but preserve commands, tool names, explicit statuses, errors, short relevant code snippets, and other details needed to support the statement. Use only content present in the supplied evidence. Never invent an excerpt. Source locations remain internal traceability metadata and must not appear in the document.

## Completeness and length

- Draft an internal outline containing all required sections before writing the document.
- Use at most 12 numbered Behavior timeline entries. Group adjacent low-level events into factual phases instead of narrating every read, search, or tool transport event separately.
- Preserve failures, contradictions, code changes, and validation outcomes even when other events must be summarized.
- Finish all required sections. Brevity is preferred to an incomplete document.

## Content requirements

- State the selected conversation and turn identifiers in Task scope.
- Keep Process overview short and factual.
- Present the supplied per-turn metrics in a table. Label total tokens as input plus output. Treat cached input as part of input and reasoning output as part of output. Show unavailable values as `—`.
- Use chronological numbered entries in Behavior timeline. Convert timestamps to the supplied presentation timezone, label the timezone, and put supporting evidence notes directly below each entry.
- Separate a tool call from its result. Pair them by call identifier when available.
- When an entry describes inspection, name the inspected file when available but do not imply it was modified.
- When a test command and its result are both captured, include the command before the result.
- For patches that include full file content, show the file path and change type instead of reproducing that content. Short directly relevant source excerpts may still be shown.
- Report changes only when patch, write, edit, or explicit result evidence supports them.
- Report tests and other validation only when calls or results support them.
- Put failures, aborted work, missing results, uncertain attribution, and capture gaps in Exceptions and evidence gaps.
- Write `No supporting evidence was captured.` when a required section has no evidence.

## Prohibited content

- No quality score, critique, root-cause analysis, optimization advice, or recommended next steps.
- No claims based on general software knowledge instead of the supplied evidence.
- No hidden chain-of-thought reconstruction. Include only reasoning summaries present in evidence.
- No omission of contradictory results or recorded failures.
