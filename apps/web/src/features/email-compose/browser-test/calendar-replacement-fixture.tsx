import { Button } from '@ui';
import { createSignal } from 'solid-js';
import { EventReplacementDialog } from '../../calendar/components/EventReplacementDialog';
import type { EventReplacementSource } from '../../calendar/context/event-replacement-source';
import type { EventReplacementPreview } from '../../calendar/core/event-replacement';
import { createEventReplacement } from '../../calendar/primitives/create-event-replacement';

export function CalendarReplacementFixture() {
  const [actions, setActions] = createSignal<string[]>([]);
  const preview: EventReplacementPreview = {
    operationId: 'saved-operation',
    status: 'needs_confirmation',
    title: 'Weekly review',
    startsAt: '2026-11-02T17:00:00Z',
    endsAt: '2026-11-02T18:00:00Z',
    allDay: false,
    attendeeCount: 3,
    isSeries: true,
    removeConference: true,
    completedSteps: 0,
    totalSteps: 4,
    providerUrl: 'https://outlook.office.com/calendar/item/original',
  };
  const source: EventReplacementSource = {
    async prepare() {
      setActions((v) => [...v, 'preview']);
      return preview;
    },
    async confirm(id) {
      setActions((v) => [...v, `confirm:${id}`]);
      throw new Error(
        'The response was interrupted. Check progress before taking another action.'
      );
    },
    async status(id) {
      setActions((v) => [...v, `check:${id}`]);
      return { ...preview, status: 'complete', completedSteps: 4 };
    },
    async discard(id) {
      setActions((v) => [...v, `discard:${id}`]);
    },
  };
  const controller = createEventReplacement(source, () => ({
    eventId: 'event',
    recurrenceId: '2026-11-02T17:00:00Z',
  }));
  return (
    <main class="min-h-screen bg-surface p-4 text-ink">
      <Button onClick={() => controller.setOpen(true)}>Replace event…</Button>
      <EventReplacementDialog
        controller={controller}
        hasConference
        hasOccurrence
        recurring
        onOpenUrl={() => {}}
        onDone={() => controller.setOpen(false)}
      />
      <output data-testid="replacement-actions">{actions().join(',')}</output>
    </main>
  );
}
