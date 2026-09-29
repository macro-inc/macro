import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineViewTour } from './core/view-tour';
import { ViewTour, ViewTourAction } from './ViewTour';

const wiring = vi.hoisted(() => ({
  userId: 'tour-user',
  settings: vi.fn(),
  links: [] as unknown[],
  native: [] as { server_name: string; authenticated: boolean }[],
  pipedream: [] as { server_name: string }[],
  queries: vi.fn(),
}));

const [desktop, setDesktop] = createSignal(true);
vi.mock('@solid-primitives/media', () => ({ createMediaQuery: () => desktop }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => wiring.userId }));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettingsInSplit: wiring.settings }),
}));
vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => {
    wiring.queries('email');
    return { isSuccess: true, data: { links: wiring.links } };
  },
}));
vi.mock('@queries/mcp-servers', () => ({
  useMcpServersQuery: () => {
    wiring.queries('native');
    return { isSuccess: true, data: wiring.native };
  },
}));
vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamConnectionsQuery: () => {
    wiring.queries('pipedream');
    return { isSuccess: true, data: wiring.pipedream };
  },
}));

const steps = [
  { title: 'First step', description: 'One' },
  { title: 'Second step', description: 'Two' },
];
const plain = defineViewTour({ id: 'plain', title: 'Plain', steps });
const withVideo = defineViewTour({
  id: 'video',
  title: 'Video',
  video: { youtubeId: 'abc', title: 'Demo video', duration: '1:00' },
  steps,
});
const linear = defineViewTour({
  id: 'linear',
  title: 'Linear',
  connector: { kind: 'mcp', label: 'Linear', tools: ['Linear'] },
  steps,
});
const key = (id: string) => `macro:tour:${id}:tour-user`;

beforeEach(() => {
  vi.stubEnv('DEV', false);
  setDesktop(true);
  localStorage.clear();
  wiring.userId = 'tour-user';
  wiring.links = [];
  wiring.native = [];
  wiring.pipedream = [];
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('ViewTour', () => {
  it('saves a dismissal per user and stays hidden afterwards', () => {
    const view = render(() => <ViewTour tour={plain} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Plain tour' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(key('plain'))).toBe('hidden');
    view.unmount();
    render(() => <ViewTour tour={plain} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('completes and saves from the last step', () => {
    render(() => <ViewTour tour={plain} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Second step' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(localStorage.getItem(key('plain'))).toBe('hidden');
  });

  it('reopens on localhost without touching saved dismissals', () => {
    vi.stubEnv('DEV', true);
    vi.stubGlobal('location', { hostname: 'localhost' });
    localStorage.setItem(key('plain'), 'hidden');
    render(() => <ViewTour tour={plain} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Plain tour' }));
    expect(localStorage.getItem(key('plain'))).toBe('hidden');
  });

  it('unmounts off desktop without saving a dismissal', () => {
    render(() => <ViewTour tour={withVideo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Watch Demo video' }));
    expect(document.querySelector('iframe')).toBeTruthy();
    setDesktop(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(localStorage.getItem(key('video'))).toBeNull();
    setDesktop(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('runs connection queries only for tours with a connector', () => {
    render(() => <ViewTour tour={plain} />);
    expect(wiring.queries).not.toHaveBeenCalled();
  });

  it('offers the connector until it is linked, using the onboarding rule', () => {
    const view = render(() => <ViewTour tour={linear} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Linear' }));
    expect(wiring.settings).toHaveBeenCalledWith('Connected');
    view.unmount();

    // Pipedream connections win over native rows, as the backend serves them.
    wiring.native = [{ server_name: 'Linear', authenticated: true }];
    wiring.pipedream = [{ server_name: 'notion' }];
    const second = render(() => <ViewTour tour={linear} />);
    expect(screen.getByRole('button', { name: 'Connect Linear' })).toBeTruthy();
    second.unmount();

    wiring.pipedream = [{ server_name: 'linear' }];
    render(() => <ViewTour tour={linear} />);
    expect(screen.queryByRole('button', { name: 'Connect Linear' })).toBeNull();
  });

  it('renders extra actions', () => {
    const onClick = vi.fn();
    render(() => (
      <ViewTour
        tour={plain}
        actions={<ViewTourAction onClick={onClick}>Import</ViewTourAction>}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
