import { exec, execSync } from 'node:child_process';
import { unwatchFile, watchFile } from 'node:fs';
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
import { devHttps } from './scripts/dev-https';
import { hostedDevProxy } from './scripts/hosted-dev-proxy';
import { keepImportMetaDev } from './scripts/keep-import-meta-dev';
import { localDevServer } from './scripts/local-dev-server';

function readShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

const shortSha = readShortSha();
const appVersion = `${version}+${shortSha}`;
/** Orders builds: a newer build takes the local cache over from older tabs. */
const appBuildTime = Date.now();

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

/**
 * Orval's generated schemas are top-level `zod.object(...)` chains. Rollup
 * cannot prove those calls are side-effect free, so every schema (≈700 for the
 * storage service alone) stayed in the entry chunk and was constructed at
 * startup, used or not. Annotating each one pure lets Rollup drop the unused
 * ones; the annotation is applied at build time so regenerated files keep it.
 */
function pureGeneratedZodSchemas(): Plugin {
  return {
    name: 'pure-generated-zod-schemas',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]generated[\\/]zod\.ts$/.test(id)) return;
      return {
        code: code.replace(
          /^(export const [\w$]+ = )(zod\b)/gm,
          '$1/* @__PURE__ */ $2'
        ),
        map: null,
      };
    },
  };
}

/**
 * CloudFront compresses responses of at most 10,000,000 bytes and serves
 * anything larger raw. The entry chunk once crossed that limit and every
 * visitor downloaded 11.9 MB uncompressed instead of ~3 MB, so fail the build
 * rather than ship that again. (Cache WASM is precompressed at deploy.)
 */
function cloudFrontCompressionLimit(): Plugin {
  const limitBytes = 10_000_000;
  return {
    name: 'cloudfront-compression-limit',
    apply: 'build',
    generateBundle(_options, bundle) {
      const oversized = Object.values(bundle)
        .filter((file) => /\.(js|css|html|json|svg)$/.test(file.fileName))
        .map((file) => ({
          name: file.fileName,
          bytes:
            file.type === 'chunk'
              ? Buffer.byteLength(file.code)
              : typeof file.source === 'string'
                ? Buffer.byteLength(file.source)
                : file.source.byteLength,
        }))
        .filter((file) => file.bytes > limitBytes);
      if (oversized.length === 0) return;
      this.error(
        `These files exceed CloudFront's ${limitBytes}-byte compression limit and would be served uncompressed: ${oversized
          .map((file) => `${file.name} (${file.bytes} bytes)`)
          .join(', ')}. Split them behind lazy() boundaries.`
      );
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
        devHttps(),
        hostedDevProxy(),
        // solidDevtools({ autoname: true }),
        pureGeneratedZodSchemas(),
        solid(),
        wasm(),
        tailwind(),
        solidSvg({ defaultAsComponent: true }),
        tsconfigpaths({
          root: './',
        }),
        gitBranchHmrPlugin(),
        cloudFrontCompressionLimit(),
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
        // The gzip-size console report re-compresses every chunk, adding ~20 s
        // to each build; nothing reads it.
        reportCompressedSize: false,
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
        include: [
          'vscode-textmate',
          'vscode-oniguruma',
          // 'solid-devtools/setup',
          'libheif-js/wasm-bundle',
          // Prebundle lazy spreadsheet worker dependencies before the first
          // use, which would otherwise reload the page and discard its draft.
          '@ironcalc/wasm',
          'exceljs',
          'fflate',
          'saxes',
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
          // Keep Loro resolution here: tsconfig path aliases cache a versioned
          // URL that goes stale when Vite rebuilds dependencies, splitting the
          // app and workspace packages across separate WASM instances.
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
        ...localDevServer(process.env),
        cors: true,
        watch: {
          usePolling: true,
          interval: 100,
          ignored: /(^|[\\/])target([\\/]|$)/,
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
    'import.meta.env.__APP_BUILD_TIME__': JSON.stringify(appBuildTime),
    'import.meta.env.ASSETS_PATH': JSON.stringify(getAssetsPath(mode, command)),
    // index.html preconnects to the API gateway; keep in sync with servers.ts.
    'import.meta.env.GATEWAY_ORIGIN': JSON.stringify(
      mode === 'development'
        ? 'https://dev-gateway.macro.com'
        : 'https://gateway.macro.com'
    ),
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
