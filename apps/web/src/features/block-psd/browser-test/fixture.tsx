/**
 * Mounts the real Photoshop editor (wasm engine in its worker) without the
 * app: no authentication, routes, or document storage. `?new` opens a new
 * 1920 × 1080 document (`&size=800x600` another size), `?file=<name>` a file
 * from `PSD_CORPUS_DIR`; the header also opens a local file. Saves stay in
 * memory (`?reload` reopens each one, checking it round-trips) and
 * `?readonly` opens without editing. `?collab` opens several people on one
 * document side by side. `window.psdFixture` exposes the engine, saves,
 * downloads, and reported messages.
 */

import '@fontsource-variable/inter';
import '../../../index.css';
import { PsdEngine } from '@core/psd-engine/client';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { PsdEditorProvider } from '../context/psd-editor-context';
import { PsdEditor } from '../views/psd-editor';
import { CollabFixture, type FixtureCollab } from './collab-fixture';

declare const __PSD_CORPUS_URL__: string;

declare global {
  interface Window {
    psdFixture: {
      engine: () => PsdEngine | undefined;
      errors: () => string[];
      notices: () => string[];
      downloads: () => { name: string; size: number }[];
      /** Every saved file, oldest first. */
      saves: () => Uint8Array[];
      /** With `?collab`: the people editing together. */
      collab?: FixtureCollab;
    };
  }
}

/** The size of a new document, as the app creates one. */
const NEW_DOCUMENT = { width: 1920, height: 1080 };

function sizeParam(value: string | null) {
  const m = value?.match(/^(\d+)x(\d+)$/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : NEW_DOCUMENT;
}

function Fixture() {
  const params = new URLSearchParams(location.search);
  const [engine, setEngine] = createSignal<PsdEngine>();
  const [error, setError] = createSignal<string>();
  const [name, setName] = createSignal('Untitled');
  const [errors, setErrors] = createSignal<string[]>([]);
  const [notices, setNotices] = createSignal<string[]>([]);
  const [downloads, setDownloads] = createSignal<
    { name: string; size: number }[]
  >([]);
  const [saves, setSaves] = createSignal<Uint8Array[]>([]);
  const editable = !params.has('readonly');

  window.psdFixture = { engine, errors, notices, downloads, saves };

  // Several people on one document, side by side (`?collab&people=a,b`).
  if (params.has('collab')) {
    const users = (params.get('people') ?? 'alice,bob')
      .split(',')
      .map((n) => `macro|${n}@example.com`);
    const file = params.get('file');
    return (
      <div class="flex h-screen flex-col bg-page text-ink">
        <CollabFixture
          fileUrl={file ? `${__PSD_CORPUS_URL__}${file}` : undefined}
          size={sizeParam(params.get('size'))}
          users={users}
        />
      </div>
    );
  }

  const open = async (bytes: ArrayBuffer, fileName: string) => {
    engine()?.close();
    setEngine(undefined);
    setError(undefined);
    setName(fileName.replace(/\.ps[db]$/i, ''));
    try {
      const started = performance.now();
      const e = await PsdEngine.open(bytes, {
        onFailure: (failure) => setError(failure.message),
      });
      console.info(
        `[psd-fixture] opened ${fileName} in ${Math.round(performance.now() - started)}ms`
      );
      setEngine(e);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openNew = async () => {
    const { width, height } = sizeParam(params.get('size'));
    const bytes = await PsdEngine.blank(width, height, true);
    await open(bytes.slice().buffer, 'Untitled');
  };

  const openCorpusFile = async (file: string) => {
    if (!__PSD_CORPUS_URL__)
      throw new Error('Set PSD_CORPUS_DIR to open files with ?file=.');
    const r = await fetch(`${__PSD_CORPUS_URL__}${file}`);
    if (!r.ok) throw new Error(`${file}: ${r.status}`);
    await open(await r.arrayBuffer(), file.split('/').pop() ?? file);
  };

  const start = async () => {
    try {
      const file = params.get('file');
      if (file) await openCorpusFile(file);
      else if (params.has('new')) await openNew();
    } catch (e) {
      setError(String(e));
    }
  };
  void start();

  return (
    <div class="flex h-screen flex-col bg-page text-ink">
      <header class="flex h-10 shrink-0 items-center gap-3 border-edge-muted border-b px-3 text-sm">
        <strong data-testid="psd-fixture-name">{name()}</strong>
        <label class="text-ink-muted">
          Open .psd{' '}
          <input
            type="file"
            accept=".psd,.psb"
            data-testid="psd-file-input"
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
            <div class="p-6 text-failure" data-testid="psd-fixture-error">
              {message()}
            </div>
          )}
        </Show>
        <Show when={engine()} keyed>
          {(e) => (
            <PsdEditorProvider
              context={{
                engine: e,
                fileName: name,
                download: (blob, n) =>
                  setDownloads((d) => [...d, { name: n, size: blob.size }]),
                notifyError: (m) => setErrors((x) => [...x, m]),
                notifyInfo: (m) => setNotices((x) => [...x, m]),
                canEdit: () => editable,
                save: async (bytes) => {
                  if (params.has('reload')) {
                    const reopened = await PsdEngine.open(bytes.slice().buffer);
                    reopened.close();
                  }
                  setSaves((x) => [...x, bytes]);
                },
              }}
            >
              <PsdEditor />
            </PsdEditorProvider>
          )}
        </Show>
      </main>
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root') as HTMLElement);
