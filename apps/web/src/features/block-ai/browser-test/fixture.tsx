/**
 * Mounts the real Illustrator editor (wasm engine in its workers) without
 * the app: no authentication, routes, or document storage. `?new` opens a
 * blank document as the app creates it, `?sample` the sample document
 * (`sample-document.ts`), `?file=<name>` a file from AI_CORPUS_DIR; the
 * header also opens a local `.ai`. Saves stay in memory (`?reload`
 * reopens each, checking it round-trips); `?readonly` opens it as a
 * viewer would. `?collab` opens several people side by side.
 * `window.aiFixture` exposes the engine, saves, and reported messages.
 */

import '@fontsource-variable/inter';
import '../../../index.css';
import { fixtureFontSource } from '@app/features/block-fig/browser-test/font-source';
import { AiEngine } from '@core/ai-engine/client';
import type { Row } from '@core/ai-engine/types';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { AiEditorProvider } from '../context/ai-editor-context';
import { NEW_ARTBOARD } from '../core/new-document';
import { AiEditorView } from '../views/ai-editor';
import { CollabFixture, type FixtureCollab } from './collab-fixture';
import { sampleDocument } from './sample-document';

declare const __AI_CORPUS_URL__: string;

declare global {
  interface Window {
    aiFixture: {
      engine: () => AiEngine | undefined;
      errors: () => string[];
      notices: () => string[];
      downloads: () => { name: string; size: number }[];
      /** Every saved file, oldest first. */
      saves: () => Uint8Array[];
      /** Font stylesheets and files the editor asked for. */
      fontRequests: () => string[];
      /** The layers panel's rows of a file, opened on its own. */
      rowsOf: (bytes: Uint8Array) => Promise<Row[]>;
      /** With `?collab`: the people editing together. */
      collab?: FixtureCollab;
    };
  }
}

async function fetchFile(name: string): Promise<Uint8Array> {
  const r = await fetch(`${__AI_CORPUS_URL__}${name}`);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** The document the URL asks for. */
function initialDocument(params: URLSearchParams): Promise<Uint8Array> {
  const file = params.get('file');
  if (file) return fetchFile(file);
  if (params.has('sample')) return sampleDocument();
  return AiEngine.blank(NEW_ARTBOARD.width, NEW_ARTBOARD.height);
}

function Fixture() {
  const params = new URLSearchParams(location.search);
  const [engine, setEngine] = createSignal<AiEngine>();
  const [error, setError] = createSignal<string>();
  const [name, setName] = createSignal('Illustration');
  const [errors, setErrors] = createSignal<string[]>([]);
  const [notices, setNotices] = createSignal<string[]>([]);
  const [downloads, setDownloads] = createSignal<
    { name: string; size: number }[]
  >([]);
  const [saves, setSaves] = createSignal<Uint8Array[]>([]);
  const editable = !params.has('readonly');
  const fonts = fixtureFontSource();
  window.aiFixture = {
    engine,
    errors,
    notices,
    downloads,
    saves,
    fontRequests: fonts.requests,
    rowsOf: async (bytes) => {
      const e = await AiEngine.open(bytes.slice().buffer, { helpers: 0 });
      try {
        return await e.rows();
      } finally {
        e.close();
      }
    },
  };

  // Several people on one document, side by side (`?collab&people=a,b`).
  if (params.has('collab')) {
    const users = (params.get('people') ?? 'alice,bob')
      .split(',')
      .map((n) => `macro|${n}@example.com`);
    return (
      <div class="flex h-screen flex-col bg-page text-ink">
        <CollabFixture load={() => initialDocument(params)} users={users} />
      </div>
    );
  }

  const open = async (bytes: Uint8Array, fileName: string) => {
    engine()?.close();
    setEngine(undefined);
    setError(undefined);
    setName(fileName.replace(/\.ai$/i, ''));
    try {
      const started = performance.now();
      const e = await AiEngine.open(bytes.slice().buffer);
      console.info(
        `[ai-fixture] opened ${fileName} in ${Math.round(performance.now() - started)}ms`
      );
      setEngine(e);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const start = async () => {
    try {
      const bytes = await initialDocument(params);
      await open(bytes, params.get('file') ?? 'Illustration');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  void start();

  const save = async (bytes: Uint8Array) => {
    if (params.has('reload')) {
      const reopened = await AiEngine.open(bytes.slice().buffer, {
        helpers: 0,
      });
      reopened.close();
    }
    setSaves((x) => [...x, bytes]);
  };

  return (
    <div class="flex h-screen flex-col bg-page text-ink">
      <header class="flex h-10 shrink-0 items-center gap-3 border-edge-muted border-b px-3 text-sm">
        <strong>{name()}</strong>
        <label class="text-ink-muted">
          Open .ai{' '}
          <input
            type="file"
            accept=".ai,.pdf"
            data-testid="ai-file-input"
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              if (f) await open(new Uint8Array(await f.arrayBuffer()), f.name);
            }}
          />
        </label>
      </header>
      <main class="min-h-0 flex-1">
        <Show when={error()}>
          {(message) => (
            <div class="p-6 text-failure" data-testid="ai-fixture-error">
              {message()}
            </div>
          )}
        </Show>
        <Show when={engine()} keyed>
          {(e) => (
            <AiEditorProvider
              context={{
                engine: e,
                fileName: name,
                download: (blob, n) =>
                  setDownloads((d) => [...d, { name: n, size: blob.size }]),
                notifyError: (m) => setErrors((x) => [...x, m]),
                notifyInfo: (m) => setNotices((x) => [...x, m]),
                canEdit: () => editable,
                save,
                fonts,
              }}
            >
              <AiEditorView />
            </AiEditorProvider>
          )}
        </Show>
      </main>
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root') as HTMLElement);
