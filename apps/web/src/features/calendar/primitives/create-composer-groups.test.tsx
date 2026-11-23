import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { For } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { createComposerGroups } from './create-composer-groups';

afterEach(cleanup);

function Session() {
  const groups = createComposerGroups();
  return (
    <div>
      <For each={['date', 'guests', 'calendar'] as const}>
        {(group) => (
          <button onClick={() => groups.open(group)}>
            {group}: {groups.isOpen(group) ? 'open' : 'closed'}
          </button>
        )}
      </For>
    </div>
  );
}

it('opens multiple groups one-way and resets for a new mounted session', async () => {
  const view = render(() => <Session />);
  await userEvent.click(screen.getByRole('button', { name: 'date: closed' }));
  await userEvent.click(screen.getByRole('button', { name: 'guests: closed' }));
  await userEvent.click(screen.getByRole('button', { name: 'date: open' }));
  expect(screen.getByRole('button', { name: 'date: open' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'guests: open' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'calendar: closed' })).toBeTruthy();
  view.unmount();
  render(() => <Session />);
  expect(screen.getByRole('button', { name: 'date: closed' })).toBeTruthy();
});
