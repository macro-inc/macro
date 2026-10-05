import type { CaretRect, Pos } from '@core/docx-engine/types';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  on,
  Show,
} from 'solid-js';
import type { DocxPeer } from '../queries/docx-session';
import { type PageGeometry, toColumn } from './DocxPages';

type Caret = { peer: DocxPeer; name: string; caret: CaretRect };

/** Where each collaborator's caret is, drawn over the pages. */
export function DocxCollaboratorCarets(props: {
  peers: DocxPeer[];
  geometry: Accessor<PageGeometry>;
  /** Bumps when the document changed (carets move with the text). */
  revision: Accessor<number>;
  caretAt: (pos: Pos) => Promise<CaretRect | null>;
  displayName: (userId: string | undefined) => string;
}) {
  const [carets, setCarets] = createSignal<Caret[]>([]);
  let generation = 0;
  // Caret geometry comes from the engine in the worker.
  createEffect(
    on([() => props.peers, props.revision], ([peers]) => {
      const current = ++generation;
      Promise.all(
        peers.map(async (peer) => {
          const caret = await props.caretAt({
            block: peer.selection.block,
            offset: peer.selection.offset,
          });
          return caret
            ? [{ peer, name: props.displayName(peer.userId), caret }]
            : [];
        })
      )
        .then((found) => {
          if (current === generation) setCarets(found.flat());
        })
        .catch(() => {});
    })
  );

  return (
    <For each={carets()}>
      {(entry) => {
        const box = () =>
          toColumn(props.geometry(), {
            page: entry.caret.page,
            x: entry.caret.x,
            y: entry.caret.y,
            w: 0,
            h: entry.caret.height,
          });
        return (
          <Show when={box()}>
            {(b) => (
              <div
                class="pointer-events-none absolute z-10"
                data-docx-peer={entry.peer.peerId}
                style={{
                  top: `${b().top}px`,
                  left: `${b().left}px`,
                  height: `${b().height}px`,
                }}
              >
                <div
                  class="h-full w-0.5"
                  style={{ 'background-color': entry.peer.color }}
                />
                <Show when={entry.name}>
                  <div
                    class="absolute bottom-full left-0 whitespace-nowrap rounded-sm px-1 py-px text-[10px] font-medium leading-tight"
                    style={{
                      'background-color': entry.peer.color,
                      color: '#fff',
                    }}
                  >
                    {entry.name}
                  </div>
                </Show>
              </div>
            )}
          </Show>
        );
      }}
    </For>
  );
}
