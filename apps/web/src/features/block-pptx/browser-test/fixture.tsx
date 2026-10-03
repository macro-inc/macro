/**
 * Mounts the real PPTX editor (wasm engine in its worker) without the app:
 * no authentication, routes, or document storage. Saving keeps the bytes in
 * memory; `window.pptxFixture` exposes them to tests.
 */

import '@fontsource-variable/inter';
import '../../../index.css';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import {
  type PptxEditorContext,
  PptxEditorProvider,
  type PresentationEngine,
} from '../context/pptx-editor-context';
import { openWorkerPresentation } from '../queries/presentation-engine';
import { PptxEditor } from '../views/pptx-editor';

declare const __PPTX_CORPUS_URL__: string;
const CORPUS = __PPTX_CORPUS_URL__;

const DECKS: Record<string, string> = {
  'Kitchen sink (financial)': 'generated/kitchen-sink-financial.pptx',
  'Financial statement tables': 'generated/tables-financial-statement.pptx',
  Charts: 'generated/charts-basic.pptx',
  'Text and bullets': 'generated/text-bullets-numbering.pptx',
  'Dallas Fed fiscal policy (wild)': 'wild/dallasfed-fiscal-policy.pptx',
  'Milwaukee 2017 budget (wild)':
    'wild/milwaukee-2017-proposed-budget-overview.pptx',
  'San Francisco budget outlook (wild)':
    'wild/san-francisco-fy2018-budget-outlook.pptx',
};

declare global {
  interface Window {
    pptxFixture: {
      /** Bytes of the last save, or null. */
      saved: () => Uint8Array | null;
      saves: () => number;
      engine: () => PresentationEngine | undefined;
      errors: () => string[];
    };
  }
}

function Fixture() {
  const params = new URLSearchParams(location.search);
  const readonly = params.has('readonly');
  const [engine, setEngine] = createSignal<PresentationEngine>();
  const [error, setError] = createSignal<string>();
  const [name, setName] = createSignal('Presentation.pptx');
  const [saved, setSaved] = createSignal<Uint8Array | null>(null);
  const [saves, setSaves] = createSignal(0);
  const [errors, setErrors] = createSignal<string[]>([]);

  window.pptxFixture = { saved, saves, engine, errors };

  async function open(bytes: ArrayBuffer, fileName: string) {
    engine()?.close();
    setEngine(undefined);
    setError(undefined);
    setName(fileName);
    try {
      setEngine(await openWorkerPresentation(bytes));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openCorpus(path: string) {
    const response = await fetch(CORPUS + path);
    await open(
      await response.arrayBuffer(),
      path.split('/').pop() ?? 'deck.pptx'
    );
  }

  const initial = params.get('deck') ?? DECKS['Kitchen sink (financial)'];
  void openCorpus(initial);

  const context = (e: PresentationEngine): PptxEditorContext => ({
    engine: e,
    persist: async (bytes) => {
      await new Promise((r) => setTimeout(r, 150));
      setSaved(bytes);
      setSaves((n) => n + 1);
    },
    canEdit: () => !readonly,
    fileName: name,
    download: (bytes, fileName) => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    notifyError: (message) => setErrors((list) => [...list, message]),
  });

  return (
    <div class="flex h-screen flex-col bg-page text-ink">
      <header class="flex h-11 shrink-0 items-center gap-3 border-edge-muted border-b px-3 text-sm">
        <span class="font-semibold">{name()}</span>
        <select
          data-testid="fixture-deck"
          class="rounded border border-edge-muted bg-input px-1 py-0.5"
          onChange={(e) => void openCorpus(e.currentTarget.value)}
        >
          <For each={Object.entries(DECKS)}>
            {([label, path]) => (
              <option value={path} selected={path === initial}>
                {label}
              </option>
            )}
          </For>
        </select>
        <label class="cursor-default text-ink-muted">
          Open file…
          <input
            type="file"
            accept=".pptx"
            class="hidden"
            data-testid="fixture-open"
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              if (file) await open(await file.arrayBuffer(), file.name);
            }}
          />
        </label>
        <span
          class="ml-auto text-ink-muted text-xs"
          data-testid="fixture-saves"
        >
          {saves()} saves
        </span>
      </header>
      <main class="min-h-0 flex-1">
        <Show when={error()}>
          <div class="p-6 text-failure">{error()}</div>
        </Show>
        <Show when={engine()} keyed>
          {(e) => (
            <PptxEditorProvider context={context(e)}>
              <PptxEditor />
            </PptxEditorProvider>
          )}
        </Show>
      </main>
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
