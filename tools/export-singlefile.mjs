#!/usr/bin/env node
/**
 * tools/export-singlefile.mjs
 *
 * Produces a single `.html` file containing the entire engine + UI so a
 * friend can open it in any modern browser with no install. Mirrors
 * `vite build` but with `VITE_SINGLEFILE=true` so that
 * `vite-plugin-singlefile` inlines every asset into one document.
 *
 * Usage: `node tools/export-singlefile.mjs <input-html>` where
 * `<input-html>` is the path Vite normally writes (`dist/index.html`).
 * The script itself orchestrates the build with the single-file plugin
 * enabled, then writes a renamed copy of that document to
 * `dist/ecosystem-<short>.html` for handing off.
 *
 * Exits non-zero if the build fails or the produced file exceeds the
 * 5 MB VISION §Constraints file-budget ceiling.
 *
 * @see specs/ROOT.md §10 (acceptance #8 — round-trip)
 * @see VISION.md §12 "Single-file HTML export"
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = process.cwd();
const inputHtml = process.argv[2];
if (inputHtml === undefined) {
  console.error('[export] usage: node tools/export-singlefile.mjs <input-html>');
  console.error('         e.g. node tools/export-singlefile.mjs dist/index.html');
  process.exit(2);
}
const srcHtml = resolve(cwd, inputHtml);

// vit is referenced via `./node_modules/.bin/vite` so we don't depend on
// PATH. The script lives at tools/export-singlefile.mjs, so the project
// root is two segments up from __dirname of this file.
const here = dirname(fileURLToPath(import.meta.url));
const viteBin = resolve(here, '..', 'node_modules', '.bin', 'vite');

console.log('[export] single-file mode (VITE_SINGLEFILE=true)');
const build = spawnSync(viteBin, ['build'], {
  cwd,
  env: { ...process.env, VITE_SINGLEFILE: 'true' },
  stdio: 'inherit'
});
if (build.error) {
  console.error(`[export] failed to spawn vite at ${viteBin}: ${build.error.message}`);
  process.exit(1);
}
if (build.status !== 0) {
  console.error(`[export] vite build failed (exit ${build.status ?? 'unknown'})`);
  process.exit(build.status ?? 1);
}

if (!existsSync(srcHtml)) {
  console.error(`[export] expected ${srcHtml} after build; not found`);
  process.exit(1);
}

const html = readFileSync(srcHtml, 'utf8');
// Sanity: the inlined bundle should mention both `<script` and `<style`
// inline. If those tags still point at /assets/* the single-file plugin
// never engaged; refuse to ship a half-exported file.
if (!/type="module"/.test(html) || !/<style/.test(html)) {
  // Plugin may inline the CSS as a <link rel="stylesheet"> blob that
  // was rewritten; the marker we DO insist on is that the original
  // /assets/ CSS link tag is gone.
  if (/\/assets\/[^"']+\.css/.test(html)) {
    console.error('[export] built HTML still references /assets/*.css');
    console.error('           single-file plugin did not engage; aborting');
    process.exit(3);
  }
}

// Pick a short fingerprint from the file size so successive exports
// don't clobber earlier artifacts.
const bytes = statSync(srcHtml).size;
// VISION §Constraints: file budget 5 MB even at target population.
const MAX_BYTES = 5 * 1024 * 1024;
if (bytes > MAX_BYTES) {
  console.error(
    `[export] output is ${(bytes / 1024 / 1024).toFixed(2)} MB; budget is 5 MB`
  );
  process.exit(4);
}

const outFile = resolve(cwd, 'dist', `ecosystem-${(bytes / 1024).toFixed(0)}kB.html`);
writeFileSync(outFile, html);
console.log(`[export] wrote ${outFile} (${(bytes / 1024).toFixed(1)} kB)`);
