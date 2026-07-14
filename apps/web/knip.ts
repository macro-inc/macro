import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'src/index.tsx',
    'src/index.css',
    // Block definitions are discovered with import.meta.glob at runtime. Treat
    // those discovery roots as entries; their imports make the rest of each
    // block reachable without hiding dead block-local files from Knip.
    'src/features/block-*/definition.ts',
    'src/lib/workers/**/*.{js,ts,tsx}',
  ],
  project: ['src/**/*.{js,ts,tsx}'],

  // Generated files and vendored code should be ignored.
  ignore: [
    '**/generated/**',
    'scripts/**',
    '../../packages/loro-mirror/**',
    '**/vite.config.ts',
    '**/vite-ci.config.ts',
    '**/vite.base.ts',
    '**/vitest.config.ts',
    '**/vitest.setup.ts',
    '**/playwright.config.ts',
    '**/orval.config.ts',
    '**/*.d.ts',
    '**/*.pw.ts',
    '**/scripts/**',
  ],

  // Dependencies that are used but hard to detect statically.
  ignoreDependencies: [
    '@fontsource-variable/inter',
    '@fontsource-variable/roboto-mono',
    'tauri-plugin-safe-area-insets',
    '@inkibra/tauri-plugins',
    '@types/facebook-pixel',
    '@types/gtag.js',
    '@types/ws',
    '@types/wicg-file-system-access',
    'bebop-tools',
    'orval',
    'json-refs',
    'json-schema-to-typescript',
    'json-schema-to-zod',
    'typedoc',
    'lightningcss',
    'concurrently',
    '@biomejs/biome',
    '@vitest/ui',
    '@datadog/datadog-ci',
    'libheif-js',
  ],

  ignoreWorkspaces: ['../../packages/loro-mirror'],
};

export default config;
