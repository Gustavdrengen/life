import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true
  },
  onwarn: (warning, defaultHandler) => {
    // Silence harmless a11y warnings during early development while the HUD
    // is being shaped. Tighten back up before any user-facing polish.
    if (warning.code === 'a11y-click-events-have-key-events') return;
    if (warning.code === 'a11y-no-static-element-interactions') return;
    defaultHandler(warning);
  }
};
