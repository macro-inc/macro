import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

const MODULE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Directory for Vitest's filesystem module cache, which `--fsModuleCache`
 * (the `test` script) turns on for every project. Cached transforms embed
 * resolved import paths, so entries live under a key of the lockfile and
 * tsconfig; key directories unused for a week are deleted. CI points
 * `VITEST_MODULE_CACHE_DIR` at a cache volume that persists across jobs.
 */
function moduleCachePath(): string {
  const root =
    process.env.VITEST_MODULE_CACHE_DIR ??
    fileURLToPath(new URL('./.cache/vitest-modules', import.meta.url));
  const key = createHash('sha256')
    .update(readFileSync(new URL('../../bun.lock', import.meta.url)))
    .update(readFileSync(new URL('./tsconfig.json', import.meta.url)))
    .digest('hex')
    .slice(0, 16);
  const dir = join(root, key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.last-used'), '');
  for (const entry of readdirSync(root)) {
    if (entry === key) continue;
    const stale = join(root, entry);
    try {
      const lastUsed = statSync(join(stale, '.last-used')).mtimeMs;
      if (Date.now() - lastUsed > MODULE_CACHE_MAX_AGE_MS) {
        rmSync(stale, { recursive: true, force: true });
      }
    } catch {
      // Not a key directory, or another run removed it first.
    }
  }
  return dir;
}

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: {
      '@solid-primitives/refs': fileURLToPath(
        new URL(
          '../../node_modules/@solid-primitives/refs/dist/index.js',
          import.meta.url
        )
      ),
      '@solid-primitives/transition-group': fileURLToPath(
        new URL(
          '../../node_modules/@solid-primitives/transition-group/dist/index.js',
          import.meta.url
        )
      ),
    },
  },
  test: {
    exclude: [...configDefaults.exclude],
    // Projects without their own path fall back to the root's.
    fsModuleCachePath: moduleCachePath(),
    projects: [
      {
        extends: './src/features/scheduling/vitest.config.ts',
        test: {
          include: ['src/features/scheduling/**/*.{test,spec}.{ts,tsx}'],
          name: 'scheduling',
        },
      },
      '../../packages/email-renderer/vitest.config.ts',
      '../../packages/collaboration/vitest.collab.config.ts',
      '../../packages/collaboration/vitest.transport.config.ts',
      '../../packages/machine/vitest.config.ts',
      {
        extends: false,
        test: {
          name: 'forms-editing-worker',
          environment: 'node',
          include: [
            '../../services/ai-editing-worker/src/forms/**/*.test.ts',
            '../../services/ai-editing-worker/src/endpoints/forms.test.ts',
          ],
        },
      },
      {
        // Core package tests
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: [
            'src/lib/core/**/*.{test,spec}.{ts,tsx}',
            'src/lib/split-router/**/*.{test,spec}.{ts,tsx}',
          ],
          name: 'core',
        },
      },
      {
        // Queries package tests
        extends: './src/lib/queries/vitest.config.ts',
        test: {
          include: ['src/lib/queries/**/*.{test,spec}.{ts,tsx}'],
          name: 'queries',
        },
      },
      {
        extends: false,
        // Resolve solid-js to its reactive browser build (the default
        // server-side build is inert), needed by the solid/ bindings.
        plugins: [tsconfigPaths(), solidPlugin()],
        ssr: {
          resolve: {
            conditions: ['browser', 'development'],
          },
        },
        test: {
          environment: 'jsdom',
          include: ['src/lib/graphql-cache/**/*.{test,spec}.{ts,tsx}'],
          name: 'graphql-cache',
        },
      },
      {
        extends: false,
        plugins: [tsconfigPaths(), solidPlugin()],
        ssr: {
          resolve: {
            conditions: ['browser', 'development'],
          },
        },
        test: {
          environment: 'jsdom',
          include: ['src/lib/urql-solid/**/*.{test,spec}.{ts,tsx}'],
          name: 'urql-solid',
        },
      },
      {
        extends: false,
        test: {
          include: ['scripts/**/*.{test,spec}.{ts,tsx}'],
          name: 'scripts',
        },
      },
      {
        extends: false,
        test: {
          environment: 'jsdom',
          globals: true,
          include: ['../../packages/lexical-core/**/*.{test,spec}.{ts,tsx}'],
          name: 'lexical-core',
        },
      },
      {
        extends: false,
        plugins: [tsconfigPaths()],
        test: {
          environment: 'jsdom',
          globals: true,
          include: ['src/features/theme/**/*.{test,spec}.{ts,tsx}'],
          name: 'theme',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/features/block-channel/**/*.{test,spec}.{ts,tsx}'],
          name: 'block-channel',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/features/block-call/**/*.{test,spec}.{ts,tsx}'],
          name: 'block-call',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/features/block-pr/**/*.{test,spec}.{ts,tsx}'],
          name: 'block-pr',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/features/block-md/**/*.{test,spec}.{ts,tsx}'],
          name: 'block-md',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/features/channel/**/*.{test,spec}.{ts,tsx}'],
          name: 'channel',
        },
      },
      {
        extends: './src/features/notifications/vitest.config.ts',
        test: {
          include: ['src/features/notifications/**/*.{test,spec}.{ts,tsx}'],
          name: 'notifications',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          environment: 'jsdom',
          include: [
            'src/features/{block-email,email-message,email-thread,email-compose}/**/*.{test,spec}.{ts,tsx}',
          ],
          name: 'email',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/lib/service-clients/**/*.{test,spec}.{ts,tsx}'],
          name: 'service-clients',
        },
      },
      {
        extends: './src/lib/core/vitest.config.ts',
        test: {
          include: ['src/lib/tauri/**/*.{test,spec}.{ts,tsx}'],
          name: 'tauri',
        },
      },
      {
        // Keep transition primitives on the same browser runtime as their callers.
        // Optimizing the CommonJS entry otherwise bundles a second Solid instance.
        extends: './src/lib/core/vitest.config.ts',
        resolve: {
          alias: {
            'solid-transition-group': fileURLToPath(
              new URL(
                '../../node_modules/solid-transition-group/dist/index.js',
                import.meta.url
              )
            ),
          },
        },
        ssr: {
          resolve: { conditions: ['browser', 'development'] },
        },
        test: {
          deps: { optimizer: { client: { enabled: false } } },
          include: ['src/components/view-shell/**/*.{test,spec}.{ts,tsx}'],
          name: 'view-shell',
        },
      },
      {
        // App-shell and feature tests without a specialized environment.
        extends: './src/lib/core/vitest.config.ts',
        test: {
          environment: 'jsdom',
          exclude: [
            ...configDefaults.exclude,
            'src/components/view-shell/**/*',
            'src/features/scheduling/**/*',
            'src/features/{theme,block-channel,block-call,block-pr,block-md,channel,notifications,block-email,email-message,email-thread,email-compose}/**/*',
          ],
          include: [
            'src/components/**/*.{test,spec}.{ts,tsx}',
            'src/features/**/*.{test,spec}.{ts,tsx}',
            'src/lib/analytics/**/*.{test,spec}.{ts,tsx}',
            'src/lib/constants/**/*.{test,spec}.{ts,tsx}',
            'src/lib/fullcalendar-solid/**/*.{test,spec}.{ts,tsx}',
            'src/lib/persistence/**/*.{test,spec}.{ts,tsx}',
            'src/lib/utils/**/*.{test,spec}.{ts,tsx}',
            'src/lib/workers/slack-import/**/*.{test,spec}.{ts,tsx}',
            'src/routes/**/*.{test,spec}.{ts,tsx}',
            'src/observability/**/*.{test,spec}.{ts,tsx}',
          ],
          name: 'app',
        },
      },
    ],
  },
});
