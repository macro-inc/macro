import { ViewShell } from '@app/components/view-shell';
import { SplitPanelControllerProvider } from '@components/app/split-panel';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { CrmSidebar } from './crm-sidebar';

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
}));
vi.mock('@app/features/routine-suggestions/routine-suggestions', () => ({
  SidebarRoutineSuggestions: () => null,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@app/components/view-shell/create-frame-width', () => ({
  createFrameWidth: () => () => 1000,
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
  createElementSize: () => ({ width: 1000, height: 800 }),
}));

const close = vi.fn();

afterEach(() => {
  cleanup();
  close.mockReset();
});

function renderSidebar() {
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
      <ViewShell.Root asidePreferenceKey="crm">
        <ViewShell.Aside>
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
          />
        </ViewShell.Aside>
        <ViewShell.Main>
          <ViewShell.TopBar />
        </ViewShell.Main>
      </ViewShell.Root>
    </SplitPanelControllerProvider>
  ));
}

it('collapses and reopens CRM navigation through the shared shell', () => {
  renderSidebar();
  fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
  expect(screen.queryByRole('button', { name: 'Hide navigation' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
  expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(close).toHaveBeenCalledOnce();
});
