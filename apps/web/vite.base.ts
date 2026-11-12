import { exec, execSync } from 'node:child_process';
import { unwatchFile, watchFile } from 'node:fs';
import { resolve } from 'node:path';
import tailwind from '@tailwindcss/vite';
import { Features } from 'lightningcss';
import type { Plugin, Rolldown, UserConfigFn } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigpaths from 'vite-tsconfig-paths';
// @ts-ignore
import { browserslist, version } from './package.json';
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
 * Orval's generated schemas are top-level `zod.object(...)` chains. The
 * bundler cannot prove those calls are side-effect free, so every schema (≈700
 * for the storage service alone) stayed in the entry chunk and was constructed
 * at startup, used or not. Annotating each one pure lets the bundler drop the
 * unused ones; the annotation is applied at build time so regenerated files keep it.
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
 *
 * Rolldown emits each map as a `<chunk>.map` asset and none for a chunk that
 * renders no source code: a facade that only re-exports another chunk, or its
 * own runtime and Vite's preload polyfill (virtual `\0` modules). Those have
 * no frames to symbolicate, so only a chunk with source code needs a map.
 */
function posthogSourceMapLimit(): Plugin {
  const limitBytes = 25_000_000;
  const rendersSource = (chunk: Rolldown.OutputChunk) =>
    Object.entries(chunk.modules).some(
      ([id, module]) => !id.startsWith('\0') && module.renderedLength > 0
    );
  return {
    name: 'posthog-source-map-limit',
    apply: 'build',
    generateBundle(_options, bundle) {
      const problems = Object.values(bundle).flatMap((file) => {
        if (file.type === 'chunk') {
          const mapped =
            bundle[`${file.fileName}.map`] !== undefined ||
            !rendersSource(file);
          return mapped ? [] : [`${file.fileName} has no source map`];
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

/**
 * A chain of chunks the entries load statically that leads back to its start,
 * or undefined. In such a cycle a module can read a binding of another before
 * it is initialized. Dynamic imports are left out: one cannot close a cycle
 * among chunks the entries load statically. Cycles among lazy chunks alone are
 * not checked.
 */
export function startupChunkCycle(
  chunks: readonly Pick<
    Rolldown.OutputChunk,
    'fileName' | 'imports' | 'isEntry'
  >[]
): string[] | undefined {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const finished = new Set<string>();
  for (const entry of chunks) {
    if (!entry.isEntry || finished.has(entry.fileName)) continue;
    const path: string[] = [entry.fileName];
    const next: number[] = [0];
    const onPath = new Map([[entry.fileName, 0]]);
    while (path.length > 0) {
      const name = path[path.length - 1];
      const imports = byName.get(name)?.imports ?? [];
      const index = next[next.length - 1];
      if (index >= imports.length) {
        finished.add(name);
        onPath.delete(name);
        path.pop();
        next.pop();
        continue;
      }
      next[next.length - 1] = index + 1;
      const imported = imports[index];
      const open = onPath.get(imported);
      if (open !== undefined) return [...path.slice(open), imported];
      if (finished.has(imported) || !byName.has(imported)) continue;
      onPath.set(imported, path.length);
      path.push(imported);
      next.push(0);
    }
  }
  return undefined;
}

/** Fails the build if startup chunks import each other in a cycle. */
function acyclicStartupChunks(): Plugin {
  return {
    name: 'acyclic-startup-chunks',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(
        (file): file is Rolldown.OutputChunk => file.type === 'chunk'
      );
      const cycle = startupChunkCycle(chunks);
      if (!cycle) return;
      this.error(
        `Startup chunks import each other in a cycle, so a module could read a binding before it is initialized: ${cycle.join(' -> ')}. Check the groups in startupChunks().`
      );
    },
  };
}

const isNodeModule = (id: string) => id.includes('/node_modules/');
const isGeneratedSource = (id: string) =>
  !isNodeModule(id) && /\/generated\//.test(id);

/** The startup chunk a module moves to, and the group that captures it. */
type StartupPart = { name: string; rank: number };

/**
 * Module code per startup chunk, before minification. Smaller chunks start the
 * app sooner: Chrome compiles each one as it arrives while later ones
 * download, and V8 re-parses a whole chunk on the main thread the first time
 * code in it builds a stack trace, which some libraries do as they load.
 * 800 KB parts beat 2 MB parts on a slow CPU, and both beat one chunk per kind.
 * A single module, or modules that import each other in a cycle, stay in one
 * chunk however large, such as the generated GraphQL client.
 */
export const STARTUP_PART_CODE_BYTES = 800_000;
/** Groups available to startup chunks; the plan fails the build if it needs more. */
const STARTUP_PART_GROUPS = 48;

/** A module being visited and the next of its imports to visit. */
type ImportFrame = { id: string; imports: readonly string[]; next: number };

/**
 * Positions of modules in an order where every module comes after the modules
 * it imports. Modules that import each other in a cycle share one position.
 * This is Tarjan's strongly connected components algorithm, which finishes a
 * component only after every component it reaches. It keeps its own stack so
 * a long import chain cannot overflow the call stack.
 */
export function dependencyFirstPositions(
  ids: Iterable<string>,
  importsOf: (id: string) => readonly string[]
): Map<string, number> {
  const visitIndex = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const open = new Set<string>();
  const openStack: string[] = [];
  const positions = new Map<string, number>();
  let visited = 0;

  for (const root of ids) {
    if (visitIndex.has(root)) continue;
    const frames: ImportFrame[] = [];
    const enter = (id: string) => {
      visitIndex.set(id, visited);
      lowLink.set(id, visited);
      visited += 1;
      openStack.push(id);
      open.add(id);
      frames.push({ id, imports: importsOf(id), next: 0 });
    };
    const lower = (id: string, value: number | undefined) => {
      if (value !== undefined && value < (lowLink.get(id) ?? value)) {
        lowLink.set(id, value);
      }
    };

    enter(root);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.next < frame.imports.length) {
        const imported = frame.imports[frame.next];
        frame.next += 1;
        if (!visitIndex.has(imported)) enter(imported);
        else if (open.has(imported)) lower(frame.id, visitIndex.get(imported));
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) lower(parent.id, lowLink.get(frame.id));
      if (lowLink.get(frame.id) !== visitIndex.get(frame.id)) continue;

      const position = positions.size;
      let member = openStack.pop();
      while (member !== undefined) {
        open.delete(member);
        positions.set(member, position);
        if (member === frame.id) break;
        member = openStack.pop();
      }
    }
  }
  return positions;
}

/**
 * Cuts modules sorted by dependency-first position into parts of at least
 * STARTUP_PART_CODE_BYTES of code (the last part may be smaller), never
 * between modules that share a position because they import each other.
 */
export function cutIntoParts(
  ids: readonly string[],
  positionOf: (id: string) => number,
  bytesOf: (id: string) => number
): string[][] {
  const parts: string[][] = [[]];
  let partBytes = 0;
  for (const [index, id] of ids.entries()) {
    const startsComponent =
      index === 0 || positionOf(ids[index - 1]) !== positionOf(id);
    if (partBytes >= STARTUP_PART_CODE_BYTES && startsComponent) {
      parts.push([]);
      partBytes = 0;
    }
    parts[parts.length - 1].push(id);
    partBytes += bytesOf(id);
  }
  return parts;
}

/**
 * Splits the code the HTML entries load at startup into chunks of about
 * STARTUP_PART_CODE_BYTES of module code, so each source map stays well under
 * PostHog's limit (one map with every startup module was 44 MB, most of it
 * library code and the embedded text of generated API clients), startup stays
 * fast, and index.html preloads a known set of files.
 * Left alone, Rolldown splits startup code that lazy chunks also import into
 * hundreds of small chunks, and index.html preloads every one.
 *
 * Only modules an entry already imports statically move, so startup loads the
 * same code and lazy code stays lazy:
 * - libraries go to `vendor-<n>`;
 * - generated API modules go to `api-schemas-<n>`, but only if they import
 *   nothing but libraries and other generated modules;
 * - the rest of the app's code goes to `startup-<entries>-<n>` for the set of
 *   entries that loads it, except the modules an entry imports directly, which
 *   stay in its entry chunk.
 *
 * Chunks must never import each other in a cycle, or a module could read a
 * binding before it is initialized. Each kind's modules are cut into parts
 * along an order where a module follows everything it imports, and each part
 * gets its own group: parts earlier in that order, libraries, and code for more
 * entries (a module's static imports load with at least the same entries) get
 * a higher priority. A group also captures the not yet captured modules its
 * modules import, so a chunk only ever imports chunks captured before it.
 * (Rolldown's own `maxSize` splits a group without that order and its parts
 * import each other in cycles.)
 */
function startupChunks(
  entries: Record<string, string>
): Rolldown.CodeSplittingOptions {
  const entryIds = new Set(Object.values(entries));
  const entryCount = entryIds.size;
  const planChunks = (
    context: Rolldown.ChunkingContext
  ): Map<string, StartupPart> => {
    const imports = (id: string) =>
      context.getModuleInfo(id)?.importedIds ?? [];
    const loadedBy = new Map<string, string[]>();
    const direct = new Set<string>();
    for (const [entry, entryId] of Object.entries(entries)) {
      for (const id of imports(entryId)) direct.add(id);
      const seen = new Set<string>();
      const pending = [entryId];
      for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
        if (seen.has(id)) continue;
        seen.add(id);
        loadedBy.set(id, [...(loadedBy.get(id) ?? []), entry]);
        pending.push(...imports(id));
      }
    }

    const schemas = new Set([...loadedBy.keys()].filter(isGeneratedSource));
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

    // Each moving module's kind, ranked so a kind only imports earlier kinds.
    const kinds = new Map<string, { order: number; ids: string[] }>();
    const addToKind = (kind: string, order: number, id: string) => {
      const members = kinds.get(kind) ?? { order, ids: [] };
      members.ids.push(id);
      kinds.set(kind, members);
    };
    for (const [id, loaders] of loadedBy) {
      if (isNodeModule(id)) addToKind('vendor', 0, id);
      else if (schemas.has(id)) addToKind('api-schemas', 1, id);
      else if (!entryIds.has(id) && !direct.has(id)) {
        addToKind(
          `startup-${loaders.join('-')}`,
          2 + entryCount - loaders.length,
          id
        );
      }
    }

    // Cut each kind into parts along the import order, never inside a cycle.
    const positions = dependencyFirstPositions(loadedBy.keys(), (id) =>
      imports(id).filter((imported) => loadedBy.has(imported))
    );
    const positionOf = (id: string) => positions.get(id) ?? 0;
    const plan = new Map<string, StartupPart>();
    let rank = 0;
    const ordered = [...kinds].sort(([, a], [, b]) => a.order - b.order);
    for (const [kind, { ids }] of ordered) {
      ids.sort((a, b) => positionOf(a) - positionOf(b));
      const parts = cutIntoParts(
        ids,
        positionOf,
        (id) => context.getModuleInfo(id)?.code?.length ?? 0
      );
      for (const [index, part] of parts.entries()) {
        const name = parts.length === 1 ? kind : `${kind}-${index + 1}`;
        for (const id of part) plan.set(id, { name, rank });
        rank += 1;
      }
    }
    if (rank > STARTUP_PART_GROUPS) {
      throw new Error(
        `startupChunks() planned ${rank} startup chunks but has ${STARTUP_PART_GROUPS} groups; raise STARTUP_PART_GROUPS or STARTUP_PART_CODE_BYTES.`
      );
    }
    return plan;
  };
  // Rolldown reuses one context for every call of a chunking pass.
  const plans = new WeakMap<
    Rolldown.ChunkingContext,
    Map<string, StartupPart>
  >();
  const planFor = (context: Rolldown.ChunkingContext) => {
    let plan = plans.get(context);
    if (!plan) {
      plan = planChunks(context);
      plans.set(context, plan);
    }
    return plan;
  };
  return {
    groups: Array.from(
      { length: STARTUP_PART_GROUPS },
      (_, rank): Rolldown.CodeSplittingGroup => ({
        debugName: `startup chunk ${rank + 1}`,
        name: (id, context) => {
          const part = planFor(context).get(id);
          return part?.rank === rank ? part.name : null;
        },
        tags: ['$initial'],
        priority: STARTUP_PART_GROUPS - rank,
        // Rolldown's default, spelled out: the group also takes the modules its
        // modules import that no group claimed, such as Vite's preload helper.
        // acyclicStartupChunks() checks on every build that startup chunks
        // still import each other in one direction.
        includeDependenciesRecursively: true,
      })
    ),
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

const ESBUILD_BROWSERS: Record<string, string> = {
  safari: 'safari',
  ios_saf: 'ios',
  chrome: 'chrome',
  and_chr: 'chrome',
  edge: 'edge',
  firefox: 'firefox',
};

/** Converts the `browser >= version` floors in package.json `browserslist` to esbuild targets. */
function esbuildTargets(queries: readonly string[]): string[] {
  return queries.map((query) => {
    const match = /^(\w+) >= (\d+(?:\.\d+)?)$/.exec(query);
    const browser = match ? ESBUILD_BROWSERS[match[1]] : undefined;
    if (!match || !browser) {
      throw new Error(`Unsupported browserslist query for esbuild: ${query}`);
    }
    return `${browser}${match[2]}`;
  });
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

/** The app's pages; each loads its own startup code (see startupChunks). */
const HTML_ENTRIES = {
  app: resolve(__dirname, 'index.html'),
  pipedreamConnect: resolve(__dirname, 'pipedream-connect.html'),
  canvasRender: resolve(__dirname, 'canvas-render.html'),
};

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
        acyclicStartupChunks(),
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
        rolldownOptions: {
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
        target: esbuildTargets(browserslist),
        outDir: 'dist',
        emptyOutDir: true,
        minify: !NO_MINIFY,
        // The gzip-size console report re-compresses every chunk, adding ~20 s
        // to each build; nothing reads it.
        reportCompressedSize: false,
        rolldownOptions: {
          input: HTML_ENTRIES,
          // KaTeX and PDF.js are now reachable through lazy boundaries. Let
          // Rolldown place them naturally; forcing lazy code into named chunks
          // hoists shared CommonJS helpers into those chunks and makes the
          // entry preload otherwise-lazy code.
          output: NO_MINIFY
            ? {
                // remove hashes from output paths
                // https://github.com/vitejs/vite/issues/378
                entryFileNames: `assets/[name].js`,
                chunkFileNames: `assets/[name].js`,
                assetFileNames: `assets/[name].[ext]`,
                codeSplitting: startupChunks(HTML_ENTRIES),
              }
            : {
                format: 'es',
                chunkFileNames: '[name]-[hash].js',
                entryFileNames: '[name]-[hash].js',
                codeSplitting: startupChunks(HTML_ENTRIES),
              },
        },
        assetsInlineLimit: (filePath) => {
          if (filePath.includes('.wasm')) return false;
          if (filePath.includes('/lok/')) return false;
        },
        sourcemap: true,
      },
      oxc: {
        jsx: {
          runtime: 'automatic',
          importSource: 'solid-js',
        },
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
        // loro-crdt is a wasm singleton. The app imports it directly (the dep
        // optimizer pre-bundles a copy) while the linked `@loro-mirror/core` workspace
        // source imports it through vite-plugin-wasm — two module evaluations,
        // two wasm memories. A LoroDoc from one instance handed to a Mirror on
        // the other yields cross-instance container handles → `index out of
        // bounds` panics in dev only. Excluding it from pre-bundling collapses
        // everyone onto the single plugin-handled instance.
        exclude: ['loro-crdt'],
        rolldownOptions: {
          transform: {
            target: 'esnext',
          },
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
