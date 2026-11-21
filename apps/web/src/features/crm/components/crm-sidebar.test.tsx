import { ViewShell } from '@app/components/view-shell';
import { SplitPanelControllerProvider } from '@components/app/split-panel';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmSidebar } from './crm-sidebar';

const measurement = vi.hoisted(() => ({ width: 1200 }));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
}));
vi.mock('@app/features/routine-suggestions/routine-suggestions', () => ({
  SidebarRoutineSuggestions: () => null,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('./crm-create-menu', () => ({ CrmCreateMenu: () => null }));
vi.mock('@core/hotkey/hotkeys', () => ({ registerHotkey: vi.fn() }));
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
  createElementSize: () => ({
    get width() {
      return measurement.width;
    },
    height: 800,
  }),
}));
vi.mock('@app/components/view-shell/create-frame-width', () => ({
  createFrameWidth: () => () => measurement.width,
}));
vi.mock('@ui', async () => ({
  ...(await import('@ui/utils/classname')),
  ...(await import('@ui/utils/press')),
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button aria-label={props['aria-label']} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

const COLLAPSED = 'macro:pref:view-sidebar:collapsed:crm';
const close = vi.fn();
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  measurement.width = 1200;
});

afterEach(() => {
  cleanup();
  close.mockReset();
  vi.unstubAllGlobals();
});

function renderWorkspace(canAccess = () => true) {
  return render(() => (
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
            canAccess={canAccess()}
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

it('hides and shows CRM navigation with the shell controls and saves the choice', () => {
  const first = renderWorkspace();
  fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
  expect(screen.queryByRole('button', { name: 'Hide navigation' })).toBeNull();
  expect(values.get(COLLAPSED)).toBe('true');
  first.unmount();

  renderWorkspace();
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
  expect(screen.getByRole('button', { name: 'Hide navigation' })).toBeTruthy();
  expect(values.get(COLLAPSED)).toBe('false');
});

it('closes the split from the sidebar header', () => {
  renderWorkspace();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(close).toHaveBeenCalledOnce();
});

it('offers the navigation as an overlay at narrow widths', () => {
  measurement.width = 600;
  renderWorkspace();
  expect(
    screen.queryByRole('complementary', { name: 'CRM navigation' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
  expect(
    screen.getByRole('complementary', { name: 'CRM navigation' })
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
  expect(values.get(COLLAPSED)).toBeUndefined();
});

it('removes record and activity navigation when member access is revoked', () => {
  const [allowed, setAllowed] = createSignal(true);
  renderWorkspace(allowed);
  expect(screen.getByRole('navigation', { name: 'CRM records' })).toBeTruthy();
  setAllowed(false);
  expect(screen.queryByRole('navigation', { name: 'CRM records' })).toBeNull();
  expect(screen.queryByText('Sales tasks')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
  setAllowed(true);
  expect(screen.getByRole('navigation', { name: 'CRM records' })).toBeTruthy();
});
