import { Popover } from '@kobalte/core/popover';
import CloseIcon from '@phosphor/x.svg';
import { Layer } from '@ui';
import { createEffect } from 'solid-js';
import { EventEditor } from './EventEditor';
import type { CalendarEvent, CalendarSource } from './types';

interface EventEditorPopoverProps {
  anchor: HTMLElement | undefined;
  event: CalendarEvent;
  open: boolean;
  sources: CalendarSource[];
  onCancel: () => void;
  onSave: (event: CalendarEvent) => void;
}

/** Anchors the new-event editor to its drawn event on narrow layouts. */
export function EventEditorPopover(props: EventEditorPopoverProps) {
  let lastAnchor: HTMLElement | undefined;
  let calendarHost: HTMLElement | undefined;

  createEffect(() => {
    if (!props.anchor) return;
    lastAnchor = props.anchor;
    calendarHost =
      props.anchor.closest<HTMLElement>('.calendar-view-host') ?? undefined;
  });

  return (
    <Popover
      anchorRef={() => props.anchor}
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
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
              if (!shouldRestoreFocus) return;
              if (lastAnchor?.isConnected) lastAnchor.focus();
              else calendarHost?.focus();
            }}
          >
            <Popover.Arrow class="fill-surface" />
            <div class="relative w-80 max-w-full rounded-xl bg-surface p-3 pr-10 text-ink shadow-menu ring ring-edge-muted">
              <Popover.Title class="sr-only">Create event</Popover.Title>
              <EventEditor
                event={props.event}
                sources={props.sources}
                onCancel={props.onCancel}
                onSave={props.onSave}
              />
              <Popover.CloseButton
                aria-label="Cancel new event"
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
