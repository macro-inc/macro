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

function setup(conference: EventEditorConferenceChoice = 'none', url?: string) {
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
        allowMacroCall
        macroCallUrl={url}
        pending={false}
        onCancel={vi.fn()}
        onSubmit={submit}
      />
    );
  });
  return submit;
}

describe('event composer toggles', () => {
  it('keeps both toggles local until the event is submitted', () => {
    const submit = setup();
    fireEvent.click(screen.getByRole('switch', { name: 'Macro call' }));
    fireEvent.click(screen.getByRole('switch', { name: 'All day' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Join Macro call' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        macroCall: true,
        time: expect.objectContaining({ kind: 'allDay' }),
      }),
      undefined
    );
  });

  it('restores existing conferencing when the call toggle is turned back off', () => {
    const submit = setup('google_meet');
    const toggle = screen.getByRole('switch', { name: 'Macro call' });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(submit.mock.calls[0][0].macroCall).toBeUndefined();
    expect(submit.mock.calls[0][0].conference).toBe('google_meet');
  });

  it('shows the saved call URL and removes it from the draft when toggled off', () => {
    const url = 'https://macro.com/app/meet/8m8mGwzHqxzYjeIN5-nJRquRbzyTEhGF';
    const submit = setup('macro_call', url);
    expect(
      screen.getByRole('link', { name: 'Join Macro call' }).getAttribute('href')
    ).toBe(url);
    fireEvent.click(screen.getByRole('switch', { name: 'Macro call' }));
    expect(screen.queryByRole('link', { name: 'Join Macro call' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(submit.mock.calls[0][0].macroCall).toBeUndefined();
  });
});
