/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalendarEventFormController } from './create-calendar-event-form-controller';
import { EventForm } from './EventForm';
import { defaultEditorInitialValues } from './event-form-model';

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
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: () => null,
}));
vi.mock('./EventPropertyPills', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./EventPropertyPills')>()),
  EventComposerCalendarPill: () => null,
  EventComposerDeclineMessagePill: () => null,
  EventComposerDeclinePill: () => null,
  EventComposerGuestsPill: () => null,
  EventComposerKindPill: () => null,
  EventComposerLocationPill: () => null,
  EventComposerRecurrencePill: () => null,
  EventComposerRemindersPill: () => null,
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class WebSocketStub {
  close() {}
  send() {}
  addEventListener() {}
  removeEventListener() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ObserverStub);
  vi.stubGlobal('IntersectionObserver', ObserverStub);
  vi.stubGlobal('WebSocket', WebSocketStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(
  conference = defaultEditorInitialValues().conference,
  macroCallsEnabled = true
) {
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
        macroCallsEnabled={macroCallsEnabled}
        pending={false}
        onCancel={vi.fn()}
        onSubmit={submit}
      />
    );
  });
  return submit;
}

describe('event composer', () => {
  it('submits the default Macro call choice without a separate toggle', () => {
    const submit = setup();
    expect(screen.queryByRole('switch', { name: 'Macro call' })).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Planning', conferenceChoice: 'macro' }),
      undefined
    );
  });
  it('preserves provider conferencing', () => {
    const submit = setup('google_meet');
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(submit.mock.calls[0][0].conference).toBe('google_meet');
  });

  it('offers only supported providers when its host cannot attach Macro calls', async () => {
    const user = userEvent.setup();
    const submit = setup('none', false);
    await user.click(
      screen.getByRole('button', { name: /Video conferencing/ })
    );
    expect(screen.queryByRole('option', { name: 'Macro call' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'Google Meet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
    expect(submit.mock.calls[0][0].conferenceChoice).toBe('google_meet');
    expect(submit.mock.calls[0][0].conference).toBe('google_meet');
  });
});
