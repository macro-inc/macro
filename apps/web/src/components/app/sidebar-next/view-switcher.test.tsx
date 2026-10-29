import type { SplitPanelContextType } from '@components/app/split-layout/context';
import { SplitPanelContext } from '@components/app/split-layout/context';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HIDDEN_IDS } from './use-sidebar-prefs';
import { ViewSwitcher } from './view-switcher';

const mocks = vi.hoisted(() => ({
  touch: false,
  openWithSplit: vi.fn(),
}));

vi.mock('@ui', async () => ({
  ...(await import('../../ui/utils/classname')),
  ...(await import('../../ui/components/Dropdown')),
  ...(await import('../../ui/components/Layer')),
}));
vi.mock('../../ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@core/mobile/inputModality', () => ({ isModality: () => false }));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    openWithSplit: mocks.openWithSplit,
    preloadContent: vi.fn(),
  }),
}));
// Flags are PostHog-backed; the rail's own gates decide what is listed.
vi.mock('./use-nav-item-gates', () => ({
  useNavItemGates: () => () => ({
    showCalendar: true,
    showScheduling: false,
    showCustomers: false,
    showCalls: true,
    showReviews: false,
    showActivity: false,
    prefs: { hidden: new Set(DEFAULT_HIDDEN_IDS), order: [] },
  }),
}));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  mocks.touch = false;
  mocks.openWithSplit.mockImplementation(
    (
      content: unknown,
      options: { handle: { setContent: (c: unknown) => void } }
    ) => {
      options.handle.setContent(content);
      return { status: 'opened', split: options.handle };
    }
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderSplits(options: { popover?: boolean } = {}) {
  const splits = ['left', 'right'].map((id) => {
    const [content, setContent] = createSignal({
      type: 'component',
      id: id === 'left' ? 'home' : 'mail',
    });
    return {
      id,
      content,
      setContent,
      isPopover: () => options.popover ?? false,
    };
  });
  render(() =>
    splits.map((split) => (
      <SplitPanelContext.Provider
        value={{ handle: split } as unknown as SplitPanelContextType}
      >
        <section aria-label={split.id}>
          <ViewSwitcher caret>
            {split.id === 'left' ? 'Home' : 'Email'}
          </ViewSwitcher>
        </section>
      </SplitPanelContext.Provider>
    ))
  );
  return splits;
}

/** The view's name is the trigger. */
function openMenu(split: string) {
  const name = split === 'left' ? 'Home' : 'Email';
  const trigger = within(screen.getByRole('region', { name: split })).getByRole(
    'button',
    { name }
  );
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('ViewSwitcher', () => {
  it('lists rail apps then More apps and marks the current view', async () => {
    renderSplits();
    openMenu('right');

    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Home',
      'Drive',
      'Email',
      'Chat',
      'Tasks',
      'Calendar',
      'Agents',
      'Calls',
    ]);
    expect(screen.getByRole('menuitem', { current: 'page' }).textContent).toBe(
      'Email'
    );
  });

  it('replaces the view in its own split, not the active one', async () => {
    const [left, right] = renderSplits();
    openMenu('right');

    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Tasks' }), {
      key: 'Enter',
    });

    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tasks' }),
      expect.objectContaining({ handle: right, preferNewSplit: false })
    );
    expect(right.content().id).toBe('tasks');
    expect(left.content().id).toBe('home');
  });

  it('opens a new split when Shift is held', async () => {
    renderSplits();
    openMenu('left');

    const drive = await screen.findByRole('menuitem', { name: 'Drive' });
    fireEvent.keyDown(drive, { key: 'Enter', shiftKey: true });

    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'documents' }),
      expect.objectContaining({ preferNewSplit: true })
    );
  });

  it('keeps a short view name visible instead of shrinking to one letter', () => {
    renderSplits();
    const trigger = within(
      screen.getByRole('region', { name: 'left' })
    ).getByRole('button', { name: 'Home' });
    expect(trigger.className).toContain('max-w-full');
    expect(trigger.className).toContain('w-max');
    expect(trigger.className).not.toContain('calc(');
    expect(trigger.textContent).toContain('Home');
  });

  it('shows the plain name on touch devices and in popovers', () => {
    mocks.touch = true;
    renderSplits();
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();

    mocks.touch = false;
    renderSplits({ popover: true });
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
