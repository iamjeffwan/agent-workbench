# DetailInspector specification

## Overview

- Target: inspector markup in `index.html`, rendering in `app.js`, styling in `styles.css`.
- Interaction model: selection-driven content with close and collapsible section cards.
- Visual reference: HTTP Toolkit request/response inspector cards and parameter lists.

## Structure and styles

- Width: 420px at the default 1280px application width.
- Header: 58px, white, 1px bottom separator.
- Summary card: white surface, 1px border, 8px radius, 3px red-orange top edge.
- Detail cards: collapsible sections for 关键信息 / 参数 / 输出 / 原始数据, each with a thin accent top edge.
- Metadata labels: 10px uppercase cool grey; values: 12px monospace.
- Object payloads render as key/value rows; non-objects use monospace blocks.
- Raw JSON keeps a copy action on the card header.

## Behaviors

- The content updates immediately on selected-row changes.
- Section headers toggle collapse; collapse state persists while browsing details.
- Copy button writes raw JSON and reports temporary copied state.
- Close button restores the inspector empty state.
- Long values wrap safely; pane scroll is independent from the table.
