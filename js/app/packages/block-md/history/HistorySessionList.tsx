import { tryMacroId, useDisplayNameParts } from '@core/user';
import { formatRelativeTimestamp } from '@entity';
import type { HistorySession } from '@service-sync/client';
import { cn } from '@ui';
import { type Accessor, createMemo, For, Show } from 'solid-js';
import { userColor, userLabel } from './utils';

type HistorySessionListProps = {
  sessions: readonly HistorySession[];
  selectedAt: Accessor<Date | null>;
  onSelect: (at: Date | null) => void;
};

type HistorySessionRow = {
  id: string;
  userIds: string[];
  startMs: number;
  endMs: number;
  count: number;
};

function isYesterday(date: Date, now: Date) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  );
}

function isLastWeek(date: Date, now: Date) {
  const thisWeekStart = new Date(now);
  thisWeekStart.setHours(0, 0, 0, 0);
  thisWeekStart.setDate(now.getDate() - now.getDay());

  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);

  return date >= lastWeekStart && date < thisWeekStart;
}

function formatHistoryRelative(ms: number) {
  const date = new Date(ms);
  const now = new Date();
  if (isYesterday(date, now)) return 'yesterday';
  if (isLastWeek(date, now)) return 'last week';
  return formatRelativeTimestamp(date);
}

function UserName(props: { userId: string }) {
  const { firstName, fullName } = useDisplayNameParts(
    tryMacroId(props.userId),
    {
      emailFallback: 'local-part',
    }
  );
  return <>{firstName() || fullName() || userLabel(props.userId)}</>;
}

function UserList(props: { userIds: readonly string[] }) {
  return (
    <For each={props.userIds}>
      {(userId, index) => (
        <>
          <Show when={index() > 0}>
            {index() === props.userIds.length - 1 ? ' and ' : ', '}
          </Show>
          <UserName userId={userId} />
        </>
      )}
    </For>
  );
}

export function HistorySessionList(props: HistorySessionListProps) {
  const rows = createMemo<HistorySessionRow[]>(() =>
    [...props.sessions]
      .sort((a, b) => b.endMs - a.endMs || b.startMs - a.startMs)
      .map((session) => ({
        id: `${session.userId}:${session.startMs}:${session.endMs}`,
        userIds: [session.userId],
        startMs: session.startMs,
        endMs: session.endMs,
        count: session.count,
      }))
  );

  const selectedMs = () => props.selectedAt()?.getTime() ?? null;

  return (
    <Show when={rows().length > 0}>
      <div class="mt-3 min-w-0 border-edge-muted border-t pt-3">
        <div class="max-h-43 space-y-1 overflow-y-auto pr-1">
          <For each={rows()}>
            {(row) => {
              const isSelected = () => selectedMs() === row.endMs;
              const edits = () =>
                `${row.count} ${row.count === 1 ? 'edit' : 'edits'}`;
              return (
                <button
                  type="button"
                  class={cn(
                    'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    isSelected() && 'bg-active text-ink'
                  )}
                  onClick={() => props.onSelect(new Date(row.endMs))}
                >
                  <span
                    class="size-2 shrink-0 rounded-full"
                    style={{
                      'background-color': userColor(row.userIds[0] ?? ''),
                    }}
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-ink text-xs">
                      <UserList userIds={row.userIds} /> edited{' '}
                      {formatHistoryRelative(row.endMs)}
                    </span>
                    <span class="block truncate text-ink-muted text-[11px]">
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
