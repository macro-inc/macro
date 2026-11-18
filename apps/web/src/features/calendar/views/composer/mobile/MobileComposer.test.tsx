import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
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
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 100, 44)
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        queueMicrotask(() => this.callback([], this));
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

function setup(description = '') {
  const submit = vi.fn();
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
      pending: false,
      onSubmit: submit,
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
  return { controller, submit };
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
