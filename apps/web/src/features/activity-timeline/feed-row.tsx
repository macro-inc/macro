import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { cn } from '@ui';
import { formatDistanceToNowStrict } from 'date-fns';
import { For, type JSX, Show } from 'solid-js';

/**
 * The visual shell of one feed entry, modeled on a classic activity feed:
 * a circular avatar on a vertical connector line, an "actor verb location"
 * title with a relative timestamp, and optional content below.
 */
export function FeedRow(props: {
  /** Circular leading visual; rendered inside a size-8 rounded clip. */
  avatar: JSX.Element;
  /** Small event-type glyph pinned to the avatar's corner. */
  badge?: JSX.Element;
  title: JSX.Element;
  ts: number;
  body?: JSX.Element;
  /** Whether to draw the connector line down to the next entry. */
  connector: boolean;
  onClick?: (event: MouseEvent) => void;
}) {
  return (
    <li class="relative pb-8">
      <Show when={props.connector}>
        <span
          aria-hidden="true"
          class="absolute left-4 top-4 -ml-px h-full w-0.5 bg-ink/6"
        />
      </Show>
      <div
        class={cn(
          'relative flex items-start gap-x-3 rounded-lg -mx-2 px-2 py-1 -my-1',
          props.onClick && 'cursor-pointer hover:bg-ink/3'
        )}
        onClick={props.onClick}
      >
        <div class="relative shrink-0">
          <div class="flex size-8 items-center justify-center overflow-hidden rounded-full bg-ink/6 ring-4 ring-surface">
            {props.avatar}
          </div>
          <Show when={props.badge}>
            <span class="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-surface p-0.5 text-ink-muted [&_svg]:size-3">
              {props.badge}
            </span>
          </Show>
        </div>
        <div class="min-w-0 flex-1 py-0.5">
          <div class="ph-no-capture text-xs text-ink-muted">
            {props.title}
            <span class="whitespace-nowrap text-ink-extra-muted">
              {' · '}
              {formatDistanceToNowStrict(new Date(props.ts), {
                addSuffix: true,
              })}
            </span>
          </div>
          <Show when={props.body}>
            <div class="ph-no-capture mt-1 min-w-0 text-xs text-ink-muted/90">
              {props.body}
            </div>
          </Show>
        </div>
      </div>
    </li>
  );
}

/** An emphasized (actor / location / object) segment of a feed title. */
export function Emph(props: { children: JSX.Element }) {
  return <span class="font-medium text-ink">{props.children}</span>;
}

const MAX_STACKED_LINES = 3;

/**
 * Content lines for a collapsed run — up to three one-line previews plus a
 * "+N more" tail. Lines render as single-line markdown so channel formatting
 * (mentions, links) keeps working.
 */
export function StackedBody(props: { lines: string[] }) {
  const visible = () => props.lines.slice(0, MAX_STACKED_LINES);
  const overflow = () => props.lines.length - MAX_STACKED_LINES;

  return (
    <div class="flex min-w-0 flex-col gap-0.5">
      <For each={visible()}>
        {(line) => (
          <div class="min-w-0 truncate">
            <StaticMarkdown markdown={line} singleLine />
          </div>
        )}
      </For>
      <Show when={overflow() > 0}>
        <div class="text-ink-extra-muted">+{overflow()} more</div>
      </Show>
    </div>
  );
}

/** Single-line markdown body for one event's content. */
export function LineBody(props: { text: string }) {
  return (
    <div class="min-w-0 truncate">
      <StaticMarkdown markdown={props.text} singleLine />
    </div>
  );
}
