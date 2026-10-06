/**
 * Other people in a shared document, ready to draw over the canvas: their
 * pointers and the bounds of what they selected (looked up again when
 * their selection or the document changes).
 */

import { paletteColor } from '@app/features/block-fig/primitives/create-peer-overlays';
import type { AiEngine } from '@core/ai-engine/client';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import { type Rect, toRect } from '../core/geometry';
import type { AiPeer, PeerOverlay } from '../core/presence';
import type { AiViewer } from './create-ai-viewer';

export function createPeerOverlays(
  engine: AiEngine,
  viewer: AiViewer,
  peers: Accessor<AiPeer[]>
): Accessor<PeerOverlay[]> {
  const [bounds, setBounds] = createSignal(
    new Map<string, { key: string; rects: Rect[] }>()
  );

  const load = async (peerId: string, key: string, ids: number[]) => {
    let rects: Rect[] = [];
    try {
      const infos = await engine.infos(ids);
      rects = infos.flatMap((i) => (i?.bounds ? [toRect(i.bounds)] : []));
    } catch {
      // The objects are gone (deleted, or someone else's undo).
    }
    setBounds((current) => new Map(current).set(peerId, { key, rects }));
  };

  // Bounds come from the engine (an external system), per selection.
  createEffect(
    on([peers, viewer.editVersion], ([list, version]) => {
      for (const peer of list) {
        const ids = peer.presence.selection;
        const key = `${version}|${ids.join(',')}`;
        if (bounds().get(peer.peerId)?.key === key) continue;
        void load(peer.peerId, key, ids);
      }
    })
  );

  return () =>
    peers().map((peer) => ({
      peerId: peer.peerId,
      name: peer.name,
      color: paletteColor(peer.color),
      cursor: peer.presence.cursor,
      selection: bounds().get(peer.peerId)?.rects ?? [],
      editing: peer.presence.editing !== null,
    }));
}
