<script lang="ts">
  /**
   * App shell — owns the canvas, the Renderer, the headless engine
   * state, the requestAnimationFrame loop, and the HUD wiring.
   */
  import Hud from '$lib/Hud.svelte';
  import {
    DEFAULT_WORLD_CONFIG,
    createSimulationState,
    spawnParticle,
    scatterClusteredFounders,
    stepOnce,
    setWorld,
    Rng,
    captureSnapshot,
    restoreSnapshot,
    snapshotToString,
    snapshotFromString,
    copyOrganism,
    pasteOrganism,
    clipboardToString,
    clipboardFromString,
    createTimeline,
    maybeRecordSnapshot,
    restoreAtTick,
    truncateAfter,
    lastEntry,
    type Timeline
  } from '$engine/core/index.js';
  import type { SimulationState } from '$engine/core/step.js';
  import type { ConfigKey } from '$lib/hud_types.js';
  import { DEFAULT_RENDER_OPTIONS, Renderer, type RenderOptions } from '$lib/Renderer.js';

  let canvas = $state<HTMLCanvasElement | null>(null);
  let fps = $state(0);
  let tick = $state(0);
  let population = $state(0);
  let dustCt = $state(0);
  let paused = $state(false);
  let renderer: Renderer | null = null;
  let sim: SimulationState | null = null;
  let rafHandle = 0;
  let lastFpsSample = 0;
  let framesSinceSample = 0;
  let renderOpts: RenderOptions = $state({ ...DEFAULT_RENDER_OPTIONS });
  // Live UI status string shown under the save/load buttons. Reports
  // the last save/load/copy/paste operation so the user sees feedback.
  let clipboardStatus = $state('clipboard: empty');
  // The file input is rendered by App so HUD stays markup-only. Bind
  // it; clicking the HUD's "load snapshot" triggers `.click()` on it.
  let fileInput = $state<HTMLInputElement | null>(null);
  const ORGANISM_STORAGE_KEY = 'ecosystem.organism.clipboard';
  const SNAPSHOT_STORAGE_KEY = 'ecosystem.snapshot.last';

  // Live-editable HUD-bound config view. The engine owns the canonical
  // copy on `sim.world`; we mirror it here so Svelte's reactive layer can
  // detect edits without subscribing to the simulation state.
  let config = $state({ ...DEFAULT_WORLD_CONFIG });
  // The deterministic timeline snapshot ring (VISION §9). Plain
  // mutable object — Svelte reactivity only needs scrubRange.
  let timeline: Timeline = createTimeline();
  let scrubRange = $state<[number, number]>([0, 0]);
  const initialPopulation = DEFAULT_WORLD_CONFIG.targetPopulation;
  /** Number of founding clusters. ~3% of the population — small enough
   * for visible color separation, large enough that no cluster trivially
   * starves. */
  const initialClusters = Math.max(6, Math.min(20, Math.floor(initialPopulation * 0.03)));

  function refreshScrubRange(): void {
    const last = lastEntry(timeline);
    scrubRange = [0, last?.tick ?? 0];
  }

  function recordNow(force = true): void {
    if (!sim) return;
    maybeRecordSnapshot(sim, sim.world, timeline, force);
    refreshScrubRange();
  }

  function rebuildFromSeed(seed: number): void {
    if (!sim) return;
    sim = createSimulationState(64_000, { ...config }, seed);
    const rng = new Rng(sim.rng.snapshot());
    scatterClusteredFounders(initialPopulation, rng, sim.world, initialClusters).forEach(
      (f) => {
        spawnParticle(sim!, f.x, f.y, f.vx, f.vy, f.energy, false, -1, f.genomeRow);
      }
    );
    tick = 0;
    population = sim.storage.activeCount;
    dustCt = countDust(sim);
    timeline = createTimeline();
    recordNow(true);
  }

  function resetWorld(): void {
    if (!sim) return;
    const seed = sim.rng.snapshot();
    rebuildFromSeed(seed);
  }

  /** Place the live simulation on the snapshot ≤ `targetTick`. Pauses
   * the play loop because forward advancement from a non-current tick
   * belongs to the user's resume decision. */
  function scrubTo(targetTick: number): void {
    if (!sim) return;
    if (lastEntry(timeline) === null) {
      // No snapshots recorded yet (e.g. fresh boot); refresh button
      // surface so the user knows nothing was there.
      return;
    }
    paused = true;
    const restored = restoreAtTick(sim, timeline, targetTick);
    if (restored !== null) {
      tick = sim.tick;
      population = sim.storage.activeCount;
      dustCt = countDust(sim);
      clipboardStatus = `scrubbed to tick ${restored}`;
    }
  }

  /** Editable arithmetic limit for a HUD parameter. */
  function clamp(key: ConfigKey, raw: number): number {
    if (!Number.isFinite(raw)) return config[key];
    const limits: Record<ConfigKey, [number, number]> = {
      latticeResolution: [8, 96],
      signalCutoff: [4, 240],
      predationSpeedThreshold: [0, 8],
      dustAbsorbSpeed: [0, 8],
      contactSeparation: [0.5, 4],
      dustDecayPerSec: [0, 0.5]
    };
    const [lo, hi] = limits[key];
    if (key === 'latticeResolution') return Math.round(Math.max(lo, Math.min(hi, raw)));
    return Math.max(lo, Math.min(hi, raw));
  }

  /** HUD → engine wiring. Edits invalidate the forward part of the
   * timeline per VISION §9 ("Edits invalidate forward state and resume
   * the playback from the new scratch point"). The replaced live sim
   * is rebuilt from the post-edit seed so the change takes visible
   * effect immediately. */
  function changeConfig(key: ConfigKey, value: number): void {
    if (!sim) return;
    const next = { ...config, [key]: clamp(key, value) };
    if (next[key] === config[key]) return; // no-op when clamp rejected it
    config = next;
    setWorld(sim, next);
    // Invalidate forward snapshots beyond the current head.
    const head = sim.tick;
    truncateAfter(timeline, head);
    rebuildFromSeed(sim.rng.snapshot());
  }

  function countDust(s: SimulationState): number {
    let n = 0;
    for (let i = 0; i < s.storage.capacity; i++) {
      if (s.storage.alive[i] === 1 && s.storage.isDust[i] === 1) n++;
    }
    return n;
  }

  function resizeCanvas(): void {
    if (!canvas) return;
    renderer?.resize(canvas.clientWidth, canvas.clientHeight);
  }

  function loop(): void {
    if (!renderer || !sim) return;
    if (!paused) {
      // 2 ticks per frame — keeps things visibly alive without
      // overwhelming the CPU.
      for (let i = 0; i < 2; i++) stepOnce(sim);
      // Record at the snapshotInterval boundary so the timeline stays
      // populated while the engine runs. power-of-two false positive
      // costs nothing past a duplicate-tick overwrite.
      maybeRecordSnapshot(sim, sim.world, timeline);
      refreshScrubRange();
    }
    renderer.render(sim, renderOpts);
    tick = sim.tick;
    population = sim.storage.activeCount;
    dustCt = countDust(sim);
    framesSinceSample++;
    const now = performance.now();
    if (now - lastFpsSample >= 1000) {
      fps = (framesSinceSample * 1000) / (now - lastFpsSample);
      lastFpsSample = now;
      framesSinceSample = 0;
    }
    rafHandle = requestAnimationFrame(loop);
  }

  // ---------- snapshot / clipboard engine paths ----------

  /** Gather the slots of all alive, non-dust particles. This is the
   * MVP selection policy for "copy cluster" — without cluster detection
   * or a click-drag rectangle (post-MVP), the entire surviving
   * population is the unimodal selection. */
  function collectAliveNonDustSlots(s: SimulationState): number[] {
    const out: number[] = [];
    for (let i = 0; i < s.storage.capacity; i++) {
      if (s.storage.alive[i] === 1 && s.storage.isDust[i] === 0) out.push(i);
    }
    return out;
  }

  function saveSnapshot(): void {
    if (!sim) return;
    try {
      const env = captureSnapshot(sim);
      const json = snapshotToString(env);
      // Drop into localStorage so the user can restore across reloads
      // without having opened the file from disk.
      try {
        globalThis.localStorage?.setItem(SNAPSHOT_STORAGE_KEY, json);
      } catch {
        // localStorage may be unavailable (private mode); tolerate.
      }
      // Records the snapshot both as the user's intent and adds an
      // explicit timeline entry beyond the current head.
      recordNow(true);
      clipboardStatus = `snapshot saved: tick ${env.tick}, ${env.activeCount} particles`;
    } catch (e) {
      clipboardStatus = `snapshot save failed: ${(e as Error).message}`;
    }
  }

  function loadSnapshot(): void {
    // Two paths: (1) re-use the last snapshot we put in localStorage;
    // (2) read a file the user picked. HUD "load snapshot" just opens
    // the file picker — we wire the picked-file reader here.
    fileInput?.click();
  }

  async function loadSnapshotFromFile(file: File): Promise<void> {
    try {
      const json = await file.text();
      const env = snapshotFromString(json);
      if (!sim) {
        clipboardStatus = 'snapshot load failed: simulation not ready';
        return;
      }
      // Capacity mismatch? Rebuild a fresh sim with the saved capacity.
      if (env.capacity !== sim.storage.capacity) {
        sim = createSimulationState(env.capacity, { ...config }, env.rngSeed);
        setWorld(sim, env.world);
      } else {
        restoreSnapshot(sim, env);
      }
      // Replace forward state — the loaded snapshot IS the new head.
      timeline = createTimeline();
      recordNow(true);
      tick = sim.tick;
      population = sim.storage.activeCount;
      dustCt = countDust(sim);
      config = { ...config, ...sim.world };
      try {
        globalThis.localStorage?.setItem(SNAPSHOT_STORAGE_KEY, json);
      } catch {
        // tolerated
      }
      clipboardStatus = `snapshot loaded: tick ${env.tick}, ${env.activeCount} particles`;
    } catch (e) {
      clipboardStatus = `snapshot load failed: ${(e as Error).message}`;
    }
  }

  function copyCluster(): void {
    if (!sim) return;
    try {
      const slots = collectAliveNonDustSlots(sim);
      if (slots.length === 0) {
        clipboardStatus = 'clipboard: no organisms to copy';
        return;
      }
      const cb = copyOrganism(sim, slots);
      const json = clipboardToString(cb);
      try {
        globalThis.localStorage?.setItem(ORGANISM_STORAGE_KEY, json);
      } catch {
        // tolerated
      }
      clipboardStatus = `clipboard: ${cb.count} organisms copied`;
    } catch (e) {
      clipboardStatus = `clipboard copy failed: ${(e as Error).message}`;
    }
  }

  function pasteOrganismToWorld(): void {
    if (!sim) return;
    let raw: string | null = null;
    try {
      raw = globalThis.localStorage?.getItem(ORGANISM_STORAGE_KEY) ?? null;
    } catch {
      raw = null;
    }
    if (raw === null) {
      clipboardStatus = 'clipboard: nothing to paste';
      return;
    }
    try {
      const cb = clipboardFromString(raw);
      const dropX = sim.world.width / 2;
      const dropY = sim.world.height / 2;
      const slots = pasteOrganism(sim, cb, dropX, dropY);
      population = sim.storage.activeCount;
      // Paste is a user action — capture it on the timeline and
      // forward-state invalidate beyond the now-edited head.
      recordNow(true);
      clipboardStatus = `pasted ${slots.length} of ${cb.count} organisms at center`;
    } catch (e) {
      clipboardStatus = `clipboard paste failed: ${(e as Error).message}`;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      e.preventDefault();
      paused = !paused;
    } else if (e.key === '.') {
      if (sim && paused) stepOnce(sim);
    } else if (e.key === 'r' || e.key === 'R') {
      resetWorld();
    } else if (e.key === 's' || e.key === 'S') {
      if (!e.ctrlKey && !e.metaKey) saveSnapshot();
    } else if (e.key === 'c' || e.key === 'C') {
      // Don't capture the browser's native Ctrl-C copy — only react on
      // bare C so we don't trample text selection in inputs.
      if (!e.ctrlKey && !e.metaKey) copyCluster();
    } else if (e.key === 'p' || e.key === 'P') {
      if (!e.ctrlKey && !e.metaKey) pasteOrganismToWorld();
    }
  }

  function onFileChange(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // reset so reloading the same file still fires
    if (file) void loadSnapshotFromFile(file);
  }

  $effect(() => {
    if (!canvas) return;
    renderer = new Renderer(canvas);
    sim = createSimulationState(64_000, { ...DEFAULT_WORLD_CONFIG }, DEFAULT_WORLD_CONFIG.seed);
    config = { ...DEFAULT_WORLD_CONFIG };
    const rng = new Rng(sim.rng.snapshot());
    scatterClusteredFounders(initialPopulation, rng, sim.world, initialClusters).forEach((f) => {
      spawnParticle(sim!, f.x, f.y, f.vx, f.vy, f.energy, false, -1, f.genomeRow);
    });
    population = sim.storage.activeCount;
    dustCt = countDust(sim);
    timeline = createTimeline();
    recordNow(true);
    resizeCanvas();
    lastFpsSample = performance.now();
    rafHandle = requestAnimationFrame(loop);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', resizeCanvas);
    return () => {
      cancelAnimationFrame(rafHandle);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', resizeCanvas);
    };
  });
</script>

<div class="relative flex h-full w-full overflow-hidden bg-bg-base">
  <canvas bind:this={canvas} class="flex-1 block bg-bg-base" style="image-rendering:pixelated"></canvas>
  <div class="absolute top-0 right-0 h-full">
    <Hud
      {fps}
      {population}
      dustCount={dustCt}
      {tick}
      {config}
      paused={paused}
      initialPopulation={initialPopulation}
      clipboardStatus={clipboardStatus}
      scrubRange={scrubRange}
      onReset={resetWorld}
      onStep={() => sim && stepOnce(sim)}
      onTogglePause={() => (paused = !paused)}
      onChangeConfig={changeConfig}
      onSaveSnapshot={saveSnapshot}
      onLoadSnapshot={loadSnapshot}
      onCopyOrganism={copyCluster}
      onPasteOrganism={pasteOrganismToWorld}
      onScrubTo={scrubTo}
    />
  </div>
  <input
    type="file"
    accept=".json,application/json"
    class="hidden"
    bind:this={fileInput}
    onchange={onFileChange}
    aria-hidden="true"
  />
</div>

<style>
  /* kept empty: layout classes are inline */
</style>
