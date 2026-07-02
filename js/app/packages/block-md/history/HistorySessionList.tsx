import { tryMacroId, useDisplayNameParts } from '@core/user';
import type { HistorySession } from '@service-sync/client';
import { cn } from '@ui';
import { type Accessor, createMemo, For, Show } from 'solid-js';
import { buildActivityRows } from './activityRows';
import { userColor } from './utils';

type HistorySessionListProps = {
  sessions: readonly HistorySession[];
  selectedAt: Accessor<Date | null>;
  onSelect: (at?: Date) => void;
  onViewSessionDiff?: (session: HistorySession) => void;
};

function UserName(props: { userId: string }) {
  const { firstName } = useDisplayNameParts(tryMacroId(props.userId));
  return <>{firstName()}</>;
}

const MAX_NAMED = 3;

function UserList(props: { userIds: readonly string[] }) {
  const visible = () => props.userIds.slice(0, MAX_NAMED);
  const overflow = () => props.userIds.length - MAX_NAMED;
  return (
    <>
      <For each={visible()}>
        {(userId, index) => (
          <>
            <Show when={index() > 0}>
              {index() === visible().length - 1 && overflow() <= 0
                ? ' and '
                : ', '}
            </Show>
            <UserName userId={userId} />
          </>
        )}
      </For>
      <Show when={overflow() > 0}>
        {` and ${overflow()} ${overflow() === 1 ? 'other' : 'others'}`}
      </Show>
    </>
  );
}

export function HistorySessionList(props: HistorySessionListProps) {
  const rows = createMemo(() => buildActivityRows(props.sessions));

  const selectedMs = () => props.selectedAt()?.getTime() ?? null;

  return (
    <Show when={rows().length > 0}>
      <div class="mt-2 min-w-0">
        <div class="min-h-0 space-y-1 pr-1">
          <For each={rows()}>
            {(row) => {
              const isSelected = () => selectedMs() === row.endMs;
              const edits = () =>
                `${row.count} ${row.count === 1 ? 'edit' : 'edits'}`;
              return (
                <button
                  type="button"
                  class={cn(
                    'flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    isSelected() && 'bg-active text-ink'
                  )}
                  onClick={() => {
                    if (props.onViewSessionDiff) {
                      // A row aggregates a burst of activity; diff its whole
                      // time range, tinted by its lead editor.
                      props.onViewSessionDiff({
                        userId: row.userIds[0] ?? 'unknown',
                        startMs: row.startMs,
                        endMs: row.endMs,
                        count: row.count,
                      });
                    } else {
                      props.onSelect(new Date(row.endMs));
                    }
                  }}
                >
                  <span class="flex w-4 shrink-0 items-center -space-x-1 mt-[3px]">
                    <For each={row.userIds.slice(0, MAX_NAMED)}>
                      {(userId) => (
                        <span
                          class="size-2 rounded-full ring-1 ring-surface"
                          style={{ 'background-color': userColor(userId) }}
                        />
                      )}
                    </For>
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-ink text-xs">
                      <UserList userIds={row.userIds} /> edited {row.label}
                    </span>
                    <span class="block text-ink-muted text-[11px]">
                      {edits()}
                    </span>
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </div>
    </Show>
  );
}
