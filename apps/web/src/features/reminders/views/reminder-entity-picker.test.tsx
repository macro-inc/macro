import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Dialog } from '@ui';
import { afterEach, expect, it, vi } from 'vitest';
import { ReminderEntityPicker } from './reminder-entity-picker';

vi.mock('@entity', () => ({
  createEmailsInfiniteQuery: () => ({
    isSuccess: true,
    data: [{ id: 'email-1', type: 'email', name: 'Project update' }],
    hasNextPage: false,
  }),
  Entity: {
    Icon: () => null,
    Title: (props: { entity: { name: string } }) => props.entity.name,
  },
}));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => ({ isSuccess: false }),
}));
vi.mock('@queries/reminders/reminders', () => ({
  reminderTarget: () => ({ entityType: 'document', entityId: 'task' }),
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: (options: { searchTerm: () => string }) => ({
      items: () =>
        [
          { data: { id: 'task-1', type: 'document', name: 'Review proposal' } },
        ].filter((item) =>
          item.data.name
            .toLowerCase()
            .includes(options.searchTerm().toLowerCase())
        ),
      isLoading: () => false,
      hasMore: () => false,
    }),
  }),
}));
vi.stubGlobal('scrollTo', vi.fn());
afterEach(cleanup);

it('searches locally and selects an entity with the keyboard without opening it', () => {
  const select = vi.fn();
  render(() => (
    <Dialog open>
      <ReminderEntityPicker onSelect={select} onWrite={vi.fn()} />
    </Dialog>
  ));
  const input = screen.getByRole('combobox');
  expect(document.activeElement).toBe(input);
  fireEvent.input(input, { target: { value: 'project' } });
  expect(screen.queryByText('Review proposal')).toBeNull();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'email-1' })
  );
});

it('offers freeform even with no matching entities', () => {
  const write = vi.fn();
  render(() => (
    <Dialog open>
      <ReminderEntityPicker onSelect={vi.fn()} onWrite={write} />
    </Dialog>
  ));
  fireEvent.input(screen.getByRole('combobox'), {
    target: { value: 'unmatched' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Write a reminder instead' })
  );
  expect(write).toHaveBeenCalledOnce();
});
