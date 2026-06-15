import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { type HistorySession, syncServiceClient } from '@service-sync/client';
import type { SerializedEditorState } from 'lexical';
import { LoroDoc } from 'loro-crdt';
import {
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { HistoryScrubber } from './HistoryScrubber';

async function fetchHistory(
  documentId: string
): Promise<{ sessions: HistorySession[] } | undefined> {
  const maybe = await syncServiceClient.getHistoryMeta({ documentId });
  if (maybe.isErr()) {
    console.error("Couldn't get history meta for history overlay", maybe.error);
    return undefined;
  }
  return { sessions: maybe.value.sessions };
}

export function HistoryOverlay(props: {
  documentId: string;
  onExit: () => void;
}) {
  const [history] = createResource(() => props.documentId, fetchHistory);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    props.onExit();
  };
  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  const [selected, setSelected] = createSignal<Date | null>(null);

  // The moment we resolve state at: the selected cursor, or the latest session end.
  const targetAt = createMemo<Date | undefined>(() => {
    const scrubbed = selected();
    if (scrubbed) return scrubbed;

    const sessions = history()?.sessions;
    if (!sessions || sessions.length === 0) return undefined;

    const latest = sessions.reduce((m, s) => Math.max(m, s.endMs), sessions[0].endMs);
    return new Date(latest);
  });

  const [committedState] = createResource(
    // Key on epoch-ms so equal moments don't refetch (Date identity would).
    () => targetAt()?.getTime(),
    async (tMs): Promise<SerializedEditorState | undefined> => {
      const maybe = await syncServiceClient.getStateAt({
        documentId: props.documentId,
        tMs,
      });
      if (maybe.isErr()) {
        console.error("Couldn't get state at history moment", maybe.error);
        return undefined;
      }
      const doc = new LoroDoc();
      doc.import(maybe.value);
      return doc.toJSON() as SerializedEditorState;
    }
  );

  return (
    <div class="absolute inset-0 z-20">
      <div class="absolute inset-y-0 -inset-x-1 -z-10 bg-surface" />
      {/* `.latest` keeps the last rendered state visible while the next loads. */}
      <Show keyed when={committedState.latest}>
        {(state) => {
          const config = buildConfig('markdown')
            .withMentions()
            .withMedia()
            .withLinks()
            .withCode();
          return (
            <MarkdownShell
              config={config}
              initialState={state}
              disabled
              class="ph-no-capture w-full max-w-full pb-20 [&>*:first-child>*:first-child]:mt-0"
            />
          );
        }}
      </Show>
      {/* Controls pinned to the viewport so they're reachable on long docs. */}
      <Show when={history()}>
        {(h) => (
          <div class="fixed inset-x-0 bottom-0 z-30 flex items-center border-edge border-t bg-active px-3 pt-4 pb-3">
            <HistoryScrubber sessions={h().sessions} onSelect={setSelected} />
          </div>
        )}
      </Show>
    </div>
  );
}
