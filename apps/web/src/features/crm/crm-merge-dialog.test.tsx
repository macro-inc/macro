import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompanyMergeModal } from './crm-merge-dialog';

const state = vi.hoisted(() => ({
  allowed: true,
  onMerged: vi.fn(),
  success: vi.fn(),
}));
vi.mock('./crm-adapter', () => ({ createAppCrmContext: () => ({}) }));
vi.mock('./context/crm-context', () => ({
  CrmProvider: (props: ParentProps) => props.children,
}));
vi.mock('./crm-merge', () => ({
  companyMerge: {
    request: () => ({ companies: [], onMerged: state.onMerged }),
    open: () => true,
    close: vi.fn(),
  },
}));
vi.mock('./views/merge-companies-dialog', () => ({
  MergeCompaniesDialog: (props: {
    onMerged: (merge: {
      survivor: { id: string; name: string };
      merged: { id: string; name: string }[];
    }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        props.onMerged({
          survivor: { id: 'kept', name: 'Kept Co' },
          merged: [{ id: 'old', name: 'Old Co' }],
        })
      }
    >
      finish
    </button>
  ),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: state.success, dismiss: vi.fn() },
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => state.allowed,
}));

beforeEach(() => {
  state.allowed = true;
  state.onMerged.mockReset();
  state.success.mockReset();
});
afterEach(cleanup);

it('announces the merge with a way to open the company that stays', () => {
  render(() => <CompanyMergeModal />);
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

it('names nothing once CRM access was lost while the merge ran', () => {
  render(() => <CompanyMergeModal />);
  state.allowed = false;
  fireEvent.click(screen.getByRole('button', { name: 'finish' }));

  expect(state.onMerged).toHaveBeenCalled();
  expect(state.success).not.toHaveBeenCalled();
});
