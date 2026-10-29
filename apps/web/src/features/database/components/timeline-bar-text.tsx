import DotsIcon from '@icon/system/regular/dots-three.svg';
import { TagDot } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import type { TimelineBarField } from '../core/timeline-bar';

/**
 * A bar's text: its title, then its times, then its fields. The line wraps
 * whole segments onto a hidden second line, so what does not fit drops from
 * the end rather than truncating; only a title longer than its bar is cut.
 */
export function TimelineBarText(props: {
  title: string;
  time?: string;
  fields: TimelineBarField[];
}) {
  return (
    <span class="flex h-7 min-w-0 flex-wrap items-center overflow-hidden">
      <span class="block h-7 min-w-0 truncate leading-7">{props.title}</span>
      <Show when={props.time}>{(time) => <Segment>{time()}</Segment>}</Show>
      <For each={props.fields}>
        {(field) => (
          <Segment>
            <For each={field.colors.slice(0, 3)}>
              {(color) => <TagDot fill={color} size="sm" />}
            </For>
            <span
              class="max-w-40 truncate"
              title={`${field.name}: ${field.text}`}
            >
              {field.text}
            </span>
          </Segment>
        )}
      </For>
    </span>
  );
}

function Segment(props: { children: JSX.Element }) {
  return (
    <span class="flex h-7 shrink-0 items-center gap-1 text-ink-muted before:px-1.5 before:text-ink-extra-muted before:content-['·']">
      {props.children}
    </span>
  );
}

/**
 * What sits at a bar's right end: the colors of its other options, and on
 * touch, where pressing a bar drags it, a button opening its menu.
 */
export function TimelineBarTrailing(props: {
  title: string;
  rowId: string;
  dots: string[];
  onMenu: (button: HTMLElement) => void;
}) {
  return (
    <>
      <Show when={props.dots.length}>
        <span class="flex items-center gap-1 pr-1.5">
          <For each={props.dots.slice(0, 3)}>
            {(color) => <TagDot fill={color} size="sm" />}
          </For>
        </span>
      </Show>
      <button
        type="button"
        data-timeline-record={props.rowId}
        aria-label={`More actions for ${props.title}`}
        class="mr-0.5 hidden size-5 shrink-0 items-center justify-center rounded text-ink-muted outline-none focus-visible:ring-2 focus-visible:ring-current touch:inline-flex"
        onClick={(event) => props.onMenu(event.currentTarget)}
      >
        <DotsIcon class="size-3.5" />
      </button>
    </>
  );
}
