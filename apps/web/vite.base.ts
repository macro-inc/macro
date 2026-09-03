import { exec, execSync } from 'node:child_process';
import { appendFileSync, unwatchFile, watchFile } from 'node:fs';
import { resolve } from 'node:path';
import tailwind from '@tailwindcss/vite';
import { Features } from 'lightningcss';
import type { Plugin, UserConfigFn } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigpaths from 'vite-tsconfig-paths';
// @ts-ignore
import { version } from './package.json';
import { keepImportMetaDev } from './scripts/keep-import-meta-dev';
import { createDevSpeedPlugins } from './scripts/vite-dev-speed';

function readShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

const shortSha = readShortSha();
const appVersion = `${version}+${shortSha}`;

function readGitBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  } catch {
    return '';
  }
}

function readGitBranchAsync(): Promise<string> {
  return new Promise((res) => {
    exec('git rev-parse --abbrev-ref HEAD', (err, stdout) => {
      res(err ? '' : stdout.trim());
    });
  });
}

const BOOT_GRAPH_READY = '[vite] boot graph ready';
const DEBUG_LOG_PATH = '/opt/cursor/logs/debug.log';

function appendDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {}
) {
  try {
    appendFileSync(
      DEBUG_LOG_PATH,
      `${JSON.stringify({
        hypothesisId,
        location,
        message,
        data,
        timestamp: Date.now(),
      })}\n`
    );
  } catch {
    // best-effort dev-only instrumentation
  }
}

function bootGraphWarmupPlugin(): Plugin {
  return {
    name: 'boot-graph-warmup',
    apply: 'serve',
    configureServer(server) {
      const urls = ['/src/index.css', '/src/index.tsx', '/src/routes/Root.tsx'];
      let warmStartedAt = 0;
      let warmFinishedAt = 0;
      let firstAppRequestLogged = false;

      server.middlewares.use((req, res, next) => {
        if (
          !firstAppRequestLogged &&
          req.method === 'GET' &&
          (req.url === '/app' || req.url?.startsWith('/app?'))
        ) {
          firstAppRequestLogged = true;
          // #region agent log
          appendDebugLog('W', 'vite.base.ts:62', 'first app html request', {
            url: req.url,
            warmStartedAt,
            warmFinishedAt,
            bootGraphWarm: warmFinishedAt > 0,
          });
          // #endregion
        }
        if (req.method === 'POST' && req.url === '/__macro_perf') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body) as Record<string, unknown>;
              appendFileSync(DEBUG_LOG_PATH, `${JSON.stringify(payload)}\n`);
              res.statusCode = 204;
            } catch {
              res.statusCode = 400;
            }
            res.end();
          });
          return;
        }
        next();
      });
      server.httpServer?.once('listening', () => {
        const started = performance.now();
        warmStartedAt = Date.now();
        Promise.all(urls.map((url) => server.warmupRequest(url)))
          .then(() => {
            const ms = Math.round(performance.now() - started);
            warmFinishedAt = Date.now();
            // #region agent log
            appendDebugLog(
              'W',
              'vite.base.ts:90',
              'boot graph warmup complete',
              {
                urls,
                elapsedMs: ms,
              }
            );
            // #endregion
            server.config.logger.info(`boot graph warmed in ${ms}ms`);
            // run_local / frontend.sh wait for this exact line before
            // telling the user the app is ready, so the first /app load
            // hits transformed modules instead of a cold overlay-fs crawl.
            console.log(BOOT_GRAPH_READY);
          })
          .catch((error) => {
            server.config.logger.warn(
              `boot graph warmup failed: ${error instanceof Error ? error.message : error}`
            );
            console.log(BOOT_GRAPH_READY);
          });
      });
    },
  };
}

function gitBranchHmrPlugin(): Plugin {
  return {
    name: 'git-branch-hmr',
    apply: 'serve',
    configureServer(server) {
      let gitDir: string;
      try {
        gitDir = execSync('git rev-parse --absolute-git-dir').toString().trim();
      } catch {
        return;
      }
      const headPath = resolve(gitDir, 'HEAD');
      const emit = () => {
        readGitBranchAsync().then((branch) => {
          server.ws.send({
            type: 'custom',
            event: 'git-branch:update',
            data: branch,
          });
        });
      };
      watchFile(headPath, { interval: 100 }, emit);
      server.ws.on('connection', emit);
      server.httpServer?.once('close', () => unwatchFile(headPath));
    },
  };
}

export const createAppViteConfig = (): UserConfigFn => {
  return ({ command, mode }) => {
    const ENV_MODE = process.env.MODE ?? mode;
    const NO_MINIFY = process.env.NO_MINIFY === 'true';

    return {
      base: command === 'serve' ? '/' : '/app',
      assetsInclude: ['**/*.glb'],
      css: {
        preprocessorMaxWorkers: true,
        transformer: 'lightningcss',
        lightningcss: {
          include: Features.VendorPrefixes,
        },
      },
      plugins: [
        // solidDevtools({ autoname: true }),
        solid(),
        wasm(),
        tailwind(),
        // Serve-only: unbarrel @ui/@entity/@notifications, collapse Phosphor
        // SVGs into one module, and skip babel/SVGO on remaining icons.
        // Production still uses vite-plugin-solid-svg.
        ...createDevSpeedPlugins(__dirname),
        solidSvg({ defaultAsComponent: true }),
        tsconfigpaths({
          root: './',
        }),
        bootGraphWarmupPlugin(),
        gitBranchHmrPlugin(),
      ],
      define: defineEnv(ENV_MODE, command),
      clearScreen: false,
      worker: {
        format: 'es',
        plugins: () => [
          tsconfigpaths({
            root: './',
          }),
        ],
        rollupOptions: {
          output: {
            format: 'es',
            chunkFileNames: '[name]-[hash].js',
            entryFileNames: '[name]-[hash].js',
          },
        },
      },
      mode: ENV_MODE,
      build: {
        cssMinify: 'lightningcss',
        // target older safari to avoid lightningcss using text-decoration shorthand:
        // https://developer.mozilla.org/en-US/docs/Web/CSS/text-decoration#browser_compatibility
        cssTarget: ['esnext', 'safari15'],
        target: 'esnext',
        outDir: 'dist',
        emptyOutDir: true,
        minify: !NO_MINIFY,
        rollupOptions: {
          input: {
            app: resolve(__dirname, 'index.html'),
          },
          // KaTeX and PDF.js are now reachable through lazy boundaries. Let
          // Rollup place them naturally; forcing named chunks hoists shared
          // CommonJS helpers into those chunks and makes the entry preload
          // otherwise-lazy code.
          output: NO_MINIFY
            ? {
                // remove hashes from output paths
                // https://github.com/vitejs/vite/issues/378
                entryFileNames: `assets/[name].js`,
                chunkFileNames: `assets/[name].js`,
                assetFileNames: `assets/[name].[ext]`,
              }
            : {
                format: 'es',
                chunkFileNames: '[name]-[hash].js',
                entryFileNames: '[name]-[hash].js',
              },
        },
        assetsInlineLimit: (filePath) => {
          if (filePath.includes('.wasm')) return false;
          if (filePath.includes('/lok/')) return false;
        },
        sourcemap: true,
      },
      esbuild: {
        supported: {
          'top-level-await': true,
        },
        jsx: 'automatic',
        jsxImportSource: 'solid-js',
      },
      optimizeDeps: {
        // Don't block the first HTML/module request on the full dep crawl.
        // Large apps otherwise sit on a spinner until esbuild finishes.
        holdUntilCrawlEnd: false,
        include: [
          'vscode-textmate',
          'vscode-oniguruma',
          // 'solid-devtools/setup',
          'libheif-js/wasm-bundle',
          // ESM packages Vite leaves unbundled as many small files. Prebundling
          // them collapses the Linux HTTP/1.1 6-connection waterfall.
          '@internationalized/date',
          '@internationalized/number',
          '@use-gesture/core',
          'date-fns',
          'zod',
          '@floating-ui/dom',
          '@solid-primitives/storage',
          '@solid-primitives/resize-observer',
          'detect-browser',
        ],
        // loro-crdt is a wasm singleton. The app imports it directly (esbuild
        // pre-bundles a copy) while the linked `@loro-mirror/core` workspace
        // source imports it through vite-plugin-wasm — two module evaluations,
        // two wasm memories. A LoroDoc from one instance handed to a Mirror on
        // the other yields cross-instance container handles → `index out of
        // bounds` panics in dev only. Excluding it from pre-bundling collapses
        // everyone onto the single plugin-handled instance.
        exclude: ['loro-crdt'],
        esbuildOptions: {
          target: 'esnext',
        },
      },
      resolve: {
        alias: [
          // Nix injects its Tauri API alias here inside the sandboxed build.
          // NIX_TAURI_ALIAS
        ],
        dedupe: [
          'loro-crdt',
          'solid-js',
          '@codingame/monaco-vscode-api',
          '@codingame/monaco-vscode-*-common',
        ],
      },
      server: {
        port: Number(process.env.PORT || 3000),
        host: '0.0.0.0',
        strictPort: true,
        hmr: {
          protocol: 'ws',
          host: process.env.TAURI_DEV_HOST || 'localhost',
        },
        cors: true,
        // Transform the boot graph as soon as Vite binds so the first /app
        // load hits memory cache instead of the overlay-fs transform path.
        warmup: {
          clientFiles: [
            './index.html',
            './src/index.tsx',
            './src/index.css',
            './src/routes/Root.tsx',
          ],
        },
        watch: {
          // Native inotify/FSEvents. Polling every 100ms across this monorepo
          // starves the transform pipeline on Linux overlay/virtio disks
          // (VMs, Docker, Cloud) while macOS APFS hides the cost. Opt back
          // in with VITE_USE_POLLING=true when the FS cannot inotify
          // (some bind mounts, WSL1).
          usePolling:
            process.env.VITE_USE_POLLING === 'true' ||
            process.env.CHOKIDAR_USEPOLLING === 'true',
          interval: 1000,
          ignored: [
            /(^|[\\/])target([\\/]|$)/,
            /(^|[\\/])\.git([\\/]|$)/,
            /(^|[\\/])dist([\\/]|$)/,
            /(^|[\\/])crates([\\/]|$)/,
            /(^|[\\/])\.sqlx([\\/]|$)/,
            /(^|[\\/])coverage([\\/]|$)/,
            /(^|[\\/])\.direnv([\\/]|$)/,
            /(^|[\\/])output([\\/]|$)/,
          ],
        },
        fs: {
          allow: [
            // Allow serving files from the workspace root
            resolve(__dirname, '../..'),
          ],
        },
      },
      preview: {
        port: Number(process.env.PORT || 3000),
        host: '0.0.0.0',
        strictPort: true,
        allowedHosts: true,
        cors: true,
      },
    };
  };
};

function getAssetsPath(mode: string, command: string): string {
  switch (mode) {
    case 'development':
      return command === 'serve' ? '/local' : '/dev';
    case 'staging':
      return '/staging';
    default:
      return '/';
  }
}

function defineEnv(mode: string, command: string) {
  // `vite build` compiles DEV from NODE_ENV, not MODE. Local-backend static
  // bundles already set VITE_LOCAL_BACKEND_ORIGIN (stack up);
  // keep DEV so those artifacts match `just run_local` (vite serve). Hosted
  // `just build-dev` does not set the origin, so DEV stays false.
  const keepDev = keepImportMetaDev({
    command,
    mode,
    localBackendOrigin: process.env.VITE_LOCAL_BACKEND_ORIGIN,
  });
  return {
    'import.meta.env.__APP_VERSION__': JSON.stringify(appVersion),
    'import.meta.env.ASSETS_PATH': JSON.stringify(getAssetsPath(mode, command)),
    'import.meta.env.__LOCAL_DOCKER__': process.env.LOCAL_DOCKER === 'true',
    'import.meta.env.__LOCAL_JWT__': JSON.stringify(process.env.LOCAL_JWT),
    'import.meta.env.__GIT_BRANCH__': JSON.stringify(
      command === 'serve' ? readGitBranch() : ''
    ),
    ...(keepDev
      ? {
          'import.meta.env.DEV': true,
          'import.meta.env.PROD': false,
        }
      : {}),
  };
}
