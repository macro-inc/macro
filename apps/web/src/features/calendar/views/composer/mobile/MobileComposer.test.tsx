import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCalendarEventFormController } from '../../../components/composer/create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../../../components/composer/event-form-model';
import { ComposerRoot } from '../../../components/composer/root/ComposerRoot';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { MobileComposer } from './MobileComposer';

vi.mock('@core/component/LexicalMarkdown/component/menu/MentionsMenu', () => ({
  MentionsMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/EmojiMenu', () => ({
  EmojiMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/SnippetsMenu', () => ({
  SnippetsMenu: () => null,
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 100, 44)
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        const entry = {
          target,
          contentRect: target.getBoundingClientRect(),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        };
        queueMicrotask(() => this.callback([entry], this));
      }
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(
  description = '',
  timeFormat: '12-hour' | '24-hour' = '12-hour'
) {
  const submit = vi.fn();
  const [pending, setPending] = createSignal(false);
  let controller:
    | ReturnType<typeof createCalendarEventFormController>
    | undefined;
  render(() => {
    controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-11T11:00'), false),
        title: 'Review',
        calendarId: 'calendar',
        description,
      },
      calendarOptions: () => [
        { id: 'calendar', label: 'Calendar', color: 'var(--color-blue-ink)' },
      ],
      guestOptions: () => [],
    });
    const model = createCalendarComposer({
      controller,
      get pending() {
        return pending();
      },
      onSubmit: submit,
      timeFormat,
    });
    return (
      <ComposerRoot model={model}>
        <MobileComposer
          scrollElement={() => undefined}
          macroCallsEnabled={false}
        />
      </ComposerRoot>
    );
  });
  if (!controller) throw new Error('Expected controller');
  return { controller, submit, setPending };
}

it('adds location in place, focuses it, and submits through the shared model', async () => {
  const { controller, submit } = setup();
  await userEvent.click(screen.getByRole('button', { name: /^Add location$/ }));
  const location = screen.getByRole('textbox', { name: /^Location$/ });
  await waitFor(() => expect(document.activeElement).toBe(location));
  await userEvent.type(location, 'Meeting room');
  expect(controller.state().location).toBe('Meeting room');
  await userEvent.click(screen.getByRole('button', { name: /^Create event$/ }));
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0][0].location).toBe('Meeting room');
});

it('keeps Enter in the phone title from submitting the form', async () => {
  const { submit } = setup();
  await userEvent.click(screen.getByRole('textbox', { name: /^Title$/ }));
  await userEvent.keyboard('{Enter}Notes');
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: /^Title$/ })).toHaveProperty(
    'value',
    'Review\nNotes'
  );
});

it('keeps a populated field mounted when the user clears it', async () => {
  const { controller } = setup();
  controller.setField('location', 'Meeting room');
  const input = screen.getByRole('textbox', { name: /^Location$/ });
  await userEvent.clear(input);
  expect(controller.state().location).toBe('');
  expect(screen.getByRole('textbox', { name: /^Location$/ })).toBe(input);
  expect(document.activeElement).toBe(input);
});

it('keeps the location row in place through add, clear, remove, and re-add', async () => {
  setup();
  const add = screen.getByRole('button', { name: 'Add location' });
  const row = add.closest('[data-optional-field]');
  const parent = row?.parentElement;
  await userEvent.click(add);
  const input = await screen.findByLabelText('Location');
  expect(input.closest('[data-optional-field]')).toBe(row);
  await userEvent.type(input, 'Notes');
  expect(screen.queryByRole('button', { name: 'Remove location' })).toBeNull();
  await userEvent.clear(input);
  await userEvent.click(
    screen.getByRole('button', { name: 'Remove location' })
  );
  const restored = screen.getByRole('button', { name: 'Add location' });
  expect(restored.closest('[data-optional-field]')).toBe(row);
  expect(row?.parentElement).toBe(parent);
  await userEvent.click(restored);
  expect(screen.getByLabelText('Location')).toHaveProperty('value', '');
});

it('does not restore removed initial description content when re-added', async () => {
  setup('Original notes');
  const input = await screen.findByLabelText('Description');
  await userEvent.click(input);
  await userEvent.keyboard('{Control>}a{/Control}{Backspace}');
  await userEvent.click(
    await screen.findByRole('button', { name: 'Remove description' })
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Add description' })
  );
  expect((await screen.findByLabelText('Description')).textContent).toBe('');
});

it('collapses all-day dates and restores the timed fields without losing the range', async () => {
  const { controller } = setup();
  controller.setRange('2030-11-11T20:00', '2030-11-13T21:00');
  await userEvent.click(screen.getByText('All day', { exact: true }));
  expect(screen.queryByRole('button', { name: 'event start time' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Edit event end date' })
  ).toBeTruthy();
  await userEvent.click(
    screen.getByRole('button', { name: 'Edit event end date' })
  );
  expect(screen.getByRole('gridcell', { name: /^10$/ })).toHaveProperty(
    'disabled',
    true
  );
  await userEvent.click(screen.getByRole('gridcell', { name: /^14$/ }));
  expect(controller.state().end).toBe('2030-11-14');
  await userEvent.click(screen.getByText('All day', { exact: true }));
  expect(screen.getByRole('button', { name: 'event start time' })).toBeTruthy();
  expect(controller.state().start).toBe('2030-11-11T20:00');
  expect(controller.state().end).toBe('2030-11-14T21:00');
});

it('keeps search Enter inside the menu instead of submitting the composer', async () => {
  const { submit } = setup();
  await userEvent.click(screen.getByRole('button', { name: /^Time zone$/ }));
  await userEvent.type(
    screen.getByRole('textbox', { name: /^Time zone$/ }),
    'UTC{Enter}'
  );
  expect(submit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /^Back$/ }));
  expect(screen.getByRole('textbox', { name: 'Title' })).toBeTruthy();
});

it('edits one reminder through its page without changing another reminder', async () => {
  const { controller } = setup();
  controller.setReminderMinutes([10, 30]);
  await userEvent.click(
    screen.getByRole('button', { name: '10 minutes before' })
  );
  await userEvent.click(
    screen.getByRole('button', { name: '5 minutes before' })
  );
  expect(controller.reminderMinutes()).toEqual([5, 30]);
  expect(screen.getByRole('button', { name: 'Add reminder' })).toBeTruthy();
});

it('closes a menu when loaded details replace the draft', async () => {
  const { controller } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Time zone' }));
  controller.resetDetails();
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Title' })).toBeTruthy();
});

it('extends a single-day all-day draft with the inline range calendar', async () => {
  const { controller } = setup();
  controller.setRange('2030-11-11T20:00', '2030-11-11T21:00');
  await userEvent.click(screen.getByText('All day', { exact: true }));
  expect(
    screen.queryByRole('button', { name: 'Edit event end date' })
  ).toBeNull();
  await userEvent.click(
    screen.getByRole('button', { name: 'Edit event start date' })
  );
  await userEvent.click(screen.getByRole('gridcell', { name: /^12$/ }));
  await userEvent.click(screen.getByRole('gridcell', { name: /^15$/ }));
  expect(controller.state().start).toBe('2030-11-12');
  expect(controller.state().end).toBe('2030-11-15');
  expect(
    screen.getByRole('button', { name: 'Edit event end date' })
  ).toBeTruthy();
});

it('keeps one inline time wheel open and preserves duration across start edits', () => {
  const { controller } = setup();
  controller.setRange('2030-11-11T11:00', '2030-11-11T11:30');
  const starts = screen.getByRole('button', { name: 'event start time' });
  fireEvent.click(starts);
  expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
  fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Hour' }), {
    key: 'ArrowUp',
  });
  expect(controller.state().start).toBe('2030-11-11T12:00');
  expect(controller.state().end).toBe('2030-11-11T12:30');
  fireEvent.click(screen.getByRole('button', { name: 'event end time' }));
  expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
  expect(starts.getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByText('30min')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Minute' }), {
    key: 'ArrowUp',
  });
  expect(screen.getByText('35min')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'event end time' }));
  expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
});

it('hides time wheels for all-day and restores times with the 24-hour columns', () => {
  const { controller } = setup('', '24-hour');
  controller.setRange('2030-11-11T20:05', '2030-11-11T20:35');
  fireEvent.click(screen.getByRole('button', { name: 'event start time' }));
  expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
  fireEvent.click(screen.getByText('All day', { exact: true }));
  expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'event start time' })).toBeNull();
  fireEvent.click(screen.getByText('All day', { exact: true }));
  expect(controller.state().start).toBe('2030-11-11T20:05');
  expect(controller.state().end).toBe('2030-11-11T20:35');
  fireEvent.click(screen.getByRole('button', { name: 'event start time' }));
  fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Hour' }), {
    key: 'Escape',
  });
  expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'event start time' }));
  fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Title' }));
  expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
});

it('closes an open time wheel when saving disables the draft', () => {
  const { setPending } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'event start time' }));
  expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
  setPending(true);
  expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
});

it('returns Escape focus to an all-day date trigger rather than a hidden time', () => {
  setup();
  fireEvent.click(screen.getByText('All day', { exact: true }));
  const date = screen.getByRole('button', { name: 'Edit event start date' });
  fireEvent.click(date);
  const grid = screen.getByRole('grid');
  fireEvent.keyDown(grid, { key: 'Escape' });
  expect(screen.queryByRole('grid')).toBeNull();
  expect(document.activeElement).toBe(date);
});
