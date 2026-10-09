/**
 * Other people in a shared document: their pointers with name tags on the
 * canvas, and their avatars over it. Presentational.
 */

import { type Camera, pageToScreen } from '@app/features/block-fig/core/camera';
import { For, Show } from 'solid-js';
import { type AiPeer, initials, type PeerOverlay } from '../core/presence';

/** A presence color: a palette token name, as remote cursors use it. */
const tint = (color: string) => `var(--color-${color}, var(--color-pink))`;

/** Pointers of the people on the canvas. */
export function PeerCursors(props: { peers: PeerOverlay[]; camera: Camera }) {
  return (
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      <For each={props.peers.filter((p) => p.cursor)}>
        {(peer) => {
          const at = () =>
            peer.cursor ? pageToScreen(props.camera, peer.cursor) : undefined;
          return (
            <Show when={at()}>
              {(p) => (
                <div
                  class="absolute top-0 left-0 transition-transform duration-75 ease-linear"
                  style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
                  data-testid="ai-peer-cursor"
                  data-peer={peer.name}
                >
                  <svg
                    width="16"
                    height="20"
                    viewBox="0 0 16 20"
                    aria-hidden="true"
                    class="block"
                  >
                    <path
                      d="M1 1v15l4-3.5 3 6.5 2.6-1.1-2.9-6.4H13z"
                      fill={peer.color}
                      stroke="white"
                      stroke-width="1.25"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span
                    class="-mt-0.5 ml-2.5 block w-max rounded-[2px_6px_6px_6px] px-1.5 py-0.5 font-medium text-[11px] text-surface leading-tight"
                    style={{ 'background-color': peer.color }}
                  >
                    {peer.editing ? `${peer.name} (typing)` : peer.name}
                  </span>
                </div>
              )}
            </Show>
          );
        }}
      </For>
    </div>
  );
}

/** Avatars of the people in the document; a click shows what they see. */
export function PeerAvatars(props: {
  peers: AiPeer[];
  status: 'connected' | 'connecting' | 'offline';
  onShow: (peer: AiPeer) => void;
}) {
  return (
    <div
      data-testid="ai-collaborators"
      class="absolute top-2 right-3 z-10 flex items-center gap-1"
    >
      <Show when={props.status !== 'connected'}>
        <span class="rounded-full bg-menu px-2 py-0.5 text-ink-muted text-xs shadow">
          {props.status === 'offline' ? 'Offline' : 'Connecting…'}
        </span>
      </Show>
      <div class="-space-x-1 flex">
        <For each={props.peers}>
          {(peer) => (
            <button
              type="button"
              data-testid="ai-collaborator"
              data-peer={peer.name}
              title={`${peer.name}: click to see their view`}
              class="flex size-7 items-center justify-center rounded-full font-medium text-[11px] text-surface ring-2 ring-surface"
              style={{ 'background-color': tint(peer.color) }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => props.onShow(peer)}
            >
              {initials(peer.name)}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
