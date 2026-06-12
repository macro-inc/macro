import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { DebugSlider } from '@core/component/Slider';
import { debouncedDependent } from '@core/util/debounce';
import { syncServiceClient } from '@service-sync/client';
import type { SerializedEditorState } from 'lexical';
import { LoroDoc, type PeerID } from 'loro-crdt';
import { createMemo, createResource, createSignal, Show } from 'solid-js';

/**
 * Read-only Lexical editor overlaid on top of the live editor that we use to
 * display history in.
 */
type Version = { peer: PeerID; counter: number; timestamp: number };

async function fetchHistory(
  documentId: string
): Promise<{ doc: LoroDoc; versions: Version[] } | undefined> {
  const maybe = await syncServiceClient.getSnapshot({ documentId });
  if (maybe.isErr()) {
    console.error("Couldn't get snapshot for history overlay", maybe);
    return undefined;
  }

  const doc = new LoroDoc();
  doc.import(maybe.value);

  const versions: Version[] = [];
  for (const [, changes] of doc.getAllChanges()) {
    for (const change of changes) {
      versions.push({
        peer: change.peer,
        // End of the change = a consistent commit boundary. Checking out to a
        // change's *start* counter lands mid-edit, where child nodes exist but
        // their `type` field op hasn't applied yet → malformed state.
        counter: change.counter + change.length - 1,
        timestamp: change.timestamp,
      });
    }
  }
  versions.sort((a, b) => a.timestamp - b.timestamp);

  return { doc, versions };
}

// A mid-edit frontier can leave nested nodes without a `type`, which crashes
// Lexical's parser. Recursively confirm every node has one before rendering.
function isRenderableNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as { type?: unknown; children?: unknown };
  if (typeof n.type !== 'string') return false;
  return Array.isArray(n.children) ? n.children.every(isRenderableNode) : true;
}

function stateAtVersion(
  doc: LoroDoc,
  version: Version
): SerializedEditorState | undefined {
  doc.checkout([{ peer: version.peer, counter: version.counter }]);
  const json = doc.toJSON();
  const root = (json as Partial<SerializedEditorState>)?.root;
  if (!root || !Array.isArray(root.children) || root.children.length === 0) {
    return undefined;
  }
  if (!root.children.every(isRenderableNode)) {
    // TEMP (verification): inspect which nodes are missing a `type` at this
    // frontier. Expand `json` in the console — malformed nodes show type:undefined.
    console.warn('[history] skipped malformed version', version, json);
    return undefined;
  }
  return json as SerializedEditorState;
}

const clampIndex = (i: number | null, len: number) =>
  i === null ? len - 1 : Math.min(Math.max(0, i), len - 1);

export function HistoryOverlay(props: { documentId: string }) {
  const [history] = createResource(() => props.documentId, fetchHistory);
  // `rawIndex` follows the thumb live; `committed` is a debounced view of it,
  // and is the version we actually rebuild the editor at.
  const [rawIndex, setRawIndex] = createSignal<number | null>(null);
  const committed = debouncedDependent(rawIndex, 20);

  const sliderValue = createMemo(() => {
    const h = history();
    return h && h.versions.length
      ? clampIndex(rawIndex(), h.versions.length)
      : 0;
  });

  const committedState = createMemo<SerializedEditorState | undefined>(() => {
    const h = history();
    if (!h || h.versions.length === 0) return undefined;
    return stateAtVersion(
      h.doc,
      h.versions[clampIndex(committed(), h.versions.length)]
    );
  });

  return (
    <div class="absolute inset-0 z-20 bg-surface">
      <Show keyed when={committedState()}>
        {(state) => {
          // Fresh builder per version → fresh editor + portal tree.
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
          <div class="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-edge border-t bg-surface px-3 py-2">
            <DebugSlider
              label="Version"
              class="flex-1"
              min={0}
              max={Math.max(0, h().versions.length - 1)}
              value={sliderValue()}
              onChange={(v) => setRawIndex(Math.round(v))}
            />
          </div>
        )}
      </Show>
    </div>
  );
}
