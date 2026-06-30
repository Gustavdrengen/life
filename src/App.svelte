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
    Rng
  } from '$engine/core/index.js';
  import type { SimulationState } from '$engine/core/step.js';
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
  const initialPopulation = DEFAULT_WORLD_CONFIG.targetPopulation;
  /** Number of founding clusters. ~3% of the population — small enough
   * for visible color separation, large enough that no cluster trivially
   * starves. */
  const initialClusters = Math.max(6, Math.min(20, Math.floor(initialPopulation * 0.03)));

  function resetWorld(): void {
    if (!sim) return;
    const seed = sim.rng.snapshot();
    sim = createSimulationState(64_000, { ...DEFAULT_WORLD_CONFIG }, seed);
    scatterClusteredFounders(
      initialPopulation,
      sim.rng,
      sim.world,
      initialClusters
    ).forEach((f) => {
      spawnParticle(sim!, f.x, f.y, f.vx, f.vy, f.energy, false, -1, f.genomeRow);
    });
    tick = 0;
    population = sim.storage.activeCount;
    dustCt = countDust(sim);
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
      paused={paused}
      initialPopulation={initialPopulation}
      onReset={resetWorld}
      onStep={() => sim && stepOnce(sim)}
      onTogglePause={() => (paused = !paused)}
    />
  </div>
</div>

<style>
  /* kept empty: layout classes are inline */
</style>
