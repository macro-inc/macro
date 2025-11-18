import { Features } from 'lightningcss';
import type { StorybookConfig } from 'storybook-solidjs-vite';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigpaths from 'vite-tsconfig-paths';

const config: StorybookConfig = {
  stories: [
    '../packages/**/*.mdx',
    '../packages/**/*.stories.@(js|jsx|mjs|ts|tsx)',
  ],
  addons: [
    '@storybook/addon-docs',
    '@storybook/addon-a11y',
    '@storybook/addon-designs',
  ],
  framework: {
    name: 'storybook-solidjs-vite',
    options: {},
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
        root: '../',
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

    return config;
  },
};

export default config;
