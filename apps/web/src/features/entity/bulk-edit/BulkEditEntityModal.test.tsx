import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type ParentProps, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityData } from '../types/entity';
import type { PartialDeleteHandler } from './BulkDeleteView';
import {
  GlobalBulkEditEntityModal,
  openBulkEditModal,
} from './BulkEditEntityModal';

vi.mock('@core/util/createControlledOpenSignal', async () => {
  const { createSignal } = await import('solid-js');
  return { createControlledOpenSignal: (open: boolean) => createSignal(open) };
});
vi.mock('@ui', () => ({
  Dialog: (
    props: ParentProps<{ open: boolean; onOpenChange: (open: boolean) => void }>
  ) => (
    <Show when={props.open}>
      <div role="dialog">
        <button type="button" onClick={() => props.onOpenChange(false)}>
          Dismiss
        </button>
        {props.children}
      </div>
    </Show>
  ),
  ActionDialogShell: (props: ParentProps) => <div>{props.children}</div>,
}));
const share = vi.hoisted(() => ({
  dismiss: vi.fn(),
  views: [] as { onFinish: () => void; onCancel: () => void }[],
}));
vi.mock('@app/features/sharing/share-delivery/bulk-share', () => ({
  BulkShare: (props: {
    onFinish: () => void;
    onCancel: () => void;
    ref: (handle: { dismiss: () => void }) => void;
  }) => {
    share.views.push(props);
    props.ref({ dismiss: share.dismiss });
    return <div data-testid="share-view" />;
  },
}));
vi.mock('./BulkMoveToProjectView', () => ({
  BulkMoveToProjectView: () => null,
}));
vi.mock('./BulkRenameEntitiesView', () => ({
  BulkRenameEntitiesView: () => null,
}));
vi.mock('./BulkDeleteView', () => ({
  BulkDeleteView: (props: {
    entities: EntityData[];
    onPartialDelete?: PartialDeleteHandler;
    onFinish: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="delete-view">
      <button
        type="button"
        onClick={() =>
          props.onPartialDelete?.(
            props.entities.slice(0, 1),
            props.entities.slice(1)
          )
        }
      >
        Partial success
      </button>
      <button type="button" onClick={props.onCancel}>
        Cancel
      </button>
      <button type="button" onClick={props.onFinish}>
        Finish
      </button>
    </div>
  ),
}));

afterEach(cleanup);

describe('bulk-delete modal progress wiring', () => {
  it.each(['Cancel', 'Dismiss'])(
    'forwards progress without completing the batch before %s',
    (close) => {
      const deleted = { id: 'deleted', type: 'document' } as EntityData;
      const failed = { id: 'failed', type: 'document' } as EntityData;
      const onPartialDelete = vi.fn();
      const onFinish = vi.fn();
      const onCancel = vi.fn();
      openBulkEditModal({
        view: 'delete',
        entities: [deleted, failed],
        onPartialDelete,
        onFinish,
        onCancel,
      });
      render(() => <GlobalBulkEditEntityModal />);
      fireEvent.click(screen.getByRole('button', { name: 'Partial success' }));
      expect(onPartialDelete).toHaveBeenCalledWith([deleted], [failed]);
      expect(onFinish).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.getByTestId('delete-view')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: close }));
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onFinish).not.toHaveBeenCalled();
      expect(onPartialDelete).toHaveBeenCalledOnce();
      expect(screen.queryByTestId('delete-view')).toBeNull();
    }
  );
});

describe('bulk-share modal dismissal', () => {
  const rows = [
    { id: 'doc-1', type: 'document' },
    { id: 'doc-2', type: 'document' },
  ] as EntityData[];

  afterEach(() => {
    share.dismiss.mockReset();
    share.views = [];
  });

  it('lets the share view decide what a dismissal means', () => {
    const onFinish = vi.fn();
    const onCancel = vi.fn();
    openBulkEditModal({ view: 'share', entities: rows, onFinish, onCancel });
    render(() => <GlobalBulkEditEntityModal />);
    share.dismiss.mockImplementation(() => share.views[0].onFinish());

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(share.dismiss).toHaveBeenCalledOnce();
    expect(onFinish).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByTestId('share-view')).toBeNull();
  });

  it('ignores a finish from a dialog that already closed', () => {
    const first = { onFinish: vi.fn(), onCancel: vi.fn() };
    const second = { onFinish: vi.fn(), onCancel: vi.fn() };
    openBulkEditModal({ view: 'share', entities: rows, ...first });
    render(() => <GlobalBulkEditEntityModal />);
    const [stale] = share.views;
    stale.onCancel();
    openBulkEditModal({ view: 'share', entities: rows, ...second });

    stale.onFinish();
    stale.onCancel();

    expect(first.onCancel).toHaveBeenCalledOnce();
    expect(first.onFinish).not.toHaveBeenCalled();
    expect(second.onFinish).not.toHaveBeenCalled();
    expect(second.onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId('share-view')).toBeTruthy();
  });
});
