import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import { RoutineTriggers } from './routine-triggers';

vi.mock('@core/component/DatePicker/DatePickerUI', () => ({
  DatePickerUI: () => null,
}));

const email: RoutineTriggerDraft = {
  id: 'email',
  kind: 'event',
  events: ['email.message_received'],
  condition: 'Is this about money?',
};

function renderRows(initial: RoutineTriggerDraft[]) {
  const [triggers, setTriggers] = createSignal(initial);
  const onChange = vi.fn(setTriggers);
  render(() => (
    <RoutineTriggers
      layout="rows"
      triggers={triggers()}
      onChange={onChange}
      renderEventLabel={() => <>Your inbox</>}
      renderEventScope={() => null}
      renderEventCondition={(trigger, change) => (
        <label>
          Only run if AI says yes
          <textarea
            value={trigger().condition ?? ''}
            onInput={(event) => change(event.currentTarget.value)}
          />
        </label>
      )}
    />
  ));
  return { triggers, onChange };
}

describe('routine triggers on the routine page', () => {
  it('shows each AI check on its own row and edits it in place', () => {
    const { triggers } = renderRows([email]);
    expect(screen.getByText('Only if')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Edit New email received trigger' })
        .textContent
    ).toContain('Your inbox');
    // The token no longer repeats the condition; its row shows it.
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit condition: Is this about money?',
      })
    );
    const panel = screen.getByRole('dialog', { name: 'Edit trigger' });
    fireEvent.input(within(panel).getByRole('textbox'), {
      target: { value: 'Is this an invoice?' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Done' }));
    expect(triggers()).toMatchObject([{ condition: 'Is this an invoice?' }]);
    expect(
      screen.getByRole('button', {
        name: 'Edit condition: Is this an invoice?',
      })
    ).toBeTruthy();
  });

  it('turns a typed schedule into the top choice and keeps the full list', () => {
    const { triggers } = renderRows([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Search triggers' }), {
      target: { value: 'every weekday at 9am' },
    });
    const choices = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('data-trigger-option'));
    expect(choices[0]?.textContent).toContain('Every weekday, 9:00 AM');
    expect(screen.getByRole('button', { name: 'Task created' })).toBeTruthy();
    fireEvent.click(choices[0]!);
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

  it('leaves Enter to an input method that is composing', () => {
    renderRows([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add trigger' }));
    const search = screen.getByRole('textbox', { name: 'Search triggers' });
    fireEvent.input(search, { target: { value: 'task' } });
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true });
    // Still searching: confirming a candidate picked nothing.
    expect(screen.getByRole('textbox', { name: 'Search triggers' })).toBe(
      search
    );
    // A plain Enter picks the first match and leaves the search.
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(
      screen.queryByRole('textbox', { name: 'Search triggers' })
    ).toBeNull();
  });
});
