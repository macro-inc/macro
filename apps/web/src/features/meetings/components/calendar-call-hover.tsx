import { HoverCard } from '@core/component/HoverCard';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal, type JSX, Show } from 'solid-js';
import type { CalendarCallItem } from '../core/calendar-calls';

export type CallDetailRenderer = (
  item: CalendarCallItem,
  close: () => void
) => JSX.Element;

export function CalendarCallHover(props: {
  item: CalendarCallItem;
  renderDetails?: CallDetailRenderer;
  children: JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <Show
      when={props.renderDetails && !isTouchDevice()}
      fallback={props.children}
    >
      <HoverCard
        trigger={props.children}
        triggerAs="div"
        triggerAriaLabel={`Preview ${props.item.title}`}
        triggerClass="block w-full"
        open={open()}
        onOpenChange={setOpen}
        openDelay={300}
        closeDelay={300}
        placement="right-start"
        flip
        fitViewport
        overflowPadding={12}
        gutter={8}
        contentClass="w-105 max-w-[calc(100vw-24px)] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl border border-edge-muted bg-panel text-ink shadow-xl"
        content={
          <Show when={open()}>
            {props.renderDetails?.(props.item, () => setOpen(false))}
          </Show>
        }
      />
    </Show>
  );
}
