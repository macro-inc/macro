import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import { RoutineTriggers } from './routine-triggers';

const phone = vi.hoisted(() => ({ value: false }));

vi.mock('@core/component/DatePicker/DatePickerUI', () => ({
  DatePickerUI: () => null,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => phone.value }));

const email: RoutineTriggerDraft = {
  id: 'email',
  kind: 'event',
  events: ['email.message_received'],
  condition: 'Is this about money?',
};

function renderRows(initial: RoutineTriggerDraft[]) {
  const [triggers, setTriggers] = createSignal(initial);
  const onChange = vi.fn(setTriggers);
  const slots = {
    renderEventLabel: () => <>Your inbox</>,
    renderEventScope: () => null,
    renderEventCondition: (
      trigger: () => Extract<RoutineTriggerDraft, { kind: 'event' }>,
      change: (condition: string | undefined) => void
    ) => (
      <label>
        Only run if AI says yes
        <textarea
          value={trigger().condition ?? ''}
          onInput={(event) => change(event.currentTarget.value)}
        />
      </label>
    ),
  };
  // As on the routine's page: the card, then Add trigger in the tray below.
  render(() => (
    <>
      <RoutineTriggers
        layout="rows"
        triggers={triggers()}
        onChange={onChange}
        {...slots}
      />
      <RoutineTriggers
        layout="add"
        triggers={triggers()}
        onChange={onChange}
        {...slots}
      />
    </>
  ));
  return { triggers, onChange };
}

/** Kobalte menus open from the keyboard in jsdom. */
function press(element: HTMLElement, key: string) {
  element.focus();
  fireEvent.keyDown(element, { key });
}

function openAddTrigger() {
  press(screen.getByRole('button', { name: 'Add trigger' }), 'Enter');
  return screen.getByRole('textbox', { name: 'Search triggers' });
}

function item(name: RegExp | string) {
  return screen.getByRole('menuitem', { name, hidden: true });
}

beforeEach(() => {
  phone.value = false;
});

describe('routine triggers on the routine page', () => {
  it('reads each trigger as a sentence with its AI check hanging below', () => {
    const { triggers } = renderRows([email]);
    expect(
      screen.getByRole('button', { name: 'Change New email received trigger' })
    ).toBeTruthy();
    expect(screen.getByText('in')).toBeTruthy();
    expect(screen.getByText('Is this about money?')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit condition: Is this about money?',
      })
    );
    const panel = screen.getByRole('dialog', { name: 'Edit condition' });
    fireEvent.input(within(panel).getByRole('textbox'), {
      target: { value: 'Is this an invoice?' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Done' }));
    expect(triggers()).toMatchObject([{ condition: 'Is this an invoice?' }]);
    // × takes the check away; + Filter adds one back.
    fireEvent.click(screen.getByRole('button', { name: 'Remove condition' }));
    expect(triggers()[0]).toMatchObject({ condition: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    const filter = screen.getByRole('dialog', { name: 'Add filter' });
    fireEvent.input(within(filter).getByRole('textbox'), {
      target: { value: 'Is it urgent?' },
    });
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }));
    expect(triggers()).toMatchObject([{ condition: 'Is it urgent?' }]);
  });

  it('adds a trigger from its type’s submenu', () => {
    const { triggers } = renderRows([]);
    openAddTrigger();
    press(item('Tasks'), 'ArrowRight');
    press(item(/^Task created/), 'Enter');
    const panel = screen.getByRole('dialog', { name: 'Add trigger' });
    expect(within(panel).getByText('Task created')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Add trigger' }));
    expect(triggers()).toMatchObject([
      { kind: 'event', events: ['task.created'] },
    ]);
  });

  it('switches a trigger’s event from its token, keeping its AI check', () => {
    const { triggers } = renderRows([email]);
    press(
      screen.getByRole('button', { name: 'Change New email received trigger' }),
      'Enter'
    );
    press(item('Tasks'), 'ArrowRight');
    press(item(/^Task created/), 'Enter');
    expect(triggers()).toMatchObject([
      {
        id: 'email',
        events: ['task.created'],
        condition: 'Is this about money?',
      },
    ]);
  });

  it('searches every submenu, and a typed schedule becomes the top row', () => {
    const { triggers } = renderRows([]);
    const search = openAddTrigger();
    fireEvent.input(search, { target: { value: 'status' } });
    expect(item(/^Status changed/).textContent).toContain('Tasks');
    fireEvent.input(search, { target: { value: 'every weekday at 9am' } });
    const [first] = screen.getAllByRole('menuitem', { hidden: true });
    expect(first?.textContent).toContain('Weekdays at 9:00 AM');
    fireEvent.keyDown(search, { key: 'Enter' });
    const panel = screen.getByRole('dialog', { name: 'Add trigger' });
    expect(
      within(panel).getByRole<HTMLInputElement>('textbox', { name: 'Run time' })
        .value
    ).toBe('9:00 AM');
    fireEvent.click(within(panel).getByRole('button', { name: 'Add trigger' }));
    expect(triggers()).toMatchObject([
      { kind: 'schedule', frequency: 'week', time: '09:00' },
    ]);
  });

  it('leaves Enter to an input method that is composing', async () => {
    renderRows([]);
    const search = openAddTrigger();
    fireEvent.input(search, { target: { value: 'task' } });
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true });
    // Still searching: confirming a candidate picked nothing.
    expect(screen.getByRole('textbox', { name: 'Search triggers' })).toBe(
      search
    );
    // A plain Enter picks the first match and leaves the search.
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Add trigger' })).toBeTruthy();
    // The menu closed (jsdom keeps its exit animation's content around).
    const [menuButton] = screen.getAllByRole('button', {
      name: 'Add trigger',
      hidden: true,
    });
    await waitFor(() =>
      expect(menuButton?.getAttribute('aria-expanded')).toBe('false')
    );
  });

  it('opens a type in place on a phone, with a row back', () => {
    phone.value = true;
    renderRows([]);
    openAddTrigger();
    press(item('Tasks'), 'Enter');
    expect(item(/^Status changed/)).toBeTruthy();
    expect(
      screen.queryByRole('menuitem', { name: 'Email', hidden: true })
    ).toBeNull();
    press(item('Tasks'), 'Enter');
    expect(item('Email')).toBeTruthy();
  });
});
