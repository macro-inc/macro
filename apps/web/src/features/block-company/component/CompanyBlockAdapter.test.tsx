import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CompanyBlockAdapter } from './CompanyBlockAdapter';

const entry = vi.hoisted(() => ({
  blockId: 'company-1',
  state: {} as Record<string, unknown>,
  captors: new Map<string, () => unknown>(),
  replace: vi.fn(),
  navigate: vi.fn(),
  comment: undefined as string | undefined,
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      replace: entry.replace,
      currentEntryState: () => entry.state,
      captureEntryState: () => {
        for (const [key, capture] of entry.captors)
          entry.state[key] = capture();
      },
      registerEntryStateCaptor: (key: string, capture: () => unknown) => {
        entry.captors.set(key, capture);
        return () => entry.captors.delete(key);
      },
    },
  }),
}));
vi.mock('@app/features/crm/crm-company', () => ({
  Company: (props: {
    section: string;
    onMerged?: (survivorId: string) => void;
  }) => (
    <>
      <p>Showing {props.section}</p>
      <button type="button" onClick={() => props.onMerged?.('company-9')}>
        Merged
      </button>
    </>
  ),
  CompanyTabs: (props: { onChange: (section: string) => void }) => (
    <button type="button" onClick={() => props.onChange('files')}>
      Files
    </button>
  ),
  CompanyVisibilityButton: () => null,
}));
vi.mock('@app/features/crm/crm-merged-record', () => ({
  useOpenMergedRecord: (
    open: (survivor: { type: string; id: string }) => void
  ) => open,
}));
vi.mock('@app/features/crm/crm-link', () => ({
  CrmCopyLinkButton: () => null,
}));
vi.mock('@components/app/HeaderActionGroup', () => ({
  HeaderActionGroup: (props: ParentProps) => props.children,
}));
vi.mock('@components/app/split-layout/components/CollapsibleItem', () => ({
  CollapsibleHeaderItem: (props: {
    children: (collapsed: () => boolean) => unknown;
  }) => props.children(() => false),
}));
vi.mock('@components/app/split-layout/components/HeaderIsland', () => ({
  HeaderIsland: (props: ParentProps) => props.children,
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: ParentProps) => props.children,
  SplitHeaderRight: (props: ParentProps) => props.children,
}));
vi.mock('@core/block', () => ({ useBlockId: () => entry.blockId }));
vi.mock('@core/component/ParamsProvider', () => ({
  createParamsState: () => ({ navigate: entry.navigate }),
  ParamsProvider: (props: ParentProps) => props.children,
  useResolvedParam: () => () => entry.comment,
}));
vi.mock('@core/orchestrator', () => ({ createMethodRegistration: vi.fn() }));
vi.mock('@core/signal/load', () => ({ blockHandleSignal: { get: vi.fn() } }));
vi.mock('@service-storage/crm-access-authority', () => ({
  crmAccessAllowed: () => true,
}));

afterEach(() => {
  cleanup();
  entry.state = {};
  entry.captors.clear();
  entry.blockId = 'company-1';
  entry.replace.mockReset();
  entry.navigate.mockReset();
  entry.comment = undefined;
});

it('shows the company a merged one went into in place of it', () => {
  render(() => <CompanyBlockAdapter />);
  fireEvent.click(screen.getByRole('button', { name: 'Merged' }));
  expect(entry.replace).toHaveBeenCalledExactlyOnceWith({
    next: {
      type: 'company',
      id: 'company-9',
      state: { 'crm.recordSection:company:company-9': 'overview' },
    },
    mergeHistory: true,
  });
});

it('opens the company a merged one went into on its section and Discussion message', () => {
  const merged = render(() => <CompanyBlockAdapter />);
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  entry.comment = 'message-1';
  fireEvent.click(screen.getByRole('button', { name: 'Merged' }));
  expect(entry.replace).toHaveBeenCalledExactlyOnceWith({
    next: {
      type: 'company',
      id: 'company-9',
      state: { 'crm.recordSection:company:company-9': 'files' },
      params: { comment_id: 'message-1' },
    },
    mergeHistory: true,
  });

  // The split mounts the company that stays with what it was handed.
  const [{ next }] = entry.replace.mock.calls[0]!;
  merged.unmount();
  entry.blockId = 'company-9';
  entry.state = next.state;
  render(() => <CompanyBlockAdapter {...next.params} />);
  expect(screen.getByText('Showing files')).toBeTruthy();
  expect(entry.navigate).toHaveBeenCalledWith({ comment_id: 'message-1' });
});

it('returns to the chosen section when Back comes back to the company', () => {
  const first = render(() => <CompanyBlockAdapter />);
  expect(screen.getByText('Showing overview')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  expect(screen.getByText('Showing files')).toBeTruthy();

  // A file opened from the section swaps the block out without a leave
  // guard, so nothing captures the entry on the way out.
  first.unmount();

  render(() => <CompanyBlockAdapter />);
  expect(screen.getByText('Showing files')).toBeTruthy();
});

it('opens another company previewed in the same entry on its overview', () => {
  const first = render(() => <CompanyBlockAdapter />);
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  first.unmount();

  entry.blockId = 'company-2';
  render(() => <CompanyBlockAdapter />);
  expect(screen.getByText('Showing overview')).toBeTruthy();
});

it('opens a company on its overview when its entry holds no section', () => {
  render(() => <CompanyBlockAdapter />);
  expect(screen.getByText('Showing overview')).toBeTruthy();
});
