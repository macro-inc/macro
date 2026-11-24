import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CompanyBlockAdapter } from './CompanyBlockAdapter';

const entry = vi.hoisted(() => ({
  blockId: 'company-1',
  state: {} as Record<string, unknown>,
  captors: new Map<string, () => unknown>(),
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      currentEntryState: () => entry.state,
      registerEntryStateCaptor: (key: string, capture: () => unknown) => {
        entry.captors.set(key, capture);
        return () => entry.captors.delete(key);
      },
    },
  }),
}));
vi.mock('@app/features/crm/crm-company', () => ({
  Company: (props: { section: string }) => <p>Showing {props.section}</p>,
  CompanyTabs: (props: { onChange: (section: string) => void }) => (
    <button type="button" onClick={() => props.onChange('files')}>
      Files
    </button>
  ),
  CompanyVisibilityButton: () => null,
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
  createParamsState: () => ({ navigate: vi.fn() }),
  ParamsProvider: (props: ParentProps) => props.children,
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
});

it('returns to the chosen section when Back comes back to the company', () => {
  const first = render(() => <CompanyBlockAdapter />);
  expect(screen.getByText('Showing overview')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  expect(screen.getByText('Showing files')).toBeTruthy();

  // Opening an item captures the entry before the company unmounts.
  entry.state = Object.fromEntries(
    [...entry.captors].map(([key, capture]) => [key, capture()])
  );
  first.unmount();

  render(() => <CompanyBlockAdapter />);
  expect(screen.getByText('Showing files')).toBeTruthy();
});

it('opens another company previewed in the same entry on its overview', () => {
  const first = render(() => <CompanyBlockAdapter />);
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  entry.state = Object.fromEntries(
    [...entry.captors].map(([key, capture]) => [key, capture()])
  );
  first.unmount();

  entry.blockId = 'company-2';
  render(() => <CompanyBlockAdapter />);
  expect(screen.getByText('Showing overview')).toBeTruthy();
});

it('opens a company on its overview when its entry holds no section', () => {
  render(() => <CompanyBlockAdapter />);
  expect(screen.getByText('Showing overview')).toBeTruthy();
});
