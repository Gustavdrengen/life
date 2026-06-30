<script lang="ts">
  /**
   * HUD root — the side panel + telemetry chunk. Reads the runtime state
   * the engine writes and exposes minimal controls. Keep dense, dark,
   * keyboard-navigable, scientific-sandbox-vibe.
   */
  type Reset = () => void;

  interface Props {
    fps: number;
    population: number;
    dustCount: number;
    tick: number;
    onReset: Reset;
    onStep: () => void;
    onTogglePause: () => void;
    paused: boolean;
    initialPopulation: number;
  }

  let {
    fps,
    population,
    dustCount,
    tick,
    onReset,
    onStep,
    onTogglePause,
    paused,
    initialPopulation
  }: Props = $props();
</script>

<aside
  class="bg-bg-panel border-l border-bg-edge text-text-primary font-sans flex flex-col gap-3 p-3 w-56 select-none"
  aria-label="Engine HUD"
>
  <header class="flex items-baseline justify-between">
    <h1 class="text-2xs uppercase tracking-widest text-text-secondary">Ecosystem</h1>
    <p class="text-2xs text-text-muted font-mono">tick {tick.toString().padStart(6, '0')}</p>
  </header>

  <section class="rounded border border-bg-edge bg-bg-edge/30 p-2" aria-label="Telemetry">
    <dl class="grid grid-cols-2 gap-y-1 text-2xs">
      <dt class="text-text-muted">fps</dt>
      <dd class="font-mono text-text-primary text-right">{fps.toFixed(1)}</dd>
      <dt class="text-text-muted">population</dt>
      <dd class="font-mono text-text-primary text-right">{population} / {initialPopulation}</dd>
      <dt class="text-text-muted">dust</dt>
      <dd class="font-mono text-text-primary text-right">{dustCount}</dd>
    </dl>
  </section>

  <section class="rounded border border-bg-edge bg-bg-edge/30 p-2" aria-label="Controls">
    <button
      class="w-full text-left text-2xs uppercase tracking-wider px-2 py-1 mb-1 bg-bg-edge text-text-secondary hover:text-text-primary hover:bg-bg-muted border border-transparent hover:border-bg-muted rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-signalA"
      type="button"
      onclick={onTogglePause}
      aria-pressed={paused}
    >
      {paused ? '▶ play (Space)' : '⏸ pause (Space)'}
    </button>
    <button
      class="w-full text-left text-2xs uppercase tracking-wider px-2 py-1 mb-1 bg-bg-edge text-text-secondary hover:text-text-primary hover:bg-bg-muted border border-transparent hover:border-bg-muted rounded-sm disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-signalA"
      type="button"
      onclick={onStep}
      disabled={!paused}
    >
      step once (.)
    </button>
    <button
      class="w-full text-left text-2xs uppercase tracking-wider px-2 py-1 bg-bg-edge text-text-secondary hover:text-text-primary hover:bg-bg-muted border border-transparent hover:border-bg-muted rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-signalA"
      type="button"
      onclick={onReset}
    >
      reset world (R)
    </button>
  </section>

  <section
    class="rounded border border-bg-edge bg-bg-edge/30 p-2 text-text-muted"
    aria-label="Help"
  >
    <p class="text-2xs">
      The signal field is the gradient. The genome is the only dial.
      Cross-breeding is emergent.
    </p>
  </section>
</aside>
