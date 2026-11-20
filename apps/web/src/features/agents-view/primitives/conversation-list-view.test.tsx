import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { createConversationListView } from './conversation-list-view';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it('restores archived filters independently of unread active conversations', async () => {
  localStorage.setItem(
    'agents-conversation-list-view-v1:user',
    JSON.stringify({
      filters: { type: [], status: ['unread'], pullRequest: [] },
      sort: 'updated',
      grouping: 'none',
    })
  );
  render(() => {
    const active = createConversationListView('user');
    const archived = createConversationListView(
      'user',
      'agents-archived-list-view-v1'
    );
    return (
      <>
        <output data-testid="active">
          {active.filters().status.join(',')}
        </output>
        <output data-testid="archived">
          {archived.filters().status.join(',')}
        </output>
        <button onClick={() => archived.setSelected('status', 'idle', true)}>
          Filter archive
        </button>
        <button onClick={archived.clear}>Clear archive</button>
      </>
    );
  });
  await waitFor(() =>
    expect(screen.getByTestId('active').textContent).toBe('unread')
  );
  expect(screen.getByTestId('archived').textContent).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Filter archive' }));
  expect(screen.getByTestId('archived').textContent).toBe('idle');
  expect(screen.getByTestId('active').textContent).toBe('unread');
  fireEvent.click(screen.getByRole('button', { name: 'Clear archive' }));
  expect(screen.getByTestId('archived').textContent).toBe('');
  expect(screen.getByTestId('active').textContent).toBe('unread');
});
