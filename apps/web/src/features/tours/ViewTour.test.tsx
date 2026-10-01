import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { defineTourTargets, tourTarget } from '@ui/components/Tour';
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
const [flagOn, setFlagOn] = createSignal(true);
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: flagOn() }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => wiring.userId }));

// Account-backed progress is covered in queries/tour-progress.test.tsx; here
// it's an in-memory stand-in so the tests exercise the tour UI.
const progress = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  localOnly: [] as boolean[],
}));
const [progressReady, setProgressReady] = createSignal(true);
vi.mock('./queries/tour-progress', () => ({
  createTourProgress: (props: { tourId: string; localOnly: boolean }) => {
    progress.localOnly.push(props.localOnly);
    return {
      ready: () => progressReady(),
      stored: () =>
        props.localOnly ? undefined : progress.store.get(props.tourId),
      save: (value: unknown) => {
        if (!props.localOnly) progress.store.set(props.tourId, value);
      },
    };
  },
}));
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
const saved = (id: string) => progress.store.get(id);

beforeEach(() => {
  vi.stubEnv('DEV', false);
  setDesktop(true);
  setFlagOn(true);
  setProgressReady(true);
  progress.store.clear();
  progress.localOnly = [];
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
  it('renders nothing while the in-app tours flag is off', () => {
    setFlagOn(false);
    render(() => <ViewTour tour={withVideo} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    setFlagOn(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('saves a dismissal per user and stays hidden afterwards', () => {
    const view = render(() => <ViewTour tour={plain} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(saved('plain')).toEqual({ status: 'dismissed' });
    view.unmount();
    render(() => <ViewTour tour={plain} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('completes and saves from the last step', () => {
    render(() => <ViewTour tour={plain} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Second step' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(saved('plain')).toEqual({ status: 'completed' });
  });

  it('resumes an unfinished tour at the last step reached', () => {
    const view = render(() => <ViewTour tour={plain} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(saved('plain')).toEqual({ status: 'active', step: 1 });
    view.unmount();
    render(() => <ViewTour tour={plain} />);
    expect(screen.getByRole('dialog', { name: 'Second step' })).toBeTruthy();
  });

  it('waits for saved progress before showing anything', () => {
    setProgressReady(false);
    progress.store.set('plain', { status: 'dismissed' });
    render(() => <ViewTour tour={plain} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    setProgressReady(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reopens on localhost without touching saved progress', () => {
    vi.stubEnv('DEV', true);
    vi.stubGlobal('location', { hostname: 'localhost' });
    progress.store.set('plain', { status: 'dismissed' });
    render(() => <ViewTour tour={plain} />);
    expect(progress.localOnly).toEqual([true]);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(saved('plain')).toEqual({ status: 'dismissed' });
  });

  it('unmounts off desktop without saving a dismissal', () => {
    render(() => <ViewTour tour={withVideo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Watch Demo video' }));
    expect(document.querySelector('iframe')).toBeTruthy();
    setDesktop(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(saved('video')).toBeUndefined();
    setDesktop(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes the video from the × above it, with no YouTube link', () => {
    render(() => <ViewTour tour={withVideo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Watch Demo video' }));
    expect(document.querySelector('iframe')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /YouTube/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close video' }));
    expect(document.querySelector('iframe')).toBeNull();
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

describe('ViewTour waiting hint', () => {
  const T = defineTourTargets('hint-test', ['entry', 'a', 'b', 'c']);
  const waiting = defineViewTour({
    id: 'waiting',
    title: 'Waiting',
    steps: [
      {
        target: T.a,
        entry: T.entry,
        entryLabel: 'Open the thing to continue',
        title: 'A',
        description: 'a',
      },
      {
        target: T.b,
        entry: T.entry,
        entryLabel: 'Open the thing to continue',
        title: 'B',
        description: 'b',
      },
      {
        target: T.c,
        entry: T.entry,
        entryLabel: 'Open the thing to continue',
        title: 'C',
        description: 'c',
      },
      { title: 'After', description: 'done waiting' },
    ],
  });

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(10, 10, 100, 20)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the action to take, with Skip to move on', async () => {
    render(() => (
      <>
        <button type="button" ref={tourTarget(T.entry)}>
          Thing
        </button>
        <ViewTour tour={waiting} />
      </>
    ));
    await Promise.resolve();
    const hint = () => document.querySelector('[data-tour-hint]');
    expect(hint()?.textContent).toContain('Open the thing to continue');
    expect(hint()?.textContent).toContain('1 / 4');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(hint()?.textContent).toContain('2 / 4');
  });
});
