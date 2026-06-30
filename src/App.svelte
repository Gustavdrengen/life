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
    Rng
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
  // Live-editable HUD-bound config view. The engine owns the canonical
  // copy on `sim.world`; we mirror it here so Svelte's reactive layer can
  // detect edits without subscribing to the simulation state.
  const sharedConfig = { ...DEFAULT_WORLD_CONFIG };
  let config = $state({ ...sharedConfig });
  const initialPopulation = DEFAULT_WORLD_CONFIG.targetPopulation;
  /** Number of founding clusters. ~3% of the population — small enough
   * for visible color separation, large enough that no cluster trivially
   * starves. */
  const initialClusters = Math.max(6, Math.min(20, Math.floor(initialPopulation * 0.03)));

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
  }

  function resetWorld(): void {
    if (!sim) return;
    const seed = sim.rng.snapshot();
    rebuildFromSeed(seed);
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

  /** HUD → engine wiring. Edits to latticeResolution recreate the field
   * (handled by setWorld). Other edits only mutate the world dims in
   * place. We rebuild the simulation so the changed cutoff takes visible
   * effect immediately rather than drifting through stale emitter lobes. */
  function changeConfig(key: ConfigKey, value: number): void {
    if (!sim) return;
    const next = { ...config, [key]: clamp(key, value) };
    if (next[key] === config[key]) return; // no-op when clamp rejected it
    config = next;
    setWorld(sim, next);
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

  function onKey(e: KeyboardEvent): void {
    if (e.key === ' ') {
      e.preventDefault();
      paused = !paused;
    } else if (e.key === '.') {
      if (sim && paused) stepOnce(sim);
    } else if (e.key === 'r' || e.key === 'R') {
      resetWorld();
    }
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
      onReset={resetWorld}
      onStep={() => sim && stepOnce(sim)}
      onTogglePause={() => (paused = !paused)}
      onChangeConfig={changeConfig}
    />
  </div>
</div>

<style>
  /* kept empty: layout classes are inline */
</style>
