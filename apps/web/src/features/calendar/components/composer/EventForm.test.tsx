/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalendarEventFormController } from './create-calendar-event-form-controller';
import { EventForm } from './EventForm';
import {
  defaultEditorInitialValues,
  type EventEditorConferenceChoice,
} from './event-form-model';

vi.mock(
  '@core/component/LexicalMarkdown/component/core/MarkdownTextarea',
  () => ({
    MarkdownTextarea: () => <textarea aria-label="Description" />,
  })
);
vi.mock('./EventDateTimeRangeFields', () => ({
  EventDateTimeRangeFields: () => null,
}));
vi.mock('../../utils/calendar-description', () => ({
  calendarDescriptionToEditorHtml: (value: string) => value,
  exportCalendarDescription: () => '',
}));
vi.mock('./RecurrenceBuilder', () => ({ RecurrenceBuilder: () => null }));
vi.mock('./EventPropertyPills', () => ({
  EventComposerCalendarPill: () => null,
  EventComposerConferencePill: () => null,
  EventComposerDeclineMessagePill: () => null,
  EventComposerDeclinePill: () => null,
  EventComposerGuestsPill: () => null,
  EventComposerKindPill: () => null,
  EventComposerLocationPill: () => null,
  EventComposerRecurrencePill: () => null,
  EventComposerRemindersPill: () => null,
}));

afterEach(cleanup);

function setup(conference: EventEditorConferenceChoice = 'none') {
  const submit = vi.fn();
  render(() => {
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(),
        title: 'Planning',
        conference,
      },
      calendarOptions: () => [
        { id: 'calendar-1', label: 'Calendar', color: '#336699' },
      ],
      guestOptions: () => [],
    });
    return (
      <EventForm
        controller={controller}
        pending={false}
        onCancel={vi.fn()}
        onSubmit={submit}
      />
    );
  });
  return submit;
}

describe('event composer', () => {
  it('submits an event without a separate Macro call option', () => {
    const submit = setup();
    expect(screen.queryByRole('switch', { name: 'Macro call' })).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Planning' }),
      undefined
    );
  });
  it('preserves provider conferencing', () => {
    const submit = setup('google_meet');
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(submit.mock.calls[0][0].conference).toBe('google_meet');
  });
});
