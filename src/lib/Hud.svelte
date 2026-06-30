<script lang="ts">
  /**
   * HUD root — the side panel + telemetry chunk. Reads the runtime state
   * the engine writes and exposes minimal controls. Keep dense, dark,
   * keyboard-navigable, scientific-sandbox-vibe.
   */
  import type { ConfigKey, HudProps } from '$lib/hud_types.js';

  let {
    fps,
    population,
    dustCount,
    tick,
    config,
    inspector,
    onClearInspector,
    onReset,
    onStep,
    onTogglePause,
    onChangeConfig,
    onSaveSnapshot,
    onLoadSnapshot,
    onCopyOrganism,
    onPasteOrganism,
    onScrubTo,
    scrubRange,
    clipboardStatus,
    paused,
    initialPopulation,
    clusterCount,
    gpuStatus
  }: HudProps = $props();

  function fmt(value: number): string {
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value) >= 100) return value.toFixed(0);
    return value.toFixed(2);
  }

  type Row = {
    key: ConfigKey;
    label: string;
    min: number;
    max: number;
    step: number;
    help: string;
  };
  const ROWS: readonly Row[] = [
    {
      key: 'latticeResolution',
      label: 'lattice res',
      min: 8,
      max: 96,
      step: 1,
      help: 'signal lattice cells per axis'
    },
    {
      key: 'signalCutoff',
      label: 'signal cutoff',
      min: 4,
      max: 240,
      step: 1,
      help: 'emitter deposit radius (world units)'
    },
    {
      key: 'predationSpeedThreshold',
      label: 'predation speed',
      min: 0,
      max: 8,
      step: 0.1,
      help: 'min speed to absorb on contact'
    },
    {
      key: 'dustAbsorbSpeed',
      label: 'dust absorb speed',
      min: 0,
      max: 8,
      step: 0.1,
      help: 'min speed to absorb dust'
    },
    {
      key: 'contactSeparation',
      label: 'contact sep',
      min: 0.5,
      max: 4,
      step: 0.05,
      help: 'bounce/predation trigger proximity'
    },
    {
      key: 'dustDecayPerSec',
      label: 'dust decay/s',
      min: 0,
      max: 0.5,
      step: 0.01,
      help: 'energy/sec removed from dust (0 = never)'
    }
  ];

  // Defensive: storage-backed `config` may be missing fields if a
  // future WorldConfig adds them; fall back to the field default 0
  // so the panel still renders.
  function readConfig(key: ConfigKey): number {
    const value = config?.[key];
    return Number.isFinite(value) ? (value as number) : 0;
  }
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
    class="rounded border border-bg-edge bg-bg-edge/30 p-2"
    aria-label="Timeline scrubber"
  >
    <h2 class="text-2xs uppercase tracking-widest text-text-secondary mb-1">Timeline</h2>
    <div class="flex items-center justify-between text-2xs text-text-muted mb-1 font-mono">
      <span>{scrubRange[0]}</span>
      <span class="text-text-primary">→ {scrubRange[1]}</span>
    </div>
    <input
      type="range"
      min={scrubRange[0]}
      max={scrubRange[1]}
      step="1"
      value={tick}
      oninput={(e) => onScrubTo(Number((e.currentTarget as HTMLInputElement).value))}
      class="w-full accent-accent-signalA"
      aria-label="Scrub to tick"
      title="Drag to scrub through recorded snapshots"
      disabled={scrubRange[1] <= scrubRange[0]}
    />
    <p class="text-2xs text-text-muted mt-1">
      Scrub snaps each recorded snapshot.
    </p>
  </section>

  <section class="rounded border border-bg-edge bg-bg-edge/30 p-2" aria-label="Save / load">
    <h2 class="text-2xs uppercase tracking-widest text-text-secondary mb-1">Save / Load</h2>
    <div class="flex flex-col gap-1">
      <button
        class="text-left text-2xs px-2 py-1 bg-bg-edge text-text-secondary hover:text-text-primary hover:bg-bg-muted rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-signalA"
        type="button"
        onclick={onSaveSnapshot}
        title="Save the current world as a downloadable .snapshot.json file"
      >
        save snapshot (S)
      </button>
      <button
        class="text-left text-2xs px-2 py-1 bg-bg-edge text-text-secondary hover:text-text-primary hover:bg-bg-muted rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-signalA"
        type="button"
        onclick={onLoadSnapshot}
        title="Open a saved snapshot file and restore it into this world"
      >
        load snapshot
      </button>
    </div>
    <p class="text-2xs text-text-muted mt-1">{clipboardStatus}</p>
    <div class="flex flex-col gap-1 mt-2">
      <button
        class="text-left text-2xs px-2 py-1 bg-bg-edge text-text-secondary hover:text-text-primary hover:bg-bg-muted rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-signalA"
        type="button"
        onclick={onCopyOrganism}
        title="Copy the founders into the organism clipboard archive"
      >
        copy founders (C)
      </button>
      <button
        class="text-left text-2xs px-2 py-1 bg-bg-edge text-text-secondary hover:text-text-primary hover:bg-bg-muted rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-signalA"
        type="button"
        onclick={onPasteOrganism}
        title="Paste the organism clipboard archive at the world center"
      >
        paste organism (P)
      </button>
    </div>
  </section>

  <section class="rounded border border-bg-edge bg-bg-edge/30 p-2" aria-label="Parameters">
    <h2 class="text-2xs uppercase tracking-widest text-text-secondary mb-1">Parameters</h2>
    <ul class="flex flex-col gap-1">
      {#each ROWS as row (row.key)}
        {@const value = readConfig(row.key)}
        <li>
          <label class="flex items-center justify-between gap-2 text-2xs">
            <span class="text-text-muted lowercase">{row.label}</span>
            <input
              type="number"
              class="w-16 bg-bg-base text-text-primary font-mono text-2xs rounded px-1 py-0.5 border border-bg-edge focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-signalA"
              min={row.min}
              max={row.max}
              step={row.step}
              value={value}
              oninput={(e) => {
                const next = Number((e.currentTarget as HTMLInputElement).value);
                if (Number.isFinite(next)) onChangeConfig(row.key, next);
              }}
              title={row.help}
              aria-label={row.label}
            />
            <span class="font-mono text-text-muted w-10 text-right">{fmt(value)}</span>
          </label>
        </li>
      {/each}
    </ul>
  </section>

  <section class="rounded border border-bg-edge bg-bg-edge/30 p-2" aria-label="Inspector">
    <header class="flex items-baseline justify-between mb-1">
      <h2 class="text-2xs uppercase tracking-widest text-text-secondary">Inspector</h2>
      <p class="text-2xs text-text-muted font-mono">clusters: {clusterCount}</p>
    </header>
    {#if inspector !== null}
      <dl class="grid grid-cols-2 gap-y-1 text-2xs">
        <dt class="text-text-muted">slot</dt>
        <dd class="font-mono text-text-primary text-right">{inspector.slot}</dd>
        <dt class="text-text-muted">energy</dt>
        <dd class="font-mono text-text-primary text-right">{fmt(inspector.energy)}</dd>
        <dt class="text-text-muted">age</dt>
        <dd class="font-mono text-text-primary text-right">{inspector.age}</dd>
        <dt class="text-text-muted">velocity</dt>
        <dd class="font-mono text-text-primary text-right">
          ({fmt(inspector.velocity[0])}, {fmt(inspector.velocity[1])})
        </dd>
        <dt class="text-text-muted">signal</dt>
        <dd class="font-mono text-text-primary text-right">
          ({fmt(inspector.localSignal[0])}, {fmt(inspector.localSignal[1])}, {fmt(inspector.localSignal[2])})
        </dd>
      </dl>
      <details class="mt-2">
        <summary class="text-2xs text-text-muted cursor-pointer">genome ({inspector.genome.length} slots)</summary>
        <ol class="text-2xs font-mono text-text-secondary mt-1 max-h-40 overflow-y-auto">
          {#each inspector.genome as value, i (i)}
            <li>slot {i.toString().padStart(2, '0')}: <span class="text-text-primary">{fmt(value)}</span></li>
          {/each}
        </ol>
      </details>
      <button
        class="mt-2 text-left text-2xs px-2 py-1 bg-bg-edge text-text-secondary hover:text-text-primary rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-signalA"
        type="button"
        onclick={onClearInspector}
        title="Clear the inspected particle"
      >
        clear
      </button>
    {:else}
      <p class="text-2xs text-text-muted">click a particle to inspect.</p>
    {/if}
  </section>

  <section
    class="rounded border border-bg-edge bg-bg-edge/30 p-2 text-text-muted"
    aria-label="Help"
  >
    <p class="text-2xs">
      The signal field is the gradient. The genome is the only dial.
      Cross-breeding is emergent. Click a particle to inspect.
    </p>
    <p class="text-2xs text-text-muted mt-1 font-mono">{gpuStatus}</p>
  </section>
</aside>
