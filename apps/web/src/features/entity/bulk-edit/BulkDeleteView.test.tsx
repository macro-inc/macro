import { Dialog } from '@kobalte/core/dialog';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { For, type JSX, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkDeleteFailure } from '../queries/bulk-delete-result';
import type { EntityData } from '../types/entity';
import { BulkDeleteView } from './BulkDeleteView';

const mutateAsync = vi.hoisted(() => vi.fn());
vi.mock('../queries/dss', () => ({
  createBulkDeleteDssItemsMutation: () => ({ mutateAsync }),
}));
vi.mock('./components/EntityActionSelection', () => ({
  EntityActionSelection: (props: { entities: EntityData[] }) => (
    <For each={props.entities}>
      {(entity) => <span data-testid={entity.id}>{entity.name}</span>}
    </For>
  ),
}));
vi.mock('@ui', () => {
  const Slot = (props: ParentProps) => <div>{props.children}</div>;
  return {
    Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props} />
    ),
    ActionDialogShell: Object.assign(Slot, {
      Body: Slot,
      Header: Slot,
      Title: Slot,
      Description: Slot,
      Footer: Slot,
    }),
  };
});

const failed = {
  id: 'failed',
  type: 'document',
  name: 'Failed task',
} as EntityData;
const deleted = {
  id: 'deleted',
  type: 'document',
  name: 'Deleted task',
} as EntityData;

function mount() {
  const onFinish = vi.fn();
  const onError = vi.fn();
  const onCancel = vi.fn();
  const onPartialDelete = vi.fn();
  render(() => (
    <Dialog open modal={false}>
      <Dialog.Content>
        <BulkDeleteView
          entities={[failed, deleted]}
          onFinish={onFinish}
          onError={onError}
          onCancel={onCancel}
          onPartialDelete={onPartialDelete}
        />
      </Dialog.Content>
    </Dialog>
  ));
  return { onFinish, onError, onCancel, onPartialDelete };
}

beforeEach(() => {
  mutateAsync.mockReset();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 0)
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BulkDeleteView partial failure', () => {
  it('reports partial completion and retries only the failed items', async () => {
    mutateAsync
      .mockRejectedValueOnce(
        new BulkDeleteFailure(
          [failed, deleted],
          [false, true],
          new Error('failed delete')
        )
      )
      .mockResolvedValueOnce([true]);
    const { onFinish, onError, onPartialDelete } = mount();
    fireEvent.click(
      screen.getByRole('button', { name: /^Delete (item|\d+ items)$/ })
    );
    await vi.waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'Deleted 1 of 2 items; 1 failed'
      )
    );
    expect(screen.getByTestId('failed')).toBeTruthy();
    expect(screen.queryByTestId('deleted')).toBeNull();
    expect(onFinish).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled(); // no second, misleading full-failure callback
    fireEvent.click(
      screen.getByRole('button', { name: /^Delete (item|\d+ items)$/ })
    );
    await vi.waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
    expect(mutateAsync).toHaveBeenNthCalledWith(1, [failed, deleted]);
    expect(mutateAsync).toHaveBeenNthCalledWith(2, [failed]);
    expect(onPartialDelete).toHaveBeenCalledExactlyOnceWith(
      [deleted],
      [failed]
    );
  });

  it('reports confirmed successes before cancellation without completing the whole batch', async () => {
    mutateAsync.mockRejectedValueOnce(
      new BulkDeleteFailure([failed, deleted], [false, true])
    );
    const { onFinish, onError, onCancel, onPartialDelete } = mount();
    fireEvent.click(
      screen.getByRole('button', { name: /^Delete (item|\d+ items)$/ })
    );
    await vi.waitFor(() =>
      expect(onPartialDelete).toHaveBeenCalledExactlyOnceWith(
        [deleted],
        [failed]
      )
    );
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onPartialDelete).toHaveBeenCalledOnce();
    expect(onFinish).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not retry successful ids when caller cleanup throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mutateAsync
      .mockRejectedValueOnce(
        new BulkDeleteFailure([failed, deleted], [false, true])
      )
      .mockResolvedValueOnce([true]);
    const { onFinish, onError, onPartialDelete } = mount();
    onPartialDelete.mockImplementation(() => {
      throw new Error('cleanup failed');
    });
    fireEvent.click(
      screen.getByRole('button', { name: /^Delete (item|\d+ items)$/ })
    );
    await vi.waitFor(() => expect(onPartialDelete).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('deleted')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: /^Delete (item|\d+ items)$/ })
    );
    await vi.waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
    expect(mutateAsync).toHaveBeenNthCalledWith(2, [failed]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('preserves the existing full-failure callback and original retry targets', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('all failed');
    mutateAsync.mockRejectedValueOnce(error);
    const { onFinish, onError } = mount();
    fireEvent.click(
      screen.getByRole('button', { name: /^Delete (item|\d+ items)$/ })
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    expect(onFinish).not.toHaveBeenCalled();
    expect(screen.getByTestId('failed')).toBeTruthy();
    expect(screen.getByTestId('deleted')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
