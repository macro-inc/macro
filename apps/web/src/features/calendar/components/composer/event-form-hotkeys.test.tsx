/**
 * @vitest-environment jsdom
 */

import { IS_MAC } from '@core/constant/isMac';
import {
  attachGlobalDOMScope,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createMemo } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@components/app/split-layout/split-router/mention-links', () => ({
  useMacroMentionLinkResolver: () => () => undefined,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/MarkdownTextarea',
  () => ({ MarkdownTextarea: () => null })
);
vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: () => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Search for guests');
    return input;
  },
}));

import { createCalendarEventFormController } from './create-calendar-event-form-controller';
import { EventForm } from './EventForm';
import type {
  EventEditorCalendarOption,
  EventEditorSubmitValues,
} from './event-form-model';

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const WORK_CALENDAR: EventEditorCalendarOption = {
  id: 'work-calendar',
  provider: 'google',
  label: 'Work',
  color: '#123456',
  defaultReminders: [],
  isPrimary: true,
};

const MOD = IS_MAC ? 'Meta' : 'Control';

/** The composer as its split hosts it: the form inside the split's own hotkey scope. */
function showComposer(title: string) {
  const onSubmit = vi.fn<(values: EventEditorSubmitValues) => void>();
  render(() => {
    useHotKeyRoot();
    const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope(
      'event-composer-test',
      true
    );
    const controller = createCalendarEventFormController({
      initialValue: {
        title,
        allDay: false,
        start: '2030-01-01T12:00',
        end: '2030-01-01T13:00',
        recurrenceLines: [],
        guests: 'alice@example.com',
        location: '',
        description: '',
        conference: 'none',
        calendarId: WORK_CALENDAR.id,
      },
      calendarOptions: createMemo(() => [WORK_CALENDAR]),
      guestOptions: () => [],
    });
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div ref={attachHotkeys}>
          <EventForm
            controller={controller}
            hotkeyScope={hotkeyScope}
            macroCallsEnabled={false}
            pending={false}
            onCancel={vi.fn()}
            onSubmit={onSubmit}
          />
        </div>
      </div>
    );
  });
  return onSubmit;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', ObserverStub);
  vi.stubGlobal('IntersectionObserver', ObserverStub);
  vi.stubGlobal('scrollTo', vi.fn() as unknown as typeof window.scrollTo);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setActiveScope('global');
});

it('sets the time and creates the event from the keyboard alone', async () => {
  const user = userEvent.setup();
  const onSubmit = showComposer('Customer demo');
  await user.click(screen.getByLabelText('Title'));

  await user.keyboard(`{${MOD}>}{Shift>}s{/Shift}{/${MOD}}`);
  expect(document.activeElement).toBe(
    screen.getByRole('combobox', { name: 'event start time' })
  );
  // Typed but not yet committed: saving commits it first.
  await user.keyboard('15:00');
  await user.keyboard(`{${MOD}>}{Enter}{/${MOD}}`);

  expect(onSubmit).toHaveBeenCalledTimes(1);
  const values = onSubmit.mock.calls[0][0];
  expect(values.title).toBe('Customer demo');
  expect(values.guestEmails).toEqual(['alice@example.com']);
  expect(values.time).toMatchObject({
    kind: 'timed',
    startsAt: new Date('2030-01-01T15:00').toISOString(),
    endsAt: new Date('2030-01-01T16:00').toISOString(),
  });
});

it('jumps to the end time, guests and location from the title', async () => {
  const user = userEvent.setup();
  showComposer('Customer demo');
  await user.click(screen.getByLabelText('Title'));

  await user.keyboard(`{${MOD}>}{Shift>}e{/Shift}{/${MOD}}`);
  expect(document.activeElement).toBe(
    screen.getByRole('combobox', { name: 'event end time' })
  );

  await user.keyboard(`{${MOD}>}{Shift>}g{/Shift}{/${MOD}}`);
  expect(await screen.findByLabelText('Search for guests')).toBeTruthy();
  await user.keyboard('{Escape}');

  await user.keyboard(`{${MOD}>}{Shift>}l{/Shift}{/${MOD}}`);
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Location' })
    )
  );
});

it('does not save an event without a title', async () => {
  const user = userEvent.setup();
  const onSubmit = showComposer('');
  await user.click(screen.getByLabelText('Title'));

  await user.keyboard(`{${MOD}>}{Enter}{/${MOD}}`);

  expect(onSubmit).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByLabelText('Title'));
});
