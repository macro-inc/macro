/** @vitest-environment jsdom */
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, onCleanup, onMount } from 'solid-js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import { MeetingRouter } from './meeting-router';

const lifecycle = vi.hoisted(() => ({
  newMount: vi.fn(),
  newCleanup: vi.fn(),
  existingMount: vi.fn(),
  existingCleanup: vi.fn(),
  flag: () => ({ enabled: true, loading: false }),
}));

vi.mock('./use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => () => lifecycle.flag(),
}));

vi.mock('./new-meeting-route', () => ({
  NewMeetingRoute: (props: {
    onCallStateChange: (connected: boolean, shareToken: string) => void;
    onLeave: () => void;
  }) => {
    lifecycle.newMount();
    onMount(() => props.onCallStateChange(false, ''));
    onCleanup(lifecycle.newCleanup);
    return (
      <div>
        Draft owner
        <button
          type="button"
          onClick={() => props.onCallStateChange(true, 'created-token')}
        >
          Start call
        </button>
        <button
          type="button"
          onClick={() => props.onCallStateChange(false, 'created-token')}
        >
          Lose connection
        </button>
        <button type="button" onClick={props.onLeave}>
          Leave call
        </button>
      </div>
    );
  },
}));

vi.mock('./meeting-route', () => ({
  MeetingRouteContent: (props: {
    shareToken: string;
    onCallStateChange: (connected: boolean) => void;
    onLeave: () => void;
  }) => {
    const token = props.shareToken;
    lifecycle.existingMount(token);
    onMount(() => props.onCallStateChange(false));
    onCleanup(() => lifecycle.existingCleanup(token));
    return (
      <div>
        Existing owner: {props.shareToken}
        <button type="button" onClick={() => props.onCallStateChange(true)}>
          Join call
        </button>
        <button type="button" onClick={() => props.onCallStateChange(false)}>
          Lose connection
        </button>
        <button type="button" onClick={props.onLeave}>
          Leave call
        </button>
      </div>
    );
  },
}));

function setup(path: string) {
  const history = createMemoryHistory();
  history.set({ value: '/app/calendar', replace: true });
  history.set({ value: `/app${path}` });
  render(() => (
    <MemoryRouter base="/app" history={history}>
      <Route path="/meet/*path" component={MeetingRouter} />
      <Route path="/" component={() => <div>Macro home</div>} />
      <Route path="/calendar" component={() => <div>Calendar</div>} />
    </MemoryRouter>
  ));
  return history;
}

beforeAll(() => vi.stubGlobal('scrollTo', vi.fn()));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  lifecycle.flag = () => ({ enabled: true, loading: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each(['/meet/new', '/meet/join/shared-token', '/meet/shared-token'])(
  'does not mount call setup for %s while the flag is loading or disabled',
  async (path) => {
    const [flag, setFlag] = createSignal({ enabled: false, loading: true });
    lifecycle.flag = flag;
    const history = setup(path);
    expect(screen.getByText('Loading call…')).toBeTruthy();
    expect(history.get()).toBe(`/app${path}`);
    expect(lifecycle.newMount).not.toHaveBeenCalled();
    expect(lifecycle.existingMount).not.toHaveBeenCalled();

    setFlag({ enabled: false, loading: false });
    expect(screen.getByText('This call is unavailable')).toBeTruthy();
    expect(lifecycle.newMount).not.toHaveBeenCalled();
    expect(lifecycle.existingMount).not.toHaveBeenCalled();

    setFlag({ enabled: true, loading: false });
    await screen.findByText(
      path === '/meet/new' ? 'Draft owner' : 'Existing owner: shared-token'
    );
  }
);

it('preserves the draft owner through connection and unexpected disconnect', async () => {
  const history = setup('/meet/new');
  expect(lifecycle.newMount).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Start call' }));
  await waitFor(() => expect(history.get()).toBe('/app/meet/created-token'));
  expect(screen.getByText('Draft owner')).toBeTruthy();
  expect(lifecycle.newCleanup).not.toHaveBeenCalled();
  expect(lifecycle.existingMount).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Lose connection' }));
  await waitFor(() =>
    expect(history.get()).toBe('/app/meet/join/created-token')
  );
  expect(lifecycle.newMount).toHaveBeenCalledOnce();
  expect(lifecycle.newCleanup).not.toHaveBeenCalled();

  history.set({ value: '/app/meet/new' });
  await waitFor(() => expect(lifecycle.newMount).toHaveBeenCalledTimes(2));
  expect(lifecycle.newCleanup).toHaveBeenCalledOnce();
});

it('preserves an existing owner across setup and active URLs for the same token', async () => {
  const history = setup('/meet/join/shared-token');
  fireEvent.click(screen.getByRole('button', { name: 'Join call' }));
  await waitFor(() => expect(history.get()).toBe('/app/meet/shared-token'));

  // Browser navigation cannot replace a live session with a second setup owner.
  history.set({ value: '/app/meet/join/shared-token' });
  await waitFor(() => expect(history.get()).toBe('/app/meet/shared-token'));
  expect(lifecycle.existingMount).toHaveBeenCalledExactlyOnceWith(
    'shared-token'
  );
  expect(lifecycle.existingCleanup).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Lose connection' }));
  await waitFor(() =>
    expect(history.get()).toBe('/app/meet/join/shared-token')
  );
  expect(lifecycle.existingMount).toHaveBeenCalledOnce();
  expect(lifecycle.existingCleanup).not.toHaveBeenCalled();
});

it.each([
  ['/meet/new', 'Start call'],
  ['/meet/join/shared-token', 'Join call'],
])(
  'leaves %s for Macro and replaces the call history entry',
  async (path, action) => {
    const history = setup(path);
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() =>
      expect(history.get()).toBe(
        path === '/meet/new'
          ? '/app/meet/created-token'
          : '/app/meet/shared-token'
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    await screen.findByText('Macro home');
    await waitFor(() => expect(history.get()).toBe('/app'));

    history.back();
    await screen.findByText('Calendar');
    expect(history.get()).toBe('/app/calendar');
  }
);

it('opens a direct active URL in setup without remounting or connecting', async () => {
  const history = setup('/meet/shared-token');
  await waitFor(() =>
    expect(history.get()).toBe('/app/meet/join/shared-token')
  );
  expect(screen.getByRole('button', { name: 'Join call' })).toBeTruthy();
  expect(lifecycle.existingMount).toHaveBeenCalledExactlyOnceWith(
    'shared-token'
  );
  expect(lifecycle.existingCleanup).not.toHaveBeenCalled();
});

it('cleans up the old owner when opening another meeting or a new draft', async () => {
  const history = setup('/meet/join/first-token');
  history.set({ value: '/app/meet/join/second-token' });
  await screen.findByText('Existing owner: second-token');
  expect(lifecycle.existingCleanup).toHaveBeenCalledExactlyOnceWith(
    'first-token'
  );
  expect(lifecycle.existingMount).toHaveBeenCalledTimes(2);

  history.set({ value: '/app/meet/new' });
  await screen.findByText('Draft owner');
  expect(lifecycle.existingCleanup).toHaveBeenNthCalledWith(2, 'second-token');
  expect(lifecycle.newMount).toHaveBeenCalledOnce();
});

it('cleans up a started draft when opening a different meeting', async () => {
  const history = setup('/meet/new');
  fireEvent.click(screen.getByRole('button', { name: 'Start call' }));
  await waitFor(() => expect(history.get()).toBe('/app/meet/created-token'));
  history.set({ value: '/app/meet/join/another-token' });
  await screen.findByText('Existing owner: another-token');
  expect(lifecycle.newCleanup).toHaveBeenCalledOnce();
  expect(lifecycle.existingMount).toHaveBeenCalledExactlyOnceWith(
    'another-token'
  );
});
