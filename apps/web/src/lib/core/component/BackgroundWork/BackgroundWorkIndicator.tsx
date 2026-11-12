import { Spinner, Surface } from '@ui';
import { cn } from '@ui/utils/classname';
import { Index, type JSX, Show } from 'solid-js';
import { type BackgroundWorkSummary, backgroundWork } from './backgroundWork';

const PILL = 'flex min-w-0 items-center gap-2 rounded-full px-3 py-1.5';

function Pill(props: { work: BackgroundWorkSummary }) {
  const content = (): JSX.Element => (
    <>
      <Spinner size="sm" decorative />
      <span class="min-w-0 truncate font-medium">{props.work.label}</span>
      <Show when={props.work.detail}>
        <span class="shrink-0 text-ink-muted">{props.work.detail}</span>
      </Show>
    </>
  );
  return (
    <Surface
      hideBorder
      role="status"
      class="pointer-events-auto flex size-auto max-w-xs rounded-full glass bg-toast text-sm text-ink"
    >
      <Show
        when={props.work.onOpen}
        fallback={<div class={PILL}>{content()}</div>}
      >
        {(open) => (
          <button
            type="button"
            class={cn(PILL, 'text-left outline-none focus-visible:ring-2')}
            onClick={() => open()()}
          >
            {content()}
          </button>
        )}
      </Show>
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
