import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewGettingStarted } from './ViewGettingStarted';

const wiring = vi.hoisted(() => ({
  userId: 'guide-user',
  settings: vi.fn(),
  split: vi.fn(),
}));
const renderTour = (ui: Parameters<typeof render>[0]) => ({
  ...render(ui),
  ...within(document.body),
});

const [desktop, setDesktop] = createSignal(true);
vi.mock('@solid-primitives/media', () => ({ createMediaQuery: () => desktop }));
vi.mock('./primitives/createGuidePosition', () => ({
  createGuidePosition: () => ({
    position: () => ({ left: 420, top: 80, ready: true }),
    highlight: () => undefined,
  }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => wiring.userId }));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: wiring.split }),
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettingsInSplit: wiring.settings }),
}));
vi.mock('@core/pipedream/flag', () => ({
  usePipedreamMcpFlag: () => () => false,
}));
vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({ isSuccess: true, data: { links: [] } }),
}));
vi.mock('@queries/mcp-servers', () => ({
  useMcpServersQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamConnectionsQuery: () => ({ isSuccess: true, data: [] }),
}));

beforeEach(() => {
  vi.stubEnv('DEV', false);
  setDesktop(true);
  localStorage.clear();
  wiring.userId = 'guide-user';
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('automatic view tours', () => {
  it('reopens dismissed tours for localhost development without changing saved dismissals', () => {
    vi.stubEnv('DEV', true);
    vi.stubGlobal('location', { hostname: 'localhost' });
    const key = 'macro:setup-suggestion:home:guide-user';
    localStorage.setItem(key, 'hidden');
    const view = renderTour(() => <ViewGettingStarted view="home" />);
    expect(
      view.getByRole('complementary', { name: 'Home quick tour' })
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Dismiss Home tour' }));
    expect(view.queryByRole('complementary')).toBeNull();
    expect(localStorage.getItem(key)).toBe('hidden');
    view.unmount();
    expect(
      renderTour(() => <ViewGettingStarted view="home" />).getByRole(
        'complementary'
      )
    ).toBeTruthy();
  });

  it('keeps saved dismissals outside localhost even in development', () => {
    vi.stubEnv('DEV', true);
    vi.stubGlobal('location', { hostname: 'dev.macro.com' });
    localStorage.setItem('macro:setup-suggestion:home:guide-user', 'hidden');
    expect(
      renderTour(() => <ViewGettingStarted view="home" />).queryByRole(
        'complementary'
      )
    ).toBeNull();
  });

  it('unmounts tours and video on mobile without persisting a dismissal', () => {
    const view = renderTour(() => <ViewGettingStarted view="mail" />);
    fireEvent.click(view.getByRole('button', { name: 'Watch Macro Mail' }));
    expect(document.querySelector('iframe')).toBeTruthy();
    setDesktop(false);
    expect(view.queryByRole('complementary')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    setDesktop(true);
    expect(view.getByRole('complementary')).toBeTruthy();
  });

  it('coordinates agent tour steps with the real workspace pages', () => {
    const onStepChange = vi.fn();
    const view = renderTour(() => (
      <ViewGettingStarted view="agents" onStepChange={onStepChange} />
    ));
    expect(onStepChange.mock.lastCall?.[0].agentPage).toBe('new');
    fireEvent.click(view.getByRole('button', { name: 'Next' }));
    expect(onStepChange.mock.lastCall?.[0].agentPage).toBe('agent');
    fireEvent.click(view.getByRole('button', { name: 'Next' }));
    expect(onStepChange.mock.lastCall?.[0].agentPage).toBe('coder');
    fireEvent.click(view.getByRole('button', { name: 'Back' }));
    expect(onStepChange.mock.lastCall?.[0].agentPage).toBe('agent');
  });
  it('opens without a trigger and stays open when working outside the flyover', () => {
    const view = renderTour(() => (
      <>
        <button type="button">Outside</button>
        <ViewGettingStarted view="mail" />
      </>
    ));
    expect(
      view.getByRole('complementary', { name: 'Email quick tour' })
    ).toBeTruthy();
    expect(view.queryByRole('button', { name: /Explore/ })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Outside' }));
    expect(
      view.getByRole('complementary', { name: 'Email quick tour' })
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Connect Google' }));
    expect(wiring.settings).toHaveBeenCalledWith('Email');
    expect(
      view.getByRole('complementary', { name: 'Email quick tour' })
    ).toBeTruthy();
  });

  it('resets steps for each view and persists dismissal without hiding other tours', () => {
    const [tab, setTab] = createSignal('mail');
    const view = renderTour(() => <ViewGettingStarted view={tab()} />);
    fireEvent.click(view.getByRole('button', { name: 'Next' }));
    expect(
      view.getByRole('heading', { name: 'Organize email your way' })
    ).toBeTruthy();
    setTab('tasks');
    expect(
      view.getByRole('heading', { name: 'Turn plans into progress' })
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Import from Linear' }));
    expect(wiring.split).toHaveBeenCalledWith({
      type: 'component',
      id: 'import-linear',
    });
    fireEvent.click(view.getByRole('button', { name: 'Dismiss Tasks tour' }));
    expect(view.queryByRole('complementary')).toBeNull();
    setTab('mail');
    expect(
      view.getByRole('heading', { name: 'Find the signal in your inbox' })
    ).toBeTruthy();
    setTab('tasks');
    expect(view.queryByRole('complementary')).toBeNull();
    view.unmount();
    const remount = renderTour(() => <ViewGettingStarted view="tasks" />);
    expect(remount.queryByRole('complementary')).toBeNull();
    remount.unmount();
    wiring.userId = 'another-user';
    expect(
      renderTour(() => <ViewGettingStarted view="tasks" />).getByRole(
        'complementary'
      )
    ).toBeTruthy();
  });

  it.each(['complete', 'escape'])(
    'remembers %s dismissal on remount',
    (action) => {
      const view = renderTour(() => <ViewGettingStarted view="home" />);
      if (action === 'complete') {
        fireEvent.click(view.getByRole('button', { name: 'Next' }));
        fireEvent.click(view.getByRole('button', { name: 'Next' }));
        fireEvent.click(view.getByRole('button', { name: 'Got it' }));
      } else {
        fireEvent.keyDown(
          view.getByRole('button', { name: 'Dismiss Home tour' }),
          { key: 'Escape' }
        );
      }
      expect(view.queryByRole('complementary')).toBeNull();
      view.unmount();
      expect(
        renderTour(() => <ViewGettingStarted view="home" />).queryByRole(
          'complementary'
        )
      ).toBeNull();
    }
  );
  it('loads video only on demand and removes playback on close or tab change', () => {
    const [tab, setTab] = createSignal('mail');
    const view = renderTour(() => <ViewGettingStarted view={tab()} />);
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Watch Macro Mail' }));
    expect(view.getByTitle('Macro Mail').getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/tnsxkywzTvY?autoplay=1&rel=0'
    );
    fireEvent.click(view.getByRole('button', { name: 'Next' }));
    expect(view.getByTitle('Macro Mail')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Close video' }));
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Watch Macro Mail' }));
    setTab('tasks');
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Watch Macro Tasks' }));
    fireEvent.click(view.getByRole('button', { name: 'Dismiss Tasks tour' }));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('omits video placeholders for views without a matching video', () => {
    const view = renderTour(() => <ViewGettingStarted view="calendar" />);
    expect(view.queryByRole('button', { name: /Watch/ })).toBeNull();
    expect(view.queryByText(/Coming soon/)).toBeNull();
    expect(
      view.getByRole('complementary', { name: 'Calendar quick tour' })
    ).toBeTruthy();
  });
});
