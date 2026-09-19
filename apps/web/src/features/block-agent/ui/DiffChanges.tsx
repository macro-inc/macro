/**
 * Additions/deletions badge for a diff: "+18 −6" by default, or a GitHub-style
 * five-block proportional bar with the `bars` variant.
 *
 * Port of opencode's diff-changes — github.com/sst/opencode, MIT © 2025
 * opencode — adapted to Macro tokens and Tailwind.
 */

import { createMemo, For, Match, Show, Switch } from 'solid-js';

const TOTAL_BLOCKS = 5;

export interface DiffChangesProps {
  additions: number;
  deletions: number;
  variant?: 'default' | 'bars';
  class?: string;
}

/**
 * How many of the five bar blocks to paint green / red / neutral, roughly
 * proportional to the diff but capped so tiny diffs never look sweeping.
 */
function blockCounts(adds: number, dels: number) {
  if (adds === 0 && dels === 0) {
    return { added: 0, deleted: 0, neutral: TOTAL_BLOCKS };
  }

  const total = adds + dels;

  if (total < 5) {
    const added = adds > 0 ? 1 : 0;
    const deleted = dels > 0 ? 1 : 0;
    return { added, deleted, neutral: TOTAL_BLOCKS - added - deleted };
  }

  const ratio = adds > dels ? adds / dels : dels / adds;
  let blocksForColors = TOTAL_BLOCKS;

  if (total < 20) {
    blocksForColors = TOTAL_BLOCKS - 1;
  } else if (ratio < 4) {
    blocksForColors = TOTAL_BLOCKS - 1;
  }

  const addedRaw = (adds / total) * blocksForColors;
  const deletedRaw = (dels / total) * blocksForColors;

  let added = adds > 0 ? Math.max(1, Math.round(addedRaw)) : 0;
  let deleted = dels > 0 ? Math.max(1, Math.round(deletedRaw)) : 0;

  // Cap bars based on actual change magnitude.
  if (adds > 0 && adds <= 5) added = Math.min(added, 1);
  if (adds > 5 && adds <= 10) added = Math.min(added, 2);
  if (dels > 0 && dels <= 5) deleted = Math.min(deleted, 1);
  if (dels > 5 && dels <= 10) deleted = Math.min(deleted, 2);

  if (added + deleted > blocksForColors) {
    if (addedRaw > deletedRaw) {
      added = blocksForColors - deleted;
    } else {
      deleted = blocksForColors - added;
    }
  }

  const neutral = Math.max(0, TOTAL_BLOCKS - added - deleted);

  return { added, deleted, neutral };
}

export function DiffChanges(props: DiffChangesProps) {
  const variant = () => props.variant ?? 'default';
  const total = () => props.additions + props.deletions;

  /** Fill class per bar block: additions, then deletions, then neutral. */
  const blocks = createMemo(() => {
    const counts = blockCounts(props.additions, props.deletions);
    return [
      ...Array<string>(counts.added).fill('fill-success'),
      ...Array<string>(counts.deleted).fill('fill-failure'),
      ...Array<string>(counts.neutral).fill('fill-ink-placeholder'),
    ].slice(0, TOTAL_BLOCKS);
  });

  return (
    <Show when={variant() === 'bars' || total() > 0}>
      <div
        class="flex shrink-0 items-center gap-2"
        classList={{ [props.class ?? '']: !!props.class }}
      >
        <Switch>
          <Match when={variant() === 'bars'}>
            <svg
              class="block h-3.5 w-[18px]"
              viewBox="0 0 18 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <For each={blocks()}>
                {(fill, i) => (
                  <rect x={i() * 4} width="2" height="14" rx="1" class={fill} />
                )}
              </For>
            </svg>
          </Match>
          <Match when={variant() === 'default'}>
            <span class="font-mono tabular-nums text-success">{`+${props.additions}`}</span>
            <span class="font-mono tabular-nums text-failure">{`−${props.deletions}`}</span>
          </Match>
        </Switch>
      </div>
    </Show>
  );
}
