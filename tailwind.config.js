/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,ts,js,html}'],
  theme: {
    extend: {
      colors: {
        // Scientific-sandbox dark palette. High contrast for HUD, low saturation
        // for organism overlays. Force WCAG AA on the default text colors here.
        bg: {
          base: '#0a0c10',
          panel: '#11141a',
          edge: '#1a1f28',
          muted: '#222932'
        },
        text: {
          primary: '#e6e8ec',
          secondary: '#a4abb9',
          muted: '#6e7686'
        },
        accent: {
          signalA: '#5fb3ff',
          signalB: '#ff7d52',
          signalC: '#b56cff',
          warn: '#ffb454',
          ok: '#5dd39e',
          err: '#ff6b6b'
        },
        organism: {
          outline: '#7a8aa0'
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Mono"', 'Menlo', 'monospace'],
        sans: ['"Inter"', 'system-ui', 'sans-serif']
      },
      fontSize: {
        '2xs': ['0.65rem', '0.9rem']
      }
    }
  },
  plugins: []
};
