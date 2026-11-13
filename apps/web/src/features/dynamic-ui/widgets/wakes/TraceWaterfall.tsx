import { usePending } from '@app/observability/flow';
import { useAgentWakeTraceQuery } from '@queries/agent-wakes/wakes';
import type { WakeTraceSpan } from '@service-agent-harness/agent-wakes';
import { cn } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { TEXT } from '../../tokens';
import {
  formatCost,
  formatDuration,
  type WaterfallRow,
  waterfall,
} from './format';
import { Notice } from './Notice';

/**
 * One wake's model session as a waterfall: a row per prompt, turn and tool
 * call, its bar placed and sized on the session's time axis. A row opens to
 * what was said, thought, called and returned.
 */
export function TraceWaterfall(props: { agentId: string; wakeId: string }) {
  const trace = useAgentWakeTraceQuery(
    () => props.agentId,
    () => props.wakeId
  );
  usePending('pane.trace', () => trace.isPending);

  return (
    <Switch>
      <Match when={trace.isPending}>
        <div class={cn('px-1 py-2 text-xs', TEXT.secondary)}>
          Loading trace…
        </div>
      </Match>
      <Match when={trace.isError}>
        <Notice>The trace couldn't be loaded.</Notice>
      </Match>
      <Match when={trace.isSuccess && trace.data === null}>
        <Notice>No trace for this wake, or you don't have access to it.</Notice>
      </Match>
      <Match when={trace.data}>
        {(loaded) => {
          const laid = () => waterfall(loaded());
          return (
            <div class="flex min-w-0 flex-col gap-2">
              <div
                class={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs',
                  TEXT.secondary
                )}
              >
                <Show when={loaded().title}>
                  {(title) => (
                    <span class="text-ink font-medium">{title()}</span>
                  )}
                </Show>
                <span>{loaded().model ?? loaded().source}</span>
                <span>{formatDuration(laid().total)}</span>
                <Show when={loaded().costUsd ?? undefined}>
                  {(cost) => <span>{formatCost(cost())}</span>}
                </Show>
                <Show when={loaded().live}>
                  <span class="text-accent">live</span>
                </Show>
              </div>
              <ol class="flex min-w-0 flex-col" aria-label="Trace">
                <For each={laid().rows}>
                  {(row) => <SpanRow row={row} total={laid().total} />}
                </For>
              </ol>
            </div>
          );
        }}
      </Match>
    </Switch>
  );
}

function SpanRow(props: { row: WaterfallRow; total: number }) {
  const [open, setOpen] = createSignal(false);
  const left = () => (props.row.offset / props.total) * 100;
  const width = () => Math.max(0.5, (props.row.duration / props.total) * 100);
  const color = () =>
    props.row.error
      ? 'bg-failure'
      : props.row.span.kind === 'turn'
        ? 'bg-accent'
        : props.row.span.kind === 'tool'
          ? 'bg-ink-muted'
          : 'bg-edge';

  return (
    <li class="border-edge-muted min-w-0 border-b last:border-b-0">
      <button
        type="button"
        class="hover:bg-hover flex w-full min-w-0 items-center gap-2 px-1 py-1 text-left text-xs"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span
          class={cn(
            'w-28 shrink-0 truncate sm:w-40',
            props.row.span.kind === 'tool' ? 'pl-3 font-mono' : 'font-medium',
            props.row.error ? 'text-failure' : TEXT.primary
          )}
        >
          {props.row.label}
        </span>
        <span class="relative h-2 min-w-0 flex-1">
          <span
            class={cn(
              'absolute top-0 h-2 rounded-sm',
              color(),
              props.row.running && 'animate-pulse'
            )}
            style={{ left: `${left()}%`, width: `${width()}%` }}
          />
        </span>
        <span
          class={cn('w-12 shrink-0 text-right tabular-nums', TEXT.tertiary)}
        >
          {props.row.running
            ? '…'
            : props.row.duration > 0
              ? formatDuration(props.row.duration)
              : ''}
        </span>
      </button>
      <Show when={open()}>
        <SpanDetail span={props.row.span} />
      </Show>
    </li>
  );
}

function Block(props: { label: string; text: string }) {
  return (
    <Show when={props.text}>
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class={cn('text-[11px] uppercase', TEXT.tertiary)}>
          {props.label}
        </span>
        <pre class="bg-surface max-h-64 min-w-0 overflow-auto rounded p-2 text-xs whitespace-pre-wrap break-words">
          {props.text}
        </pre>
      </div>
    </Show>
  );
}

function SpanDetail(props: { span: WakeTraceSpan }) {
  return (
    <div class="flex min-w-0 flex-col gap-2 px-1 pb-2">
      {(() => {
        const span = props.span;
        if (span.kind === 'user')
          return <Block label="Said" text={span.text} />;
        if (span.kind === 'turn')
          return (
            <>
              <Block label="Thinking" text={span.thinking} />
              <Block label="Said" text={span.text} />
              <span class={cn('text-xs', TEXT.tertiary)}>
                {span.tokens.input} in · {span.tokens.output} out ·{' '}
                {span.tokens.cacheRead} cached
              </span>
            </>
          );
        return (
          <>
            <Block label="Input" text={JSON.stringify(span.input, null, 2)} />
            <Block
              label={span.error ? 'Error' : 'Result'}
              text={span.result ?? ''}
            />
          </>
        );
      })()}
    </div>
  );
}
