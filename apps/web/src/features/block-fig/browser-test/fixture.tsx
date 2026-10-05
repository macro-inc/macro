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
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { FigOpening } from '../components/fig-opening';
import { FigViewerProvider } from '../context/fig-viewer-context';
import type { FigCommentAnchor, FigPerson } from '../core/comments';
import { FigViewer } from '../views/fig-viewer';
import { CollabFixture, type FixturePerson } from './collab-fixture';
import { fixtureFontSource } from './font-source';
import { createMemoryComments, FIXTURE_PEOPLE } from './memory-comments';

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
      collab?: { people: () => FixturePerson[] };
      /** The in-memory comments. */
      comments: {
        threads: () => unknown[];
        /** Someone else comments (a reply, or a new thread). */
        arrive: (
          author: FigPerson,
          text: string,
          target: { threadId: string } | { anchor: FigCommentAnchor }
        ) => string;
        /** Mentions that would have notified someone. */
        notified: () => { to: string; threadId: string }[];
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
  const editable = params.has('edit') || params.has('new');
  const comments = createMemoryComments();

  const fonts = fixtureFontSource();
  window.figFixture = {
    engine,
    errors,
    notices,
    downloads,
    saves,
    comments: {
      threads: comments.store.threads,
      arrive: comments.arrive,
      notified: comments.notified,
      people: FIXTURE_PEOPLE,
    },
    fontRequests: fonts.requests,
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
          {(bytes) => <FigOpening bytes={bytes} />}
        </Show>
        <Show when={engine()} keyed>
          {(e) => (
            <FigViewerProvider
              context={{
                engine: e,
                fileName: name,
                download: (blob, n) =>
                  setDownloads((d) => [...d, { name: n, size: blob.size }]),
                notifyError: (m) => setErrors((x) => [...x, m]),
                notifyInfo: (m) => setNotices((x) => [...x, m]),
                canEdit: () => editable,
                fileKey: file ?? 'new',
                comments: comments.store,
                frameLink: (frame) => {
                  const url = new URL(location.href);
                  url.searchParams.set('present', frame);
                  return url.toString();
                },
                presentAt: params.get('present') ?? undefined,
                fonts,
                save: async (bytes) => {
                  if (params.has('reload'))
                    await FigEngine.open(bytes.slice().buffer).then((e) =>
                      e.close()
                    );
                  setSaves((x) => [...x, bytes]);
                },
              }}
            >
              <FigViewer />
            </FigViewerProvider>
          )}
        </Show>
      </main>
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root') as HTMLElement);
