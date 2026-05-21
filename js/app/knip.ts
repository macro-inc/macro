import type { KnipConfig } from 'knip';

const blockEntry = {
  entry: ['**/*.{ts,tsx}'],
  project: ['**/*.{ts,tsx}'],
};

const config: KnipConfig = {
  // Generated files and vendored code should be ignored
  ignore: [
    '**/generated/**',
    'scripts/**',
    '../loro-mirror/**',
    'packages/service-storage/**',
    // Tool/build configs that are entry points to their own tooling
    '**/vite.config.ts',
    '**/vite-ci.config.ts',
    '**/vite.base.ts',
    '**/vitest.config.ts',
    '**/vitest.setup.ts',
    '**/playwright.config.ts',
    '**/orval.config.ts',
    '**/*.d.ts',
    // Playwright tests (matched by a playwright config, not a JS import)
    '**/*.pw.ts',
    // Manually-invoked build scripts within packages
    '**/scripts/**',
  ],

  // Dependencies that are used but hard to detect statically
  ignoreDependencies: [
    // Font packages (imported via CSS @import, not JS)
    '@fontsource-variable/inter',
    '@fontsource-variable/roboto-mono',
    // Tauri plugins (loaded at runtime by the Tauri framework, not imported in JS)
    'tauri-plugin-safe-area-insets',
    '@inkibra/tauri-plugins',
    // Type-only packages (global ambient types, no direct imports)
    '@types/facebook-pixel',
    '@types/gtag.js',
    '@types/ws',
    '@types/wicg-file-system-access',
    // Code generation tools (invoked via CLI scripts, not imported in source)
    'bebop-tools',
    'orval',
    'json-refs',
    'json-schema-to-typescript',
    'json-schema-to-zod',
    'typedoc',
    // Build tools used by Vite/bundler internally
    'lightningcss',
    'concurrently',
    // Runtime tooling invoked via CLI (npm scripts, justfile, etc.)
    '@biomejs/biome',
    '@vitest/ui',
    '@datadog/datadog-ci',
    // Dynamically imported in .js worker (knip can't see)
    'libheif-js',
  ],

  // Ignore workspaces that are not real app code
  ignoreWorkspaces: ['../loro-mirror'],

  // Workspace configurations
  workspaces: {
    'packages/app': {
      entry: ['index.tsx', 'index.css'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/core': {
      entry: ['index.ts'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/ui': {
      entry: ['index.ts'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/queries': {
      entry: ['index.ts'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/notifications': {
      entry: ['index.ts'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/websocket': {
      entry: ['index.ts'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/baby-gl': {
      entry: ['index.ts'],
      project: ['**/*.{ts,tsx}'],
    },

    // Packages with src/index.ts
    'packages/filesystem': {
      entry: ['src/main.ts'],
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/document-processing-types': {
      entry: ['src/index.ts'],
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/entity': {
      entry: ['src/index.ts'],
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/macro-entity': {
      entry: ['src/index.tsx'],
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/observability': {
      entry: ['src/index.ts'],
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/property': {
      entry: ['src/index.ts'],
      project: ['src/**/*.{ts,tsx}'],
    },
    'packages/tauri': {
      entry: ['src/index.ts'],
      project: ['src/**/*.{ts,tsx}'],
    },

    // Block packages and others consumed via tsconfig path aliases (no index.ts entry)
    'packages/block-automation': blockEntry,
    'packages/block-call': blockEntry,
    'packages/block-canvas': blockEntry,
    'packages/block-channel': blockEntry,
    'packages/block-chat': blockEntry,
    'packages/block-code': blockEntry,
    'packages/block-email': blockEntry,
    'packages/block-image': blockEntry,
    'packages/block-md': blockEntry,
    'packages/block-pdf': blockEntry,
    'packages/block-project': blockEntry,
    'packages/block-unknown': blockEntry,
    'packages/block-video': blockEntry,
    'packages/channel': blockEntry,
    'packages/design': blockEntry,
    'packages/icon': blockEntry,
    'packages/service-clients': blockEntry,
    'packages/theme': blockEntry,
    'packages/workers': blockEntry,
  },
};

export default config;
