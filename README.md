# Particle Ecosystem Simulator

Browser-based, WebGPU-powered particle simulation. Thousands of particles emit,
sense, hunt, split, and evolve in a continuous property-space ecosystem driven
entirely by each particle's fixed-length genome. No hard-coded types, no rule editor —
the genome is the only knob.

See `VISION.md` for the full product vision and `AGENTS.md` for the operational
manual that governs work in this repo.

## Stack

- **Engine + UI**: Svelte 5 + TypeScript + Tailwind CSS + Vite.
- **Compute / render**: WebGPU (compute pipelines for the simulation, render
  pipelines for the canvas).
- **Tests**: Vitest (logic) + a WebGPU smoke harness for headless builds.

## Commands

```bash
npm install          # install dependencies
npm run dev          # local dev server with HMR
npm run build        # production build
npm run preview      # preview the production build
npm run test         # run Vitest test suite
npm run lint         # ESLint over the source tree
npm run typecheck    # tsc --noEmit against the project
npm run format       # Prettier format the source tree
npm run export:html  # bundle the world into a single offline .html file
```

## Repository map

- `VISION.md` — the product vision (read-only, user-owned).
- `AGENTS.md` — the operating manual for the agent.
- `STATE_OF_PLAY.md` — dated log of product observations.
- `INBOX.md` / `BLOCKED.md` — cross-cutting communication channels.
- `specs/` — module- and feature-level specifications.
- `src/` — engine + UI source.
- `tests/` — Vitest specs and fixtures.
- `tools/` — build, export, and verification scripts.
