# Vue Pact — SFC Contract Auditor & Docs Generator

Vue Pact is a zero‑dependency tool that scans your Vue Single‑File Components (.vue) and extracts a component interface contract—props, emits, slots. It runs accessibility heuristics (missing alt on images, button type, link href="#" misuse, inputs without labels), computes simple cohesion/size metrics, and outputs a machine‑readable manifest and optional report. You can also serve the included Vue‑only viewer to browse the contracts.

## Features

- **Props extraction** from `<script setup>` via `defineProps` generic or object syntax and from the Options API.
- **Emits discovery** from `defineEmits` arrays and `$emit()` usage.
- **Slots discovery** from `<slot>` declarations and `v‑slot:`/`#` usage.
- **A11y heuristics** for images, buttons, links, and inputs.
- **Metrics** like template/script line counts, branching complexity, prop usage ratio, cohesion.
- **Artifacts**: `vuepact.manifest.json` (JSON manifest) and optionally `vuepact.report.md` (markdown summary). You can host `viewer.html` + `viewer.js` to explore the manifest.

## Quick start

From the `tools/vue‑pact/` directory run:

```bash
node cli.mjs scan <path-to-src> --out <output-manifest> [--report <output-report>]
```

Serve `viewer.html` alongside your manifest to browse it in a browser.

## License

MIT
