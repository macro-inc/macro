import { exec, execSync } from 'node:child_process';
import { unwatchFile, watchFile } from 'node:fs';
import { resolve } from 'node:path';
import tailwind from '@tailwindcss/vite';
import { Features } from 'lightningcss';
import type { Plugin, Rollup, UserConfigFn } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigpaths from 'vite-tsconfig-paths';
// @ts-ignore
import { version } from './package.json';
import { devCompression } from './scripts/dev-compression';
import { devHttps } from './scripts/dev-https';
import { devExternalSourcemaps } from './scripts/dev-sourcemaps';
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
      const sendBranch = async () => {
        const branch = await readGitBranchAsync();
        server.ws.send({
          type: 'custom',
          event: 'git-branch:update',
          data: branch,
        });
      };
      const emit = () => {
        sendBranch().catch((error) =>
          server.config.logger.error(`git-branch-hmr: ${String(error)}`)
        );
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

/**
 * PostHog symbolicates every platform's stack frames by fetching the public
 * `.map` next to each chunk, and gives up on maps over 25,000,000 bytes. The
 * entry chunk's map once crossed that and every frame in it stayed minified,
 * so fail the build on a missing or oversized map.
 */
function posthogSourceMapLimit(): Plugin {
  const limitBytes = 25_000_000;
  return {
    name: 'posthog-source-map-limit',
    apply: 'build',
    generateBundle(_options, bundle) {
      const problems = Object.values(bundle).flatMap((file) => {
        if (file.type === 'chunk') {
          return file.map ? [] : [`${file.fileName} has no source map`];
        }
        if (!file.fileName.endsWith('.map')) return [];
        const bytes =
          typeof file.source === 'string'
            ? Buffer.byteLength(file.source)
            : file.source.byteLength;
        return bytes > limitBytes ? [`${file.fileName} is ${bytes} bytes`] : [];
      });
      if (problems.length === 0) return;
      this.error(
        `PostHog cannot symbolicate these chunks (source maps are required and must be at most ${limitBytes} bytes): ${problems.join(', ')}. Split the chunk behind lazy() boundaries or in startupChunks().`
      );
    },
  };
}

const isNodeModule = (id: string) => id.includes('/node_modules/');
const isGeneratedSource = (id: string) =>
  !isNodeModule(id) && /\/generated\//.test(id);

/**
 * Splits the entry chunk so each source map stays under PostHog's limit: one
 * map with every startup module was 44 MB, most of it library code and the
 * embedded text of generated API clients.
 *
 * Only modules the entry already imports statically move, so startup loads
 * the same code in three files and lazy code stays lazy. A generated module
 * moves only if it imports nothing but libraries and other generated modules;
 * otherwise the chunks would import each other and could read bindings before
 * they are initialized.
 */
function startupChunks(): Rollup.ManualChunksOption {
  const plans = new WeakMap<Rollup.GetModuleInfo, Map<string, string>>();
  const planChunks = (
    getModuleInfo: Rollup.GetModuleInfo,
    moduleIds: Iterable<string>
  ) => {
    const imports = (id: string) => getModuleInfo(id)?.importedIds ?? [];
    const startup = new Set<string>();
    const pending = [...moduleIds].filter((id) => getModuleInfo(id)?.isEntry);
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      if (startup.has(id)) continue;
      startup.add(id);
      pending.push(...imports(id));
    }
    const schemas = new Set([...startup].filter(isGeneratedSource));
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of schemas) {
        const importsAppCode = imports(id).some(
          (imported) => !isNodeModule(imported) && !schemas.has(imported)
        );
        if (importsAppCode) {
          schemas.delete(id);
          changed = true;
        }
      }
    }
    const plan = new Map<string, string>();
    for (const id of startup) {
      if (isNodeModule(id)) plan.set(id, 'vendor');
      else if (schemas.has(id)) plan.set(id, 'api-schemas');
    }
    return plan;
  };
  return (id, { getModuleInfo, getModuleIds }) => {
    let plan = plans.get(getModuleInfo);
    if (!plan) {
      plan = planChunks(getModuleInfo, getModuleIds());
      plans.set(getModuleInfo, plan);
    }
    return plan.get(id);
  };
}

/**
 * loro-crdt's `browser` export downloads its 3 MB WASM with a synchronous
 * XMLHttpRequest and compiles it on the main thread, freezing startup for the
 * whole download. Builds use the `bundler` export that dev already resolves
 * through the `development` condition: vite-plugin-wasm streams and compiles it
 * off the main thread (htmlPreloads starts its download with the HTML).
 */
function loroAsyncWasm(): Plugin {
  return {
    name: 'loro-async-wasm',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer, options) {
      if (source !== 'loro-crdt') return null;
      return this.resolve('loro-crdt/bundler', importer, {
        ...options,
        skipSelf: true,
      });
    },
  };
}

/** Hashed assets the first screen needs; index.html requests them while it parses. */
const HTML_PRELOADS = [
  // The app waits for Loro to initialize before rendering.
  {
    file: /(^|\/)loro_wasm_bg-[\w-]+\.wasm$/,
    as: 'fetch',
    type: 'application/wasm',
  },
  // The UI font; otherwise it starts downloading only once text renders.
  {
    file: /(^|\/)inter-latin-wght-normal-[\w-]+\.woff2$/,
    as: 'font',
    type: 'font/woff2',
  },
] as const;

/**
 * Adds `<link rel="preload">` for HTML_PRELOADS, so their downloads start with
 * the HTML instead of after the entry runs.
 */
function htmlPreloads(): Plugin {
  let base = '/';
  return {
    name: 'html-preloads',
    apply: 'build',
    configResolved(config) {
      base = config.base.endsWith('/') ? config.base : `${config.base}/`;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {});
        return HTML_PRELOADS.flatMap((preload) => {
          const file = files.find((fileName) => preload.file.test(fileName));
          if (!file) return [];
          return [
            {
              tag: 'link',
              attrs: {
                rel: 'preload',
                href: `${base}${file}`,
                as: preload.as,
                type: preload.type,
                crossorigin: '',
              },
              injectTo: 'head' as const,
            },
          ];
        });
      },
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
        devCompression(),
        devExternalSourcemaps(),
        hostedDevProxy(),
        // solidDevtools({ autoname: true }),
        pureGeneratedZodSchemas(),
        solid(),
        wasm(),
        loroAsyncWasm(),
        htmlPreloads(),
        tailwind(),
        solidSvg({ defaultAsComponent: true }),
        tsconfigpaths({
          root: './',
        }),
        gitBranchHmrPlugin(),
        cloudFrontCompressionLimit(),
        posthogSourceMapLimit(),
      ],
      define: defineEnv(ENV_MODE, command),
      clearScreen: false,
      worker: {
        format: 'es',
        plugins: () => [
          tsconfigpaths({
            root: './',
          }),
          posthogSourceMapLimit(),
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
            pipedreamConnect: resolve(__dirname, 'pipedream-connect.html'),
            canvasRender: resolve(__dirname, 'canvas-render.html'),
          },
          // KaTeX and PDF.js are now reachable through lazy boundaries. Let
          // Rollup place them naturally; forcing lazy code into named chunks
          // hoists shared CommonJS helpers into those chunks and makes the
          // entry preload otherwise-lazy code.
          output: NO_MINIFY
            ? {
                // remove hashes from output paths
                // https://github.com/vitejs/vite/issues/378
                entryFileNames: `assets/[name].js`,
                chunkFileNames: `assets/[name].js`,
                assetFileNames: `assets/[name].[ext]`,
                manualChunks: startupChunks(),
              }
            : {
                format: 'es',
                chunkFileNames: '[name]-[hash].js',
                entryFileNames: '[name]-[hash].js',
                manualChunks: startupChunks(),
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
