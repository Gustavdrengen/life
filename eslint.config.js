import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],
  // Svelte files use a dedicated parser that understands <script lang="ts">.
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte']
      }
    }
  },
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'svelte/no-at-html-tags': 'warn'
    }
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['tools/**/*.ts', 'tools/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      // Build/CLI scripts talk back to the operator via `log`.
      'no-console': 'off'
    }
  },
  {
    ignores: ['dist/**', 'build/**', 'node_modules/**', '*.config.*', 'vite.config.ts']
  }
];

