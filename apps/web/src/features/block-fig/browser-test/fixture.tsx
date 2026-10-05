/**
 * Mounts the real `.fig` viewer (wasm engine in its workers) without the
 * app: no authentication, routes, or document storage. `?file=<name>` opens
 * a file from the fixture corpus, `?new` a blank design; the header also
 * opens a local file. `?edit` makes it editable, with saves kept in memory
 * (`?reload` reopens each save, checking it round-trips).
 * `window.figFixture` exposes the engine, saves, and reported messages.
 */

import '@fontsource-variable/inter';
import '../../../index.css';
import { FigEngine } from '@core/fig-engine/client';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { FigViewerProvider } from '../context/fig-viewer-context';
import { FigViewer } from '../views/fig-viewer';

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
  const editable = params.has('edit') || params.has('new');

  window.figFixture = {
    engine,
    errors,
    notices,
    downloads,
    saves,
  };

  const open = async (bytes: ArrayBuffer, fileName: string) => {
    engine()?.close();
    setEngine(undefined);
    setError(undefined);
    setName(fileName.replace(/\.fig$/, ''));
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
