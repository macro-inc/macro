import { SplitPanelControllerProvider } from '@components/app/split-panel';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { CrmSidebar } from './crm-sidebar';

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
}));

const close = vi.fn();

afterEach(() => {
  cleanup();
  close.mockReset();
});

function renderSidebar(onCollapse?: () => void) {
  render(() => (
    <SplitPanelControllerProvider
      controller={{
        canGoBack: () => false,
        goBack: () => {},
        canGoForward: () => false,
        goForward: () => {},
        canClose: () => true,
        close,
      }}
    >
      <CrmSidebar
        active="active"
        lists={[]}
        listsEnabled={false}
        listsLoading={false}
        listsError={false}
        canCreateList
        onNavigate={() => {}}
        onCreateCompany={() => {}}
        onCreateContact={() => {}}
        onNewList={() => {}}
        onImport={() => {}}
        onExport={() => {}}
        onSettings={() => {}}
        onCollapse={onCollapse}
      />
    </SplitPanelControllerProvider>
  ));
}

it('closes the split and collapses from the docked sidebar header', () => {
  const collapse = vi.fn();
  renderSidebar(collapse);
  fireEvent.click(screen.getByRole('button', { name: 'Collapse CRM sidebar' }));
  expect(collapse).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(close).toHaveBeenCalledOnce();
});

it('leaves split controls to the split header inside the navigation menu', () => {
  renderSidebar();
  expect(screen.getByText('Customers')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Collapse CRM sidebar' })
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
});
