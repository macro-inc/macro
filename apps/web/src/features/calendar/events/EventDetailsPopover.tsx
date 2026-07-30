import { Popover } from '@kobalte/core/popover';
import CloseIcon from '@phosphor/x.svg';
import { Layer } from '@ui';
import { createEffect } from 'solid-js';
import { EventDetails } from './EventDetails';
import type { CalendarEvent, CalendarTimeFormat } from './types';

interface EventDetailsPopoverProps {
  anchor: HTMLElement | undefined;
  event: CalendarEvent;
  open: boolean;
  timeFormat: CalendarTimeFormat;
  onOpenChange: (open: boolean) => void;
}

/** Anchors read-only event details to a rendered event on narrow layouts. */
export function EventDetailsPopover(props: EventDetailsPopoverProps) {
  let lastAnchor: HTMLElement | undefined;

  createEffect(() => {
    if (props.anchor) lastAnchor = props.anchor;
  });

  return (
    <Popover
      anchorRef={() => props.anchor}
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="right-start"
      gutter={8}
      flip
      slide
    >
      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="z-modal max-w-[calc(100vw-2rem)] outline-none"
            onCloseAutoFocus={(event) => {
              const shouldRestoreFocus = !event.defaultPrevented;
              event.preventDefault();
              if (shouldRestoreFocus && lastAnchor?.isConnected) {
                lastAnchor.focus();
              }
            }}
          >
            <Popover.Arrow class="fill-surface" />
            <div class="relative w-80 max-w-full rounded-xl bg-surface p-3 pr-10 text-ink shadow-menu ring ring-edge-muted">
              <Popover.Title class="sr-only">{props.event.title}</Popover.Title>
              <EventDetails event={props.event} timeFormat={props.timeFormat} />
              <Popover.CloseButton
                aria-label="Close event details"
                class="absolute right-2 top-2 flex size-6 items-center justify-center rounded-md text-ink-extra-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring focus-visible:ring-accent"
              >
                <CloseIcon class="size-3.5" />
              </Popover.CloseButton>
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
