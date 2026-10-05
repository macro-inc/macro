/**
 * Where other people are in a collaborative presentation: the shapes they
 * selected on this slide, who is here, and which slides they are on.
 */

import type { SlideOutline } from '@core/pptx-engine/types';
import { For, Show } from 'solid-js';
import type { PresentationPeer } from '../context/pptx-editor-context';
import { boxOf, corners, type Point } from '../core/geometry';

const points = (pts: Point[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

/** A presence color: a palette token name, as remote cursors use it. */
const tint = (color: string) => `var(--color-${color}, var(--color-pink))`;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** Outlines and name tags of the shapes other people selected on `slide`. */
export function PeerSelections(props: {
  peers: PresentationPeer[];
  slide: SlideOutline;
  width: number;
  height: number;
  /** Points per CSS pixel, so chrome keeps a constant on-screen size. */
  unit: number;
}) {
  const marks = () =>
    props.peers.flatMap((peer) =>
      peer.selection.slide === props.slide.id
        ? peer.selection.shapes.flatMap((id) => {
            const shape = props.slide.shapes.find((s) => s.id === id);
            return shape ? [{ peer, box: boxOf(shape) }] : [];
          })
        : []
    );
  return (
    <svg
      class="pointer-events-none absolute inset-0 size-full overflow-visible"
      viewBox={`0 0 ${props.width} ${props.height}`}
      aria-hidden="true"
    >
      <For each={marks()}>
        {(mark) => {
          const tag = () =>
            mark.peer.selection.editing
              ? `${mark.peer.name} is typing`
              : mark.peer.name;
          const fontSize = () => 11 * props.unit;
          return (
            <g data-testid="pptx-peer-selection" data-peer={mark.peer.name}>
              <polygon
                points={points(corners(mark.box))}
                fill="none"
                style={{ stroke: tint(mark.peer.color) }}
                stroke-width={2 * props.unit}
              />
              <rect
                x={mark.box.x}
                y={mark.box.y - fontSize() * 1.6}
                width={tag().length * fontSize() * 0.6 + fontSize()}
                height={fontSize() * 1.5}
                rx={3 * props.unit}
                style={{ fill: tint(mark.peer.color) }}
              />
              <text
                x={mark.box.x + fontSize() * 0.5}
                y={mark.box.y - fontSize() * 0.5}
                style={{
                  fill: 'var(--color-surface)',
                  'font-size': `${fontSize()}px`,
                  'font-family': 'Inter, sans-serif',
                }}
              >
                {tag()}
              </text>
            </g>
          );
        }}
      </For>
    </svg>
  );
}

/** Avatars of the other people in the presentation. */
export function Collaborators(props: {
  peers: PresentationPeer[];
  status: 'connected' | 'connecting' | 'offline';
}) {
  return (
    <div
      data-testid="pptx-collaborators"
      class="pointer-events-none absolute top-2 right-3 z-10 flex items-center gap-1"
    >
      <For each={props.peers}>
        {(peer) => (
          <span
            data-testid="pptx-collaborator"
            title={peer.name}
            class="flex size-6 items-center justify-center rounded-full font-medium text-[10px] text-surface ring-2 ring-surface"
            style={{ 'background-color': tint(peer.color) }}
          >
            {initials(peer.name)}
          </span>
        )}
      </For>
      <Show when={props.status !== 'connected'}>
        <span class="rounded-full bg-surface px-2 py-0.5 text-ink-muted text-xs shadow">
          {props.status === 'offline' ? 'Offline' : 'Connecting…'}
        </span>
      </Show>
    </div>
  );
}

/** Colored dots for the people on a slide, for its thumbnail. */
export function SlidePeers(props: { peers: PresentationPeer[] }) {
  return (
    <Show when={props.peers.length > 0}>
      <div class="pointer-events-none absolute bottom-1 left-1 flex gap-0.5">
        <For each={props.peers}>
          {(peer) => (
            <span
              title={peer.name}
              class="size-2.5 rounded-full ring-1 ring-surface"
              style={{ 'background-color': tint(peer.color) }}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
