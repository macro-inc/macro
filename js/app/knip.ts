import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // Generated files and vendored code should be ignored
  ignore: [
    '**/generated/**',
    'scripts/**',
    '../loro-mirror/**',
    'packages/service-storage/**',
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
    // Code generation tools (invoked via CLI scripts, not imported in source)
    'bebop-tools',
    'orval',
    'json-refs',
    'json-schema-to-typescript',
    'json-schema-to-zod',
    // Build tools used by Vite/bundler internally
    'lightningcss',
    'concurrently',
    // Legacy biome package (different from @biomejs/biome)
    'biome',
  ],

  // Ignore workspaces that are not real app code
  ignoreWorkspaces: ['../loro-mirror'],

  // Workspace configurations
  workspaces: {
    // Packages with index.ts at root
    'packages/core': {
      entry: ['index.ts'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/ui': {
      entry: ['index.ts'],
      project: ['**/*.{ts,tsx}'],
    },

    // Packages with src/index.ts
    'packages/filesystem': {
      entry: ['src/main.ts'],
      project: ['src/**/*.{ts,tsx}'],
    },

    // Block packages and others consumed via tsconfig path aliases (no index.ts entry)
    'packages/block-canvas': {
      entry: ['**/*.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/block-channel': {
      entry: ['**/*.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/block-chat': {
      entry: ['**/*.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/block-code': {
      entry: ['**/*.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/block-image': {
      entry: ['**/*.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/block-md': {
      entry: ['**/*.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/block-pdf': {
      entry: ['**/*.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/block-project': {
      entry: ['**/*.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/block-unknown': {
      entry: ['**/*.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/block-video': {
      entry: ['**/*.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/channel': {
      entry: ['**/*.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
  },
};

export default config;
