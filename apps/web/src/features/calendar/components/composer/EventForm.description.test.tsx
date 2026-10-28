/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createMemo, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@components/app/split-layout/split-router/mention-links', () => ({
  useMacroMentionLinkResolver: () => () => undefined,
}));
// The description's typeahead menus need app providers this test is not
// about; the editor itself is real.
vi.mock('@core/component/LexicalMarkdown/component/menu/MentionsMenu', () => ({
  MentionsMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/EmojiMenu', () => ({
  EmojiMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/SnippetsMenu', () => ({
  SnippetsMenu: () => null,
}));

import { createCalendarEventFormController } from './create-calendar-event-form-controller';
import { EventForm } from './EventForm';
import type {
  EventEditorCalendarOption,
  EventEditorDisabledFields,
} from './event-form-model';

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Reports each observed element once, which is how the editor learns it is mounted. */
class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    queueMicrotask(() => this.callback([], this));
  }
  unobserve() {}
  disconnect() {}
}

const CALENDAR: EventEditorCalendarOption = {
  id: 'work-calendar',
  label: 'Work',
  color: '#123456',
};

const LOCKED_DETAILS: EventEditorDisabledFields = {
  calendar: true,
  title: true,
  start: true,
  end: true,
  allDay: true,
  recurrence: true,
  location: true,
  description: true,
  conference: true,
};

/** Renders the form with the real description editor. */
function showForm(initiallyLocked: boolean) {
  const [locked, setLocked] = createSignal(initiallyLocked);
  let controller!: ReturnType<typeof createCalendarEventFormController>;
  render(() => {
    const calendarOptions = createMemo(() => [CALENDAR]);
    controller = createCalendarEventFormController({
      initialValue: {
        title: 'Customer demo',
        allDay: false,
        start: '2030-01-01T12:00',
        end: '2030-01-01T13:00',
        recurrenceLines: [],
        guests: '',
        location: '',
        description: 'Agenda',
        conference: 'none',
        calendarId: CALENDAR.id,
      },
      isEdit: true,
      calendarOptions,
      guestOptions: () => [],
    });
    return (
      <EventForm
        controller={controller}
        macroCallsEnabled={false}
        isEdit
        disabledFields={locked() ? LOCKED_DETAILS : { calendar: true }}
        detailsReadOnlyReason={
          locked() ? 'Only the organizer can change this event.' : undefined
        }
        pending={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
  });
  return { controller: () => controller, setLocked };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // jsdom lays nothing out; Lexical measures the caret to keep it in view.
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('IntersectionObserver', ObserverStub);
  vi.stubGlobal('scrollTo', vi.fn() as unknown as typeof window.scrollTo);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('takes typing into an unlocked description', async () => {
  const user = userEvent.setup();
  const form = showForm(false);
  const description = await screen.findByLabelText('Description');

  await user.click(description);
  await user.keyboard(' and notes');

  await waitFor(() =>
    expect(form.controller().state().description).toContain('notes')
  );
});

it('refuses typing into a locked description', async () => {
  const user = userEvent.setup();
  const form = showForm(true);
  const description = await screen.findByLabelText('Description');

  expect(description.getAttribute('contenteditable')).toBe('false');
  await user.click(description);
  await user.keyboard(' and notes');

  expect(description.textContent).toBe('Agenda');
  expect(form.controller().state().description).toBe('Agenda');
  expect(form.controller().isDirty()).toBe(false);
});

it('shows the event’s description again when its details lock after an edit', async () => {
  const user = userEvent.setup();
  const form = showForm(false);
  await user.click(await screen.findByLabelText('Description'));
  await user.keyboard(' and notes');
  await waitFor(() =>
    expect(form.controller().state().description).toContain('notes')
  );

  form.controller().resetDetails();
  form.setLocked(true);

  const description = await screen.findByLabelText('Description');
  await waitFor(() => expect(description.textContent).toBe('Agenda'));
  expect(description.getAttribute('contenteditable')).toBe('false');
  expect(form.controller().isDirty()).toBe(false);
});
