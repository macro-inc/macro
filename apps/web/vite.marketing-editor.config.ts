/**
 * Build config for the marketing live-editor demo.
 *
 * Produces the bundle that solid-site serves at /live-editor/ and embeds in an
 * iframe on the /documents page. The site repo holds only the output; this file
 * and src/marketing-editor/ are the source.
 *
 * Build:
 *   cd apps/web && bunx vite build --config vite.marketing-editor.config.ts
 *
 * Then copy the result over the site's copy:
 *   rm -rf <solid-site>/public/live-editor
 *   cp -R apps/web/dist-marketing-editor <solid-site>/public/live-editor
 *
 * It layers onto createAppViteConfig() rather than redefining anything: that is
 * where solid(), wasm(), tailwind(), solidSvg() and — critically — the
 * tsconfigPaths plugin live, and MarkdownShell reaches through roughly thirty
 * of those aliases (@core/*, @ui, @service-*). Rebuilding that alias table here
 * would drift the moment tsconfig.json changed.
 */
import { basename, resolve } from 'node:path';
import { defineConfig, mergeConfig, type Plugin, type UserConfig } from 'vite';
import { createAppViteConfig } from './vite.base.ts';

const OUT_DIR = 'dist-marketing-editor';
const STUBS = resolve(import.meta.dirname, 'src/marketing-editor/stubs');

/**
 * App modules the demo replaces wholesale.
 *
 * Matched on the RESOLVED path rather than the import specifier, because these
 * are reached both through aliases (`@core/context/user`) and through relative
 * imports from their neighbours (`./user` from context/channels.ts). An alias
 * table only sees the specifier and would miss the second kind.
 *
 * Keep this list as short as it can be — every entry is a place where the demo
 * stops being the real editor.
 */
const MODULE_STUBS: { match: string; stub: string; why: string }[] = [
  {
    match: 'src/lib/core/context/user',
    stub: `${STUBS}/user.ts`,
    why: 'Provider builds its value from useUserInfoQuery; no query client or session here.',
  },
  {
    match: 'src/lib/service-clients/service-connection/websocket',
    stub: `${STUBS}/serviceConnectionWebsocket.ts`,
    why: 'Builds a self-connecting socket at module scope and calls fetchToken() on the way up — the /jwt/refresh retry loop. Reached via MentionsMenu -> mentionsUtils -> bulkUpload.',
  },
  {
    match: 'src/lib/service-clients/service-storage/websocket',
    stub: `${STUBS}/serviceStorageWebsocket.ts`,
    why: 'Same pattern, reached via @core/util/upload. Uploads need a bucket the demo has no credentials for.',
  },
  {
    match: 'src/lib/core/context/emailLinks',
    stub: `${STUBS}/emailLinks.ts`,
    why: "Provider builds its value from useEmailLinksQuery; same missing session as context/user. Reached through UserIcon when the @ menu renders a person row, which is why an unstubbed @ menu opened and then threw on the way up.",
  },
  {
    match: 'src/lib/analytics/analytics',
    stub: `${STUBS}/analytics.ts`,
    why: 'createAnalytics() runs at module scope and boots PostHog, GTM and the Meta pixel inside the marketing iframe, which runs its own analytics.',
  },
];

function stubAppModules(): Plugin {
  return {
    name: 'marketing-editor-stub-app-modules',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source.includes('/marketing-editor/stubs/')) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved) return null;
      const normalized = resolved.id.replace(/\\/g, '/').replace(/\.[jt]sx?$/, '');
      const hit = MODULE_STUBS.find((entry) => normalized.endsWith(entry.match));
      return hit ? hit.stub : null;
    },
  };
}

export default defineConfig(async (env) => {
  const base = (await createAppViteConfig()(env)) as UserConfig;

  return mergeConfig(base, {
    // The site serves the bundle from /live-editor/, so every emitted asset URL
    // has to be prefixed with it. createAppViteConfig uses '/app' for the real
    // app build, which would 404 here.
    base: '/live-editor/',
    // The app's publicDir is copied wholesale into outDir, which put ~1.4MB of
    // app-only files (sounds/, dev/, local/, avatar pngs) into a bundle that is
    // committed to the site repo. Nothing in the editor's graph references any
    // of it — there are no absolute-URL asset references in the app's CSS — so
    // the demo opts out entirely.
    publicDir: false,
    build: {
      outDir: OUT_DIR,
      emptyOutDir: true,
      // The output is committed into the site repo, and maps for this graph run
      // to ~59MB across 349 files — several times the bundle itself. The source
      // lives here, so debug against this app rather than the shipped copy.
      sourcemap: false,
      rollupOptions: {
        input: resolve(import.meta.dirname, 'marketing-editor.html'),
      },
    },
    plugins: [
      stubAppModules(),
      {
        // Vite names the output after the input HTML, so the built file lands
        // as marketing-editor.html. The site expects /live-editor/index.html,
        // and renaming here keeps the copy step a plain directory copy.
        name: 'marketing-editor-html-as-index',
        enforce: 'post' as const,
        generateBundle(_options: unknown, bundle: Record<string, { fileName: string }>) {
          for (const chunk of Object.values(bundle)) {
            if (basename(chunk.fileName) === 'marketing-editor.html') {
              chunk.fileName = chunk.fileName.replace(/marketing-editor\.html$/, 'index.html');
            }
          }
        },
      },
    ],
  } satisfies UserConfig);
});
