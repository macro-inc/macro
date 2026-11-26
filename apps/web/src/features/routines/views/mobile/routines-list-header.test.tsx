import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { RoutinesPage } from '../../routines-page';
import { MobileRoutinesListHeader } from './routines-list-header';

const state = vi.hoisted(() => ({ touch: true, fromDrawer: false }));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => state.touch,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'test-user' }));
vi.mock('@core/auth/license', () => ({ useHasPaidAccess: () => () => true }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { alert: vi.fn() } }));
vi.mock('@app/features/agents-view/primitives/drawer-navigation', () => ({
  useWorkspaceDrawerEntry: () => () => state.fromDrawer,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn(), popoverSplit: vi.fn() }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      content: () => ({ type: 'component', id: 'routines' }),
      canGoBack: () => true,
      goBack: vi.fn(),
    },
    splitHotkeyScope: 'routines-test',
    isPanelActive: () => true,
  }),
}));
vi.mock('@components/app/SplitHeaderScope', () => ({
  useSplitHeaderScope: () => (state.touch ? {} : undefined),
  SplitHeaderScope: {
    Root: (props: ParentProps) => <>{props.children}</>,
    TopBar: (props: { leading?: JSX.Element }) => (
      <header aria-label="Hosted routines header">
        <Show when={props.leading}>
          {(leading) => <div data-testid="leading-island">{leading()}</div>}
        </Show>
      </header>
    ),
  },
}));
vi.mock('@app/features/routine-suggestions/routine-suggestions', () => ({
  useRoutinesDiscover: () => () => undefined,
}));
vi.mock('../../queries/routine-sources', () => ({
  createRoutineListSource: () => ({}),
}));
vi.mock('../../queries/catalog', () => ({
  useRoutineCatalog: () => () => undefined,
}));
vi.mock('../../routine-row-menu-actions', () => ({
  useRoutineRowMenuActions: () => ({}),
}));
vi.mock('../../routine-detail', () => ({ RoutineDetail: () => null }));
vi.mock('../../routine-new', () => ({ RoutineNew: () => null }));
vi.mock('../routines-list', () => ({
  RoutinesListView: (props: {
    mobileHeader: (focus: () => void) => JSX.Element;
  }) => (
    <main>
      <Show when={state.touch}>{props.mobileHeader(() => {})}</Show>
      <h1>Routines</h1>
    </main>
  ),
}));
vi.mock('@components/app/mobile-header/mobile-header', () => ({
  MobileHeader: Object.assign(
    (props: ParentProps) => <div>{props.children}</div>,
    {
      Back: (props: { onBack: () => void }) => (
        <button onClick={props.onBack}>Back</button>
      ),
      Island: (props: ParentProps) => <div>{props.children}</div>,
    }
  ),
}));
vi.mock('@app/components/view-shell', () => ({
  useViewControlHotkeys: () => {},
  ViewSidebar: {
    Toggle: () => <button>Show navigation</button>,
  },
}));

afterEach(() => {
  cleanup();
  state.touch = true;
  state.fromDrawer = false;
});

it.each([
  [true, 'Show navigation'],
  [false, 'Back'],
] as const)(
  'shows %s entry navigation on the routines list',
  (fromDrawer, action) => {
    const onBack = vi.fn();
    render(() => (
      <MobileRoutinesListHeader
        fromDrawer={fromDrawer}
        onBack={onBack}
        onSearch={() => {}}
        onCreate={() => {}}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(onBack).toHaveBeenCalledTimes(fromDrawer ? 0 : 1);
  }
);

it.each([
  { touch: true, fromDrawer: false, action: 'Back' },
  { touch: true, fromDrawer: true, action: 'Show navigation' },
  { touch: false, fromDrawer: false, action: undefined },
])(
  'does not add an empty island for $action navigation',
  ({ touch, fromDrawer, action }) => {
    state.touch = touch;
    state.fromDrawer = fromDrawer;
    render(() => <RoutinesPage />);

    expect(screen.getByRole('heading', { name: 'Routines' })).toBeTruthy();
    expect(screen.queryByTestId('leading-island')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' }) !== null).toBe(
      action === 'Back'
    );
    expect(
      screen.queryByRole('button', { name: 'Show navigation' }) !== null
    ).toBe(action === 'Show navigation');
  }
);
