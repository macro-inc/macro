import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskEntity } from '../types/entity';
import {
  GlobalBulkEditEntityModal,
  openBulkEditModal,
} from './BulkEditEntityModal';

const mutateAsync = vi.hoisted(() => vi.fn());
const openItem = vi.hoisted(() => vi.fn());

vi.mock('@core/util/createControlledOpenSignal', async () => {
  const { createSignal } = await import('solid-js');
  return { createControlledOpenSignal: (open: boolean) => createSignal(open) };
});
vi.mock('../queries/dss', () => ({
  createBulkDeleteDssItemsMutation: () => ({ mutateAsync }),
}));
// Item chips are buttons that open the item, ahead of the footer in tab order.
vi.mock('./components/EntityActionSelection', () => ({
  EntityActionSelection: () => (
    <button type="button" onClick={openItem}>
      Task chip
    </button>
  ),
}));

const task: TaskEntity = {
  id: 'task',
  name: 'Task',
  ownerId: 'owner',
  type: 'document',
  fileType: 'md',
  subType: { type: 'task' },
};

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue([true]);
  openItem.mockReset();
});
afterEach(cleanup);

async function openDeleteDialog() {
  const onFinish = vi.fn();
  const onCancel = vi.fn();
  render(() => <GlobalBulkEditEntityModal />);
  return { onFinish, onCancel, ...(await reopen(onFinish, onCancel)) };
}

async function reopen(onFinish: () => void, onCancel: () => void) {
  openBulkEditModal({ view: 'delete', entities: [task], onFinish, onCancel });
  const deleteButton = await screen.findByRole('button', {
    name: 'Delete item',
  });
  await vi.waitFor(() => expect(document.activeElement).toBe(deleteButton));
  return { deleteButton };
}

describe('delete item dialog keyboard', () => {
  it('deletes once on Enter without opening the item', async () => {
    const { onFinish, onCancel } = await openDeleteDialog();

    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
    expect(mutateAsync).toHaveBeenCalledExactlyOnceWith([task]);
    expect(openItem).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('deletes once when Enter is pressed again before the delete finishes', async () => {
    const { promise, resolve } = Promise.withResolvers<boolean[]>();
    mutateAsync.mockReturnValue(promise);
    const { onFinish } = await openDeleteDialog();

    await userEvent.keyboard('{Enter}{Enter}');
    resolve([true]);

    await vi.waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
    expect(mutateAsync).toHaveBeenCalledOnce();
  });

  it('cancels on Escape without deleting, and focuses Delete again on reopen', async () => {
    const { onFinish, onCancel } = await openDeleteDialog();

    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();

    await reopen(onFinish, onCancel);
  });
});
