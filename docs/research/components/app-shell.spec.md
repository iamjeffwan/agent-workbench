# AppShell specification

## Overview

- Target: `apps/desktop/renderer/index.html` and shell rules in `styles.css`.
- Interaction model: static shell with click-driven navigation affordances.

## Structure and styles

- 76px utility rail, cool white surface, 1px `#d9dde4` separator.
- Brand tile: 44 × 44px, red-orange gradient, 11px radius, white line mark.
- Main workspace: two columns, flexible activity pane and 420px inspector.
- Base font: `DM Sans` where available, then `Segoe UI` and Microsoft YaHei; 13px.
- Page background: `#eef1f5`; panels: `#ffffff`; inset surfaces: `#f6f7f9`.
- Primary accent: gradient `#f65430` to `#d93815`; selection tint `#fff1ed`.
- Desktop breakpoint: inspector 420px at 1280px+, 360px below 1180px, 330px below 1040px.

## Behaviors

- Navigation items show tooltips and pressed styling.
- Project drawer opens from the rail without resizing the activity table.
- Active sections use the reference red left edge and red icon/text.
