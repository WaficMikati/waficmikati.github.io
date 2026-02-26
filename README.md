# Wafic Mikati Website + Mermaid Flowchart Editor

A minimal personal GitHub Pages site with a dedicated, interactive Mermaid flowchart editor.

- Home page: `/`
- Mermaid Editor: `/mermaid/`

[Live Site](https://waficmikati.github.io/) | [Open Editor](https://waficmikati.github.io/mermaid/)

## Highlights

- Visual flowchart building with drag-and-drop nodes.
- Inline node text editing and inline edge label editing.
- Multi-select + group move.
- Connect nodes with directional arrows and editable labels.
- Dynamic flow direction inference from diagram layout.
- Mermaid code panel with apply/cancel/copy workflow.
- EN/ES language toggle (persisted in local storage).
- Scroll-to-zoom, right-click pan, reset zoom, and top-centered recentering.
- Undo/redo history.
- Export diagram as PNG.

## Supported Mermaid Syntax (Current Subset)

This editor supports a practical subset of Mermaid flowchart syntax, including:

- Node declarations:
  - `A[Process]`
  - `B(Start/End)`
  - `C{Decision}`
  - `D((Connector))`
  - `E([Stadium])`
- Edges:
  - `A --> B`
  - `A -->|label| B`
- Flow direction:
  - `flowchart TD`, `LR`, `RL`, `BT`

The parser and generator are designed for round-trip editing with the visual canvas and code panel.

## Tech Stack

- React 19
- Vite 7
- Lucide React icons
- Plain inline styling in `App.jsx`

## Local Development

### 1. Install

```bash
npm install
```

### 2. Run dev server

```bash
npm run dev
```

Default Vite URL:

- `http://localhost:5173/` (home)
- `http://localhost:5173/mermaid/` (editor)

### 3. Production build

```bash
npm run build
```

### 4. Preview production build

```bash
npm run preview
```

## GitHub Pages Deployment

This repo is configured to deploy using GitHub Actions.

Workflow:

- [.github/workflows/pages.yml](./.github/workflows/pages.yml)

Build script used for Pages:

```bash
npm run build:pages
```

This outputs the static site to `site/`, which is uploaded and deployed by the workflow.

Important Pages setting:

- In repository settings, set **Pages Source** to **GitHub Actions** (not branch/Jekyll mode).

## Project Structure

```text
.
|-- index.html                    # Home page
|-- mermaid/index.html            # Mermaid editor entry page
|-- src/
|   |-- App.jsx                   # Main editor implementation
|   `-- main.jsx                  # React bootstrap
|-- .github/workflows/pages.yml   # GitHub Pages deployment workflow
|-- vite.config.js                # Multi-page Vite config (home + /mermaid)
`-- package.json
```

## Scripts

- `npm run dev` - Start local dev server.
- `npm run build` - Build production assets to `dist/`.
- `npm run build:pages` - Build Pages output to `site/` with relative base paths.
- `npm run preview` - Preview production build locally.
- `npm run lint` - Run ESLint.

## Notes

- The editor is implemented as a single React component (`src/App.jsx`) by design, optimized for rapid iteration.
- UI language defaults to English and can be toggled to Spanish in the top toolbar.
