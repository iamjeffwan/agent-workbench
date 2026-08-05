# ActivityTable specification

## Overview

- Target: list rendering in `apps/desktop/renderer/app.js` and activity rules in `styles.css`.
- Interaction model: click selection, input filtering, sticky table header.
- Visual reference: HTTP Toolkit dense traffic rows (left status marker, high-contrast selection).

## Structure and styles

- Toolbar height: 64px; left title, central filter input, right actions.
- Table header height: 36px; white surface with light shadow; 10px labels.
- Columns: 10px marker, 72px source, 64px status, 92px type, minmax name, 70px duration.
- Row minimum height: 34px; marker is a 5px status-colored bar with padding-box border treatment.
- Source uses compact colored text marks, not large pills.
- Row hover: `#f8f9fb`; selected: `#16181e` with white text; selected marker uses accent.
- Success marker: `#279d6b`; running: `#e2a21a`; error: `#d84c4c`; muted: `#c8ced7`.

## Behaviors

- Search matches plain text and `type:` / `source:` prefixes.
- Clicking a row updates the inspector and selection.
- Exploration groups expand inline and indent children by 16px.
- Empty state changes copy based on whether a project has been selected.
