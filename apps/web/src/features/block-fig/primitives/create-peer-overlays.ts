/**
 * Other people on the open page, ready to draw over the canvas: their
 * pointers and the frames of the layers they selected (looked up again
 * when their selection, the page, or the design changes).
 */

import type { FigEngine } from '@core/fig-engine/client';
import type { NodeGeometry } from '@core/fig-engine/types';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import type { FigPeer, PeerOverlay } from '../core/presence';
import type { FigViewer } from './create-fig-viewer';

const resolved = new Map<string, string>();

/** The CSS color of a palette color name (`teal` → its token's value). */
export function paletteColor(name: string): string {
  const cached = resolved.get(name);
  if (cached) return cached;
  const value =
    typeof document === 'undefined'
      ? ''
      : getComputedStyle(document.documentElement)
          .getPropertyValue(`--color-${name}`)
          .trim();
  const color = value || '#f24e1e';
  if (value) resolved.set(name, color);
  return color;
}

export function createPeerOverlays(
  engine: FigEngine,
  viewer: FigViewer,
  peers: Accessor<FigPeer[]>
): Accessor<PeerOverlay[]> {
  const [geometry, setGeometry] = createSignal(
    new Map<string, { key: string; frames: NodeGeometry[] }>()
  );
  const loadFrames = async (
    page: number,
    ids: string[],
    done: (frames: NodeGeometry[]) => void
  ) => {
    if (ids.length === 0) {
      done([]);
      return;
    }
    try {
      done(await engine.geometry(page, ids));
    } catch {
      // The layers are gone (deleted, or on a page that changed).
      done([]);
    }
  };
  const pageId = () => viewer.pages[viewer.page()]?.id;
  const here = () => peers().filter((p) => p.presence.page === pageId());

  // Frames come from the engine (an external system), per selection.
  createEffect(
    on([here, viewer.editVersion], ([list, version]) => {
      const page = viewer.page();
      for (const peer of list) {
        const ids = peer.presence.selection;
        const key = `${page}|${version}|${ids.join(',')}`;
        if (geometry().get(peer.peerId)?.key === key) continue;
        const done = (frames: NodeGeometry[]) =>
          setGeometry((current) => {
            const next = new Map(current);
            next.set(peer.peerId, { key, frames });
            return next;
          });
        void loadFrames(page, ids, done);
      }
    })
  );

  return () =>
    here().map((peer) => ({
      peerId: peer.peerId,
      name: peer.name,
      color: paletteColor(peer.color),
      cursor: peer.presence.cursor,
      selection: geometry().get(peer.peerId)?.frames ?? [],
      editing: peer.presence.editing !== null,
    }));
}
