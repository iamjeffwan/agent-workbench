# Agent Workbench desktop topology

## Reference

- Visual language: HTTP Toolkit desktop application screenshots supplied by the user.
- Live-site verification: https://httptoolkit.com/ at 1440 × 900.
- Reference tokens observed from the live site: white `#ffffff` canvas, graphite `#16181e` text, red-orange `#f65430` → `#d93815` primary gradient, `DM Sans` body typography, 12px control radii, cool-grey panel surfaces.

## Desktop structure

1. **Utility rail** — fixed 76px left rail containing product mark, section navigation, and settings.
2. **Activity explorer** — flexible master pane with project controls, filter bar, column header and grouped execution rows.
3. **Inspector** — 420px detail pane with a summary card, structured fields, raw JSON and empty state.
4. **Status strip** — compact bottom strip inside the activity pane showing project readiness, source totals and visible row count.

The page is a fixed-height application shell. Each primary pane owns its own vertical scrolling. Selection is click-driven; search is input-driven; source chips act as quick filters. The utility rail and table header remain visible.

## Project-specific mapping

- HTTP request rows become agent and program execution steps.
- Method/status/source/host/path columns become source/status/kind/name/duration.
- Request/response inspector becomes execution summary + structured metadata + raw payload.
- Intercept/modify/send navigation becomes activity/project/files/settings navigation, with only the activity section active in this version.
- The design stays desktop-first. Below 1060px the inspector narrows; below 920px the rail labels collapse while all core controls remain available.
