import { UserIcon } from '@core/component/UserIcon';
import { For, type JSX, Show } from 'solid-js';
import type { LeaderboardRow } from '../core/leaderboard';

function Row(props: {
  row: LeaderboardRow;
  highlighted: boolean;
  name: string;
  value: string;
}) {
  return (
    <li
      class="flex h-8 items-center gap-2 rounded-lg px-2 text-sm"
      classList={{ 'bg-selected': props.highlighted }}
    >
      <span
        class="w-5 shrink-0 text-right font-medium tabular-nums"
        classList={{
          'text-accent': props.row.rank === 1,
          'text-ink-subtle': props.row.rank !== 1,
        }}
      >
        {props.row.rank}
      </span>
      <UserIcon id={props.row.userId} size="md" suppressClick />
      <span class="min-w-0 flex-1 truncate text-ink">{props.name}</span>
      <span class="shrink-0 font-medium text-ink tabular-nums">
        {props.value}
      </span>
    </li>
  );
}

/** A ranked list; the viewer's row follows the top rows when it falls below them. */
export function LeaderboardList(props: {
  rows: LeaderboardRow[];
  viewer: LeaderboardRow | undefined;
  viewerId: string | undefined;
  displayName: (userId: string) => string;
  formatValue: (value: number) => string;
  empty: JSX.Element;
}) {
  const viewerOutside = () =>
    props.viewer &&
    !props.rows.some((row) => row.userId === props.viewer?.userId)
      ? props.viewer
      : undefined;

  return (
    <Show when={props.rows.length > 0} fallback={props.empty}>
      <ol class="flex flex-col gap-0.5">
        <For each={props.rows}>
          {(row) => (
            <Row
              row={row}
              highlighted={row.userId === props.viewerId}
              name={props.displayName(row.userId)}
              value={props.formatValue(row.value)}
            />
          )}
        </For>
        <Show when={viewerOutside()} keyed>
          {(row) => (
            <>
              <li aria-hidden="true" class="px-2 text-ink-disabled text-xs">
                ⋯
              </li>
              <Row
                row={row}
                highlighted
                name={props.displayName(row.userId)}
                value={props.formatValue(row.value)}
              />
            </>
          )}
        </Show>
      </ol>
    </Show>
  );
}
