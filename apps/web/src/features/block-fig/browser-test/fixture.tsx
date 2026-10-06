/**
 * Mounts the real `.fig` viewer (wasm engine in its workers) without the
 * app: no authentication, routes, or document storage. `?file=<name>` opens
 * a file from the fixture corpus, `?new` a blank design; the header also
 * opens a local file. `?edit` makes it editable, with saves kept in memory
 * (`?reload` reopens each save, checking it round-trips). Comments stay in
 * memory; `?present=<frame id>` opens presenting that frame, as a copied
 * frame link does.
 * `window.figFixture` exposes the engine, saves, and reported messages.
 */

import '@fontsource-variable/inter';
import '../../../index.css';
import { FigEngine } from '@core/fig-engine/client';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { FigOpening } from '../components/fig-opening';
import { FigViewerProvider } from '../context/fig-viewer-context';
import type { FigCommentAnchor, FigPerson } from '../core/comments';
import { createFontSource } from '../queries/font-source';
import { FigViewer } from '../views/fig-viewer';
import { CollabFixture, type FixtureCollab } from './collab-fixture';
import { fixtureFontSource } from './font-source';
import { createMemoryComments, FIXTURE_PEOPLE } from './memory-comments';
import {
  createMemoryLibraries,
  type MemoryLibraries,
} from './memory-libraries';

declare const __FIG_CORPUS_URL__: string;

declare global {
  interface Window {
    figFixture: {
      engine: () => FigEngine | undefined;
      errors: () => string[];
      notices: () => string[];
      downloads: () => { name: string; size: number }[];
      /** Every saved file, oldest first. */
      saves: () => Uint8Array[];
      /** Font stylesheets and files the viewer asked for. */
      fontRequests: () => string[];
      /** With `?collab`: the people editing together. */
      collab?: FixtureCollab;
      /** With `?libraries`: the designs in memory, and opening one. */
      libraries?: {
        open: (id: string) => Promise<void>;
        current: () => string | undefined;
        /** Times a design was read as a library. */
        reads: (id: string) => number;
      };
      /** The in-memory comments. */
      comments: {
        threads: () => unknown[];
        /** Someone else comments (a reply, or a new thread). */
        arrive: (
          author: FigPerson,
          text: string,
          target: { threadId: string } | { anchor: FigCommentAnchor }
        ) => string;
        /** Opens a thread, as following a comment link does. */
        follow: (threadId: string) => void;
        people: FigPerson[];
      };
    };
  }
}

function Fixture() {
  const params = new URLSearchParams(location.search);
  const [engine, setEngine] = createSignal<FigEngine>();
  const [error, setError] = createSignal<string>();
  const [name, setName] = createSignal('Design');
  const [errors, setErrors] = createSignal<string[]>([]);
  const [notices, setNotices] = createSignal<string[]>([]);
  const [downloads, setDownloads] = createSignal<
    { name: string; size: number }[]
  >([]);
  const [saves, setSaves] = createSignal<Uint8Array[]>([]);
  const [opening, setOpening] = createSignal<ArrayBuffer>();
  const editable =
    params.has('edit') || params.has('new') || params.has('libraries');
  const [memory, setMemory] = createSignal<MemoryLibraries>();
  const [current, setCurrent] = createSignal<string>();
  const comments = createMemoryComments();

  const fixtureFonts = fixtureFontSource();
  const fonts = params.has('realFonts') ? createFontSource() : fixtureFonts;
  window.figFixture = {
    engine,
    errors,
    notices,
    downloads,
    saves,
    comments: {
      threads: comments.store.threads,
      arrive: comments.arrive,
      follow: comments.follow,
      people: FIXTURE_PEOPLE,
    },
    fontRequests: fixtureFonts.requests,
  };

  // Several people on one design, side by side (`?collab&people=a,b`).
  if (params.has('collab')) {
    const users = (params.get('people') ?? 'alice,bob')
      .split(',')
      .map((n) => `macro|${n}@example.com`);
    return (
      <div class="flex h-screen flex-col bg-page text-ink">
        <CollabFixture
          fileUrl={`${__FIG_CORPUS_URL__}${params.get('file') ?? 'showcase.fig'}`}
          users={users}
        />
      </div>
    );
  }

  const open = async (bytes: ArrayBuffer, fileName: string) => {
    engine()?.close();
    setEngine(undefined);
    setError(undefined);
    setName(fileName.replace(/\.fig$/, ''));
    setOpening(bytes);
    try {
      const started = performance.now();
      const e = await FigEngine.open(bytes);
      console.info(
        `[fig-fixture] opened ${fileName} in ${Math.round(performance.now() - started)}ms`
      );
      setEngine(e);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setOpening(undefined);
  };

  // Team libraries (`?libraries`): a library design and a design using it,
  // in memory, opened one at a time.
  const openDesign = async (id: string) => {
    const m = memory();
    const bytes = m?.bytes(id);
    const doc = m?.documents().find((d) => d.id === id);
    if (!bytes || !doc) return;
    setCurrent(id);
    await open(bytes, doc.name);
  };
  if (params.has('libraries')) {
    window.figFixture.libraries = {
      open: openDesign,
      current,
      reads: (id) => memory()?.reads(id) ?? 0,
    };
    const library = params.get('library') ?? 'design-system.fig';
    void Promise.all([
      fetch(`${__FIG_CORPUS_URL__}${library}`).then((r) => r.arrayBuffer()),
      FigEngine.blank('App'),
    ])
      .then(([lib, app]) => {
        setMemory(
          createMemoryLibraries([
            { id: 'design-system', name: 'Design system', bytes: lib },
            { id: 'app', name: 'App', bytes: app.slice().buffer },
          ])
        );
        return openDesign(params.get('open') ?? 'design-system');
      })
      .catch((e: unknown) => setError(String(e)));
  }

  const file = params.get('file');
  if (params.has('new')) {
    void FigEngine.blank('Untitled')
      .then((bytes) => open(bytes.slice().buffer, 'Untitled'))
      .catch((e: unknown) => setError(String(e)));
  } else if (file) {
    void fetch(`${__FIG_CORPUS_URL__}${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${file}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((bytes) => open(bytes, file))
      .catch((e: unknown) => setError(String(e)));
  }

  return (
    <div class="flex h-screen flex-col bg-page text-ink">
      <header class="flex h-10 shrink-0 items-center gap-3 border-edge-muted border-b px-3 text-sm">
        <strong>{name()}</strong>
        <Show when={memory()}>
          {(m) => (
            <For each={m().documents()}>
              {(d) => (
                <button
                  type="button"
                  class="rounded border border-edge-muted px-2 text-ink-muted hover:text-ink"
                  data-testid={`fig-fixture-open-${d.id}`}
                  disabled={current() === d.id}
                  onClick={() => void openDesign(d.id)}
                >
                  {d.name}
                </button>
              )}
            </For>
          )}
        </Show>
        <label class="text-ink-muted">
          Open .fig{' '}
          <input
            type="file"
            accept=".fig"
            data-testid="fig-file-input"
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              if (f) await open(await f.arrayBuffer(), f.name);
            }}
          />
        </label>
      </header>
      <main class="min-h-0 flex-1">
        <Show when={error()}>
          {(message) => (
            <div class="p-6 text-failure" data-testid="fig-fixture-error">
              {message()}
            </div>
          )}
        </Show>
        <Show when={opening()} keyed>
          <FigOpening />
        </Show>
        <Show when={engine()} keyed>
          {(e) => {
            // The design this viewer shows (saves go to it after a switch).
            const design = current();
            const store = memory();
            return (
              <FigViewerProvider
                context={{
                  engine: e,
                  fileName: name,
                  download: (blob, n) =>
                    setDownloads((d) => [...d, { name: n, size: blob.size }]),
                  notifyError: (m) => setErrors((x) => [...x, m]),
                  notifyInfo: (m) => setNotices((x) => [...x, m]),
                  canEdit: () => editable,
                  fileKey: design ?? file ?? 'new',
                  comments: comments.store,
                  frameLink: (frame) => {
                    const url = new URL(location.href);
                    url.searchParams.set('present', frame);
                    return url.toString();
                  },
                  presentAt: params.get('present') ?? undefined,
                  fonts,
                  libraries: design && store ? store.source(design) : undefined,
                  save: async (bytes) => {
                    if (params.has('reload'))
                      await FigEngine.open(bytes.slice().buffer).then((e) =>
                        e.close()
                      );
                    if (design) store?.store(design, bytes);
                    setSaves((x) => [...x, bytes]);
                  },
                }}
              >
                <FigViewer />
              </FigViewerProvider>
            );
          }}
        </Show>
      </main>
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root') as HTMLElement);
