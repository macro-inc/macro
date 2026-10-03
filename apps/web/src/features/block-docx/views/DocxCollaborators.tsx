import { type Accessor, createMemo, For, Show } from 'solid-js';
import { caretRange } from '../core/text-offsets';
import type { DocxPeer } from '../queries/docx-session';

type Caret = {
  peer: DocxPeer;
  name: string;
  top: number;
  left: number;
  height: number;
};

/** Where each collaborator's caret is, drawn over the document. */
export function DocxCollaboratorCarets(props: {
  peers: DocxPeer[];
  editorRoot: HTMLElement | undefined;
  /** Positioning parent of the overlay. */
  overlay: HTMLElement | undefined;
  revision: Accessor<number>;
  displayName: (userId: string | undefined) => string;
}) {
  const carets = createMemo<Caret[]>(() => {
    props.revision();
    const root = props.editorRoot;
    const overlay = props.overlay;
    if (!root || !overlay) return [];
    const origin = overlay.getBoundingClientRect();
    return props.peers.flatMap((peer) => {
      const block = root.querySelector<HTMLElement>(
        `[data-anchor="${CSS.escape(peer.selection.block)}"]`
      );
      if (!block) return [];
      const range = caretRange(block, peer.selection.offset);
      const rect =
        range?.getClientRects()[0] ??
        range?.getBoundingClientRect() ??
        block.getBoundingClientRect();
      const fallback = block.getBoundingClientRect();
      const height = rect.height || Math.min(fallback.height, 20);
      return [
        {
          peer,
          name: props.displayName(peer.userId),
          top: (rect.height ? rect.top : fallback.top) - origin.top,
          left: (rect.height ? rect.left : fallback.left) - origin.left,
          height,
        },
      ];
    });
  });

  return (
    <For each={carets()}>
      {(caret) => (
        <div
          class="pointer-events-none absolute z-10"
          data-docx-peer={caret.peer.peerId}
          style={{
            top: `${caret.top}px`,
            left: `${caret.left}px`,
            height: `${caret.height}px`,
          }}
        >
          <div
            class="h-full w-0.5"
            style={{ 'background-color': caret.peer.color }}
          />
          <Show when={caret.name}>
            <div
              class="absolute bottom-full left-0 whitespace-nowrap rounded-sm px-1 py-px text-[10px] font-medium leading-tight"
              style={{ 'background-color': caret.peer.color, color: '#fff' }}
            >
              {caret.name}
            </div>
          </Show>
        </div>
      )}
    </For>
  );
}
