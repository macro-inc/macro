import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import { Popover } from '@kobalte/core/popover';
import CloseIcon from '@phosphor/x.svg';
import { Button, Layer } from '@ui';
import { type Accessor, createMemo, Show } from 'solid-js';
import { EventAttendeesSection, EventDetails } from './EventDetails';
import type { CalendarEvent, CalendarTimeFormat } from './types';

interface SelectedEventDetailsProps {
  anchor: Accessor<HTMLElement | undefined>;
  event: Accessor<CalendarEvent | undefined>;
  timeFormat: Accessor<CalendarTimeFormat>;
  onClose: () => void;
}

/** Renders selected event details in a mobile drawer or anchored popover. */
export function SelectedEventDetails(props: SelectedEventDetailsProps) {
  const popoverSelection = createMemo(() => {
    const event = props.event();
    const anchor = props.anchor();

    return event && anchor ? { anchor, event } : undefined;
  });

  return (
    <Show
      when={isMobile()}
      fallback={
        <Show keyed when={popoverSelection()}>
          {(selected) => (
            <EventDetailsPopover
              anchor={selected.anchor}
              event={selected.event}
              timeFormat={props.timeFormat()}
              onOpenChange={(open) => {
                if (!open) props.onClose();
              }}
            />
          )}
        </Show>
      }
    >
      <Show keyed when={props.event()}>
        {(event) => (
          <EventDetailsDrawer
            event={event}
            timeFormat={props.timeFormat()}
            onOpenChange={(open) => {
              if (!open) props.onClose();
            }}
          />
        )}
      </Show>
    </Show>
  );
}

interface EventDetailsOverlayProps {
  event: CalendarEvent;
  timeFormat: CalendarTimeFormat;
  onOpenChange: (open: boolean) => void;
}

function EventDetailsDrawer(props: EventDetailsOverlayProps) {
  return (
    <MobileDrawer
      side="bottom"
      open
      onOpenChange={props.onOpenChange}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content
          aria-label={props.event.title}
          class="overflow-hidden"
        >
          <MobileDrawer.Handle />
          <div class="min-h-0 flex-1 overflow-y-auto">
            <div class="px-3 pb-3">
              <EventDetails event={props.event} timeFormat={props.timeFormat} />
            </div>
            <EventAttendeesSection attendees={props.event.attendees} />
          </div>
          <MobileDrawer.Close
            as={Button}
            aria-label="Close event details"
            variant="ghost"
            size="icon-sm"
            class="absolute right-2 top-2 rounded-full text-ink-muted"
          >
            <CloseIcon class="size-3" />
          </MobileDrawer.Close>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

interface EventDetailsPopoverProps extends EventDetailsOverlayProps {
  anchor: HTMLElement;
}

/** Anchors read-only event details to a rendered calendar event. */
function EventDetailsPopover(props: EventDetailsPopoverProps) {
  return (
    <Popover
      anchorRef={() => props.anchor}
      open
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
            onInteractOutside={(event) => {
              // FullCalendar selects on click (pointer release), so dismissing on
              // pointer down would briefly close the popover before reopening it.
              const target = event.detail.originalEvent.target;
              if (
                target instanceof Element &&
                target.closest('.fc-event') !== null
              ) {
                event.preventDefault();
              }
            }}
            onCloseAutoFocus={(event) => {
              const shouldRestoreFocus = !event.defaultPrevented;
              event.preventDefault();
              if (shouldRestoreFocus && props.anchor.isConnected) {
                props.anchor.focus();
              }
            }}
          >
            <Popover.Arrow class="fill-surface" />
            <div class="relative w-fit min-w-[min(20rem,calc(100vw-2rem))] max-w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-surface text-ink shadow-menu ring ring-edge-muted">
              <Popover.Title class="sr-only">{props.event.title}</Popover.Title>
              <div class="p-3">
                <EventDetails
                  event={props.event}
                  timeFormat={props.timeFormat}
                />
              </div>
              <EventAttendeesSection attendees={props.event.attendees} />
              <Popover.CloseButton
                as={Button}
                aria-label="Close event details"
                variant="ghost"
                size="icon-sm"
                class="absolute right-2 top-2 rounded-md text-ink-muted"
              >
                <CloseIcon class="size-3" />
              </Popover.CloseButton>
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
