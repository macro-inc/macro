import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MergeRecordType } from './core/merge';
import { CrmMergeModal } from './crm-merge-dialog';

const state = vi.hoisted(() => ({
  allowed: true,
  recordType: 'company' as MergeRecordType,
  onMerged: vi.fn(),
  success: vi.fn(),
  openWithSplit: vi.fn(),
}));
vi.mock('./crm-adapter', () => ({ createAppCrmContext: () => ({}) }));
vi.mock('./context/crm-context', () => ({
  CrmProvider: (props: ParentProps) => props.children,
}));
vi.mock('./crm-merge', () => ({
  recordMerge: {
    request: () => ({
      recordType: state.recordType,
      records: [],
      onMerged: state.onMerged,
    }),
    open: () => true,
    close: vi.fn(),
  },
}));
vi.mock('./views/merge-dialog', () => ({
  MergeDialog: (props: {
    recordType: MergeRecordType;
    onMerged: (merge: {
      survivor: { id: string; name: string };
      merged: { id: string; name: string }[];
    }) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          props.onMerged(
            props.recordType === 'company'
              ? {
                  survivor: { id: 'kept', name: 'Kept Co' },
                  merged: [{ id: 'old', name: 'Old Co' }],
                }
              : {
                  survivor: { id: 'pat', name: 'Pat Lee' },
                  merged: [{ id: 'pat-l', name: 'Pat L.' }],
                }
          )
        }
      >
        finish
      </button>
    </>
  ),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: state.success, dismiss: vi.fn() },
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: state.openWithSplit }),
}));
vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => state.allowed,
}));

beforeEach(() => {
  state.allowed = true;
  state.recordType = 'company';
  state.onMerged.mockReset();
  state.success.mockReset();
  state.openWithSplit.mockReset();
});
afterEach(cleanup);

it('announces the merge with a way to open the company that stays', () => {
  render(() => <CrmMergeModal />);
  fireEvent.click(screen.getByRole('button', { name: 'finish' }));

  expect(state.onMerged).toHaveBeenCalled();
  expect(state.success).toHaveBeenCalledWith(
    'Companies merged',
    expect.objectContaining({
      subtext: 'Old Co is now part of Kept Co.',
      actions: [expect.objectContaining({ label: 'Open' })],
    })
  );
});

it('announces a merge of people and opens the person who stays', () => {
  state.recordType = 'contact';
  render(() => <CrmMergeModal />);
  fireEvent.click(screen.getByRole('button', { name: 'finish' }));

  expect(state.success).toHaveBeenCalledWith(
    'People merged',
    expect.objectContaining({ subtext: 'Pat L. is merged into Pat Lee.' })
  );
  const [, options] = state.success.mock.calls[0];
  options.actions[0].onClick();
  expect(state.openWithSplit).toHaveBeenCalledWith({
    type: 'contact',
    id: 'pat',
  });
});

it('names nothing once CRM access was lost while the merge ran', () => {
  render(() => <CrmMergeModal />);
  state.allowed = false;
  fireEvent.click(screen.getByRole('button', { name: 'finish' }));

  expect(state.onMerged).toHaveBeenCalled();
  expect(state.success).not.toHaveBeenCalled();
});
