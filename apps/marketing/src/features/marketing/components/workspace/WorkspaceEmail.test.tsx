import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EmailTagId } from '../../core/demo-email';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { WorkspaceEmail } from './WorkspaceEmail';

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('combines tag, account and search filters without losing unrelated emails', () => {
  let changeAccount!: (value: string) => void;
  let changeTag!: (value: EmailTagId | undefined) => void;
  const view = render(() => {
    const w = createDummyWorkspace('email');
    const [account, setAccount] = createSignal('all');
    const [tag, setTag] = createSignal<EmailTagId>();
    changeAccount = setAccount;
    changeTag = setTag;
    return (
      <WorkspaceEmail workspace={w} tab="all" account={account()} tag={tag()} />
    );
  });
  changeTag('customers');
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(4);
  fireEvent.input(view.getByLabelText('Search email'), {
    target: { value: 'pilot' },
  });
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(1);
  expect(
    view.getByRole('button', { name: 'Read Feedback from the pilot team' })
  ).toBeTruthy();
  changeAccount('personal');
  expect(view.getByText('No matching messages.')).toBeTruthy();
  changeTag(undefined);
  fireEvent.input(view.getByLabelText('Search email'), {
    target: { value: '' },
  });
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(4);
});

it('edits sample tags in the details panel and keeps them after reopening', async () => {
  const view = render(() => (
    <WorkspaceEmail
      workspace={createDummyWorkspace('email')}
      tab="all"
      account="all"
    />
  ));
  fireEvent.click(
    view.getByRole('button', { name: 'Read Next steps for our team' })
  );
  fireEvent.click(view.getByRole('button', { name: 'Toggle email details' }));
  fireEvent.pointerDown(view.getByRole('button', { name: 'Add tags' }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  });
  fireEvent.keyDown(
    await screen.findByRole('menuitemcheckbox', { name: 'Launch' }),
    { key: 'Enter' }
  );
  fireEvent.keyDown(
    screen.getByRole('menuitemcheckbox', { name: 'Customers' }),
    { key: 'Enter' }
  );
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  fireEvent.click(
    within(view.getByRole('navigation', { name: 'Email location' })).getByRole(
      'button',
      { name: 'All' }
    )
  );
  const row = view.getByRole('button', {
    name: 'Read Next steps for our team',
  });
  expect(within(row).getAllByText('Launch').length).toBeGreaterThan(0);
  expect(within(row).queryByText('Customers')).toBeNull();
  fireEvent.click(row);
  expect(view.getByRole('button', { name: 'Change tag Launch' })).toBeTruthy();
  expect(
    view.queryByRole('button', { name: 'Change tag Customers' })
  ).toBeNull();
});
