import typescriptParser from '@typescript-eslint/parser';
import type { Linter } from 'eslint';
import { browserFloorRule } from './src/browser-floor-rule';
import { WEB_SOURCES } from './src/web-sources';

// Paths are relative to the repository root, where src/lint-web.ts runs ESLint.
const config: Linter.Config[] = [
  {
    files: WEB_SOURCES.map((source) => `${source}/**/*.{ts,tsx}`),
    ignores: [
      // Tests and browser harnesses run in Node or current Chromium, not the
      // supported webviews.
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/*.d.ts',
      '**/__tests__/**',
      '**/browser-test/**',
      '**/tests/**',
      '**/test-utils/**',
      '**/scripts/**',
      '**/testing.ts',
    ],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'platform-compat': { rules: { 'browser-floor': browserFloorRule } },
    },
    rules: { 'platform-compat/browser-floor': 'error' },
  },
];

export default config;
