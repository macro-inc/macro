import path from 'node:path';
import { Features } from 'lightningcss';
import type { StorybookConfig } from 'storybook-solidjs-vite';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigpaths from 'vite-tsconfig-paths';

const getAbsolutePath = (packageName: string): string =>
  path
    .dirname(import.meta.resolve(path.join(packageName, 'package.json')))
    .replace(/^file:\/\//, '');

const config: StorybookConfig = {
  stories: ['../**/*.mdx', '../**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  staticDirs: [
    { from: '../../app/asset/fonts', to: '/fonts' },
    // Also serve at the path that index.css @font-face rules expect after Vite transforms them
    { from: '../../app/asset/fonts', to: '/asset/fonts' },
  ],
  addons: [
    getAbsolutePath('@storybook/addon-docs'),
    getAbsolutePath('@storybook/addon-vitest'),
    getAbsolutePath('@storybook/addon-a11y'),
    getAbsolutePath('@storybook/addon-designs'),
    getAbsolutePath('@storybook/addon-themes'),
  ],
  docs: {
    defaultName: 'Overview',
  },
  framework: {
    name: getAbsolutePath('storybook-solidjs-vite'),
    options: {
      docgen: true,
    },
  },
  viteFinal: async (config) => {
    // Use the same CSS setup as the main app
    config.css = {
      preprocessorMaxWorkers: true,
      transformer: 'lightningcss',
      lightningcss: {
        include: Features.VendorPrefixes,
      },
    };

    // Add TypeScript path resolution for monorepo imports
    config.plugins = config.plugins || [];
    config.plugins.push(
      tsconfigpaths({
        root: '../../',
      })
    );

    // Add SVG support to match main app configuration
    config.plugins.push(solidSvg({ defaultAsComponent: true }));

    // Add WASM support to match main app configuration
    config.plugins.push(wasm());

    // Configure build target and optimization to match main app
    config.build = {
      ...config.build,
      target: 'esnext',
    };

    // Configure esbuild to support top-level await and automatic JSX transform for SolidJS
    config.esbuild = {
      ...config.esbuild,
      jsx: 'automatic',
      jsxImportSource: 'solid-js',
      supported: {
        'top-level-await': true,
      },
      target: 'esnext',
    };

    // Configure optimizeDeps to match main app and exclude problematic dependencies
    config.optimizeDeps = {
      ...config.optimizeDeps,
      esbuildOptions: {
        ...config.optimizeDeps?.esbuildOptions,
        jsx: 'automatic',
        jsxImportSource: 'solid-js',
        target: 'esnext',
        supported: {
          'top-level-await': true,
        },
      },
      exclude: [...(config.optimizeDeps?.exclude || []), 'loro-crdt'],
    };

    // Dynamically import the TailwindCSS Vite plugin to avoid module resolution issues
    const { default: tailwind } = await import('@tailwindcss/vite');
    config.plugins.push(tailwind());

    // Ignore sourcemaps from dist folders to prevent errors from stale build artifacts
    config.server = {
      ...config.server,
      sourcemapIgnoreList: (sourcePath) => {
        return sourcePath.includes('/dist/');
      },
    };

    return config;
  },
};

export default config;
