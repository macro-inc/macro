import { onElementConnect } from '@core/util/onElementConnect';
import { cn } from '@ui';
import { createSignal, onCleanup } from 'solid-js';
import { EventFormParts } from './event-form-parts';
import { createEventForm, type EventFormProps } from './event-form-state';

/** The create/edit event form in the touch bottom sheet. */
export function MobileEventForm(props: EventFormProps) {
  const form = createEventForm(props);

  // The keyboard leaves too little room for the whole form, so the header
  // pins to the top of the sheet's scroll to keep the save action in reach.
  // It only takes a background while pinned over content; at rest it would
  // show as a band against the glass sheet.
  const [headerPinned, setHeaderPinned] = createSignal(false);
  const observeHeader = (header: HTMLElement) => {
    onElementConnect(header, () => {
      const observer = new IntersectionObserver(
        ([entry]) => setHeaderPinned(!!entry && entry.intersectionRatio < 1),
        {
          root: header.closest('[data-drawer-scroll-body]'),
          // Pinned at -1px, the header's top pixel leaves the scroll viewport.
          threshold: 1,
        }
      );
      observer.observe(header);
      onCleanup(() => observer.disconnect());
    });
  };

  return (
    <EventFormParts.Root form={form} class={props.class}>
      <div
        ref={observeHeader}
        class={cn(
          // -mt-4 and pt-4 offset the host's padding so the header rests
          // where it would have been.
          'sticky -top-px z-1 -mx-4 -mt-4 -mb-3 flex shrink-0 items-center justify-end px-4 pt-4 pb-3',
          headerPinned() && 'bg-menu'
        )}
      >
        <EventFormParts.Submit />
      </div>
      <div class="flex min-w-0 flex-col gap-6">
        <div class="flex min-w-0 flex-col gap-1">
          <EventFormParts.When />
          <EventFormParts.Title />
          <EventFormParts.Description />
        </div>
        <div class="flex min-w-0 flex-col gap-2">
          <div class="-mx-4 overflow-x-auto overscroll-x-contain scrollbar-hidden">
            <EventFormParts.Properties class="w-max flex-nowrap px-4" />
          </div>
          <EventFormParts.RecurrenceScopeReason />
        </div>
        <EventFormParts.GuestPolicy />
        <EventFormParts.Notices />
        <EventFormParts.CustomRecurrence />
      </div>
      <EventFormParts.SaveError />
      <EventFormParts.EditScope />
    </EventFormParts.Root>
  );
}
