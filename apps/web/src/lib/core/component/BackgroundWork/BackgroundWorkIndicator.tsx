import { Spinner, Surface } from '@ui';
import { cn } from '@ui/utils/classname';
import { Index, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { type BackgroundWorkSummary, backgroundWork } from './backgroundWork';

function Pill(props: { work: BackgroundWorkSummary }) {
  return (
    <Surface
      hideBorder
      role="status"
      class="pointer-events-auto flex size-auto min-w-0 max-w-sm rounded-full glass bg-toast text-sm text-ink"
    >
      {/* A summary that can be opened is a button; the rest only say. */}
      <Dynamic
        component={props.work.onOpen ? 'button' : 'div'}
        type={props.work.onOpen ? 'button' : undefined}
        class="flex min-w-0 items-center gap-2 rounded-full px-3 py-1.5 text-left outline-none focus-visible:ring-2"
        onClick={() => props.work.onOpen?.()}
      >
        <Spinner size="sm" decorative />
        {/* The label says what is under way; a long detail gives way first. */}
        <span class="shrink-0 whitespace-nowrap font-medium">
          {props.work.label}
        </span>
        <Show when={props.work.detail}>
          <span class="min-w-0 truncate text-ink-muted">
            {props.work.detail}
          </span>
        </Show>
      </Dynamic>
    </Surface>
  );
}

/**
 * A compact pill for each piece of work under way in the background, such
 * as a routine drafting after its dialog closed. Renders nothing when there
 * is none, so it adds no gap to the stack it sits in.
 */
export function BackgroundWorkIndicator(props: { align: 'end' | 'center' }) {
  return (
    <Show when={backgroundWork().length > 0}>
      <div
        class={cn(
          'flex flex-col gap-2',
          props.align === 'end' ? 'items-end' : 'items-center'
        )}
      >
        <Index each={backgroundWork()}>
          {(work) => <Pill work={work()} />}
        </Index>
      </div>
    </Show>
  );
}
