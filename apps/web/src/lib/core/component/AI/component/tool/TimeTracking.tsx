import { ItemPreview } from '@core/component/ItemPreview';
import Timer from '@icon/system/regular/timer.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { createSignal, For, type JSX, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

type TimeEntry = NamedTool<'LogTime', 'response'>['data']['entry'];

/** `4h 35m`, `45m` or `2h`. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** An entry's day as the logger chose it, never shifted by a time zone. */
function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function readStatus(
  read: NamedTool<'ReadTimeEntries', 'response'>['data'] | undefined
): string | undefined {
  if (!read) return undefined;
  if (read.entries.length === 0) return 'No time logged';
  return `${formatMinutes(read.totalMinutes)} logged`;
}

function TaskPreview(props: { taskId: string }) {
  return (
    <span class="min-w-0 truncate">
      <Suspense>
        <ItemPreview
          class="inline-flex max-w-full align-middle ring-0"
          id={props.taskId}
          type="document"
        />
      </Suspense>
    </span>
  );
}

function EntryRow(props: { entry: TimeEntry }) {
  return (
    <div class="min-w-0 py-1 text-xs">
      <div class="flex min-w-0 items-baseline gap-2">
        <span class="shrink-0 text-ink-muted">
          {formatDay(props.entry.date)}
        </span>
        <span class="shrink-0 text-ink tabular-nums">
          {formatMinutes(props.entry.minutes)}
        </span>
        <span class="min-w-0 truncate text-ink-muted">
          {props.entry.userId.replace(/^macro\|/, '')}
        </span>
      </div>
      <Show when={props.entry.note}>
        {(note) => <p class="break-words text-ink">{note()}</p>}
      </Show>
    </div>
  );
}

function TimeToolCard(props: {
  renderContext: RenderContext['renderContext'];
  status?: string;
  hasResult: boolean;
  children: JSX.Element;
  response?: JSX.Element;
}) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <BaseTool
      type="call"
      icon={Timer}
      renderContext={props.renderContext}
      response={
        props.hasResult && expanded() ? (
          <div class="max-h-96 overflow-y-auto">{props.response}</div>
        ) : undefined
      }
    >
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-1 overflow-hidden">
          {props.children}
        </div>
        <Tool.ResultToggle
          expanded={expanded()}
          onToggle={() => setExpanded((value) => !value)}
          showToggle={props.hasResult}
          status={props.status}
        />
      </div>
    </BaseTool>
  );
}

export const timeTrackingHandlers = {
  LogTime: createToolRenderer({
    name: 'LogTime',
    render: (ctx) => (
      <TimeToolCard
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        status={
          ctx.response
            ? `${formatMinutes(ctx.response.data.totalMinutes)} total`
            : undefined
        }
        response={
          <Show when={ctx.response?.data}>
            {(logged) => (
              <div class="space-y-1">
                <EntryRow entry={logged().entry} />
                <p class="text-xs text-ink-muted">{logged().summary}</p>
              </div>
            )}
          </Show>
        }
      >
        <span class="shrink-0">
          Log{' '}
          <span class="text-ink">{formatMinutes(ctx.tool.data.minutes)}</span>{' '}
          <span class="text-ink-placeholder">·</span>
        </span>
        <TaskPreview taskId={ctx.tool.data.task_id} />
      </TimeToolCard>
    ),
  }),
  ReadTimeEntries: createToolRenderer({
    name: 'ReadTimeEntries',
    render: (ctx) => (
      <TimeToolCard
        renderContext={ctx.renderContext}
        hasResult={!!ctx.response}
        status={readStatus(ctx.response?.data)}
        response={
          <Show when={ctx.response?.data}>
            {(read) => (
              <div>
                <For each={read().entries}>
                  {(entry) => <EntryRow entry={entry} />}
                </For>
                <p class="pt-1 text-xs text-ink-muted">{read().summary}</p>
              </div>
            )}
          </Show>
        }
      >
        <span class="shrink-0">
          Read <span class="text-ink">time logged</span>{' '}
          <span class="text-ink-placeholder">·</span>
        </span>
        <TaskPreview taskId={ctx.tool.data.task_id} />
      </TimeToolCard>
    ),
  }),
};
