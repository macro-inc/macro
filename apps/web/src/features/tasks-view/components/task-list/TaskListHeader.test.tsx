import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskListHeader } from './TaskListHeader';

const view = await vi.hoisted(async () => {
  const { createStore } = await import('solid-js/store');
  const [state, setState] = createStore({
    search: '',
    sort: [{ id: 'due_date_earliest', reversed: false }],
  });
  return {
    state,
    setState,
    source: { sortsSearchResults: false },
    setPrimarySort: vi.fn(),
  };
});

vi.mock('../../tasks-view-context', () => ({
  useTasksView: () => ({
    state: view.state,
    source: view.source,
    setPrimarySort: view.setPrimarySort,
  }),
}));

afterEach(() => {
  cleanup();
  view.setState({
    search: '',
    sort: [{ id: 'due_date_earliest', reversed: false }],
  });
  view.source.sortsSearchResults = false;
  view.setPrimarySort.mockClear();
});

function renderHeader() {
  render(() => (
    <TaskListHeader
      columns={[
        'indicator',
        'content',
        'dueDate',
        'initiative',
        'assignees',
        'timestamp',
        'createdBy',
      ]}
    />
  ));
  return screen.getByRole('row');
}

function sortButtons(header: HTMLElement) {
  return within(header)
    .queryAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
}

it('offers no column sort while a search keeps its own order, and restores the stored sort after', () => {
  const header = renderHeader();
  expect(sortButtons(header)).toEqual(['Due date', 'Updated']);

  view.setState('search', 'brief');
  expect(sortButtons(header)).toEqual([]);
  fireEvent.click(within(header).getByText('Due date'));
  fireEvent.click(within(header).getByText('Updated'));
  expect(view.setPrimarySort).not.toHaveBeenCalled();

  view.setState('search', '');
  expect(sortButtons(header)).toEqual(['Due date', 'Updated']);
  fireEvent.click(within(header).getByRole('button', { name: 'Due date' }));
  expect(view.setPrimarySort).toHaveBeenCalledExactlyOnceWith(
    'due_date_latest'
  );
});

it('keeps column sort while a search follows the list sort', () => {
  view.source.sortsSearchResults = true;
  view.setState('search', 'brief');
  const header = renderHeader();

  expect(sortButtons(header)).toEqual(['Due date', 'Updated']);
  fireEvent.click(within(header).getByRole('button', { name: 'Updated' }));
  expect(view.setPrimarySort).toHaveBeenCalledExactlyOnceWith('updated_at');
});
