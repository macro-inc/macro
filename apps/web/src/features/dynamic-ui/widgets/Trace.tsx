import { t } from '@app/lib/i18n';
import { cn, Dialog } from '@ui';
import { createSignal, Show } from 'solid-js';
import { TEXT } from '../tokens';
import type { WidgetOf } from '../view';
import { AgentDashboardsGate } from './wakes/Gate';
import { TraceWaterfall } from './wakes/TraceWaterfall';

export type TraceProps = Omit<WidgetOf<'trace'>, 'type'>;

/**
 * One wake's turns and tool calls as a waterfall. A phone-width pane has no
 * room for the time axis, so there it is a button that opens the waterfall
 * full screen.
 */
export function Trace(props: TraceProps) {
  const [open, setOpen] = createSignal(false);
  const title = () => props.title ?? t('dynamicUi.traceTitle');

  return (
    <AgentDashboardsGate>
      <section class="flex w-full min-w-0 flex-col gap-2" aria-label={title()}>
        <div class="hidden min-w-0 flex-col gap-2 sm:flex">
          <Show when={props.title}>
            {(text) => <h3 class="text-ink text-sm font-semibold">{text()}</h3>}
          </Show>
          <TraceWaterfall agentId={props.agentId} wakeId={props.wakeId} />
        </div>
        <button
          type="button"
          class="border-edge-muted hover:bg-hover flex items-center justify-between rounded border px-3 py-2 text-left text-sm sm:hidden"
          onClick={() => setOpen(true)}
        >
          <span class="text-ink font-medium">{title()}</span>
          <span class={cn('text-xs', TEXT.secondary)}>
            {t('dynamicUi.traceOpen')}
          </span>
        </button>
        <Dialog open={open()} onOpenChange={setOpen} fullscreen>
          <div class="bg-dialog flex h-full min-h-0 flex-col">
            <div class="border-edge-muted flex items-center justify-between border-b px-4 py-3">
              <Dialog.Title class="text-ink text-sm font-semibold">
                {title()}
              </Dialog.Title>
              <button
                type="button"
                class={cn('text-sm', TEXT.secondary)}
                onClick={() => setOpen(false)}
              >
                {t('dynamicUi.traceClose')}
              </button>
            </div>
            <div class="min-h-0 flex-1 overflow-auto px-3 py-2">
              <Show when={open()}>
                <TraceWaterfall agentId={props.agentId} wakeId={props.wakeId} />
              </Show>
            </div>
          </div>
        </Dialog>
      </section>
    </AgentDashboardsGate>
  );
}
