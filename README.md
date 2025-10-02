# Vue Pact — SFC Contract Auditor & Docs Generator

Vue Pact is an opinionated, zero‑dependency tool that scans your Vue Single‑File Components (.vue) to extract a component interface contract (props, emits, slots), flags common accessibility antipatterns, computes simple cohesion/complexity metrics, and generates:

1. a machine‑readable manifest JSON for CI/tooling
2. a drop‑in, Vue‑only viewer you can host on **exogenist.tech** to browse contracts as living docs

> No external libraries beyond Vue itself. The CLI uses only Node’s core modules.

## Why this exists

Frontend teams rarely have a single source of truth for a component’s public surface. Type definitions drift, emits aren’t documented, and slots are tribal knowledge. Linting helps, Storybook helps—but they’re heavy. **Vue Pact** is a lightweight auditor: it reads your SFCs, builds an **Interface Contract** per component, generates actionable warnings, and outputs clean artifacts you can commit.

### Key opinions

- **Contracts over stories.** If the interface is crisp, stories follow.
- **Zero‑dependency over mega‑tool.** You should be able to run this on any repo in seconds.
- **Heuristics now, AST later.** Regex + disciplined patterns get you 80% with 0 deps.

## Features

- **Props extraction** from `<script setup>` (`defineProps` typed or object) and Options API (`props:`).
- **Emits extraction** from `defineEmits([...])` and `$emit('event')` usage.
- **Slots discovery** from `<slot name="...">`, `v-slot:` and `#name` syntax in templates.
- **A11y checks** (heuristic):
  - `<img>` without `alt`.
  - `<button>` without explicit `type`.
  - Links with `href="#"` without role override.
  - Inputs without associated `<label for>` or `aria-label`.
- **Cohesion & size metrics**:
  - Lines of template/script.
  - Prop usage ratio (declared vs. referenced in template).
  - Rough branching count in template (`v-if`, `v-else-if`, `v-for`).
- **Artifacts**:
  - `vuepact.manifest.json` (contracts & warnings)
  - Optional `vuepact.report.md` (pretty summary)
  - A static **Viewer** (Vue 3 via CDN) that reads the manifest and renders browsable docs.

Deliberate constraint: no AST/TypeScript parser. If you later want 100% accuracy, you can bolt on a parser behind a flag without breaking the zero‑dep base.

## Quick start

```bash
# 1) Put these files in a tools/vue-pact/ folder
# 2) Run the CLI against your src/ directory
node cli.mjs scan ../path/to/your/src --out ./vuepact.manifest.json --report ./vuepact.report.md

# 3) Open the viewer (serve viewer.html with any static server)
#    Or open directly in the browser (file:// works for most browsers if CORS allows fetch of local file).
```

## Project layout

```
tools/vue-pact/
├─ cli.mjs               # Node CLI — scans .vue files and emits manifest/report
├─ README.md             # (this file)
├─ viewer.html           # Static Vue app to explore the manifest (Vue via CDN)
└─ viewer.js             # Viewer logic (no deps)
```

## Roadmap

- **v0.2**: add `--fix:button-type` (safe auto‑insert `type="button"`); `--fail-on-warn` for CI gating.
- **v0.3**: basic `v-model` contract check (`modelValue`/`update:modelValue` pair); cross‑check declared emits vs `$emit` usage.
- **v0.4**: minimal Vite plugin wrapper that feeds the same analyzer (still zero external deps at core).
- **v0.5**: optional AST mode behind `--ast` flag (add parser only if user opts in).

## License

[MIT](LICENSE) — keep it open so teams can adopt quickly.
