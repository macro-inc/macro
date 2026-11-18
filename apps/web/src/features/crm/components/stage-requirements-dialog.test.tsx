import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { StageRequirementsDialog } from './stage-requirements-dialog';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('drops deleted fields from a draft while retaining its surviving selections', async () => {
  const columns: DatabaseViewColumn[] = [
    {
      id: 'stage',
      name: 'Stage',
      dataType: 'SELECT_STRING',
      isMultiSelect: false,
      options: [{ id: 'negotiation', label: 'Negotiation', color: null }],
      writable: true,
    },
    {
      id: 'amount',
      name: 'Amount',
      dataType: 'NUMBER',
      isMultiSelect: false,
      options: [],
      writable: true,
    },
    {
      id: 'owner',
      name: 'Owner',
      dataType: 'STRING',
      isMultiSelect: false,
      options: [],
      writable: true,
    },
  ];
  const save = vi.fn(async () => {});
  let removeAmount = () => {};
  render(() => {
    const [current, setCurrent] = createSignal(columns);
    removeAmount = () =>
      setCurrent((before) => before.filter((column) => column.id !== 'amount'));
    return (
      <StageRequirementsDialog
        columns={current()}
        rules={[]}
        onSave={save}
        onClose={() => {}}
      />
    );
  });
  fireEvent.click(screen.getByLabelText('Amount'));
  fireEvent.click(screen.getByLabelText('Owner'));
  removeAmount();
  expect(screen.queryByLabelText('Amount')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Save requirements/ }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      columnId: 'stage',
      optionId: 'negotiation',
      fields: ['owner'],
    })
  );
});
