import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createResource, createSignal, Suspense } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  ActiveQuickCall,
  CallSidebarSources,
} from '../meetings/context/call-sidebar';
import { ChannelsLiveCallsSidebar } from './live-calls-sidebar';

const mocks = vi.hoisted(() => ({
  enabled: true,
  navigate: vi.fn(),
  source: vi.fn(),
  displayName: vi.fn(),
}));

vi.mock('@core/constant/featureFlags', () => ({
  get ENABLE_CALLS() {
    return mocks.enabled;
  },
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@example.com',
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@core/user/util', () => ({ idToDisplayName: mocks.displayName }));
vi.mock('../meetings/queries/active-quick-calls', () => ({
  useActiveQuickCallsSource: mocks.source,
}));
// The row primitives are real; their unused shell controls need no app layout.
vi.mock('@app/components/view-shell/ViewShell', () => ({
  ViewSidebarCloseButton: () => null,
  ViewSidebarToggle: () => null,
}));

const call: ActiveQuickCall = {
  id: 'call-one',
  createdBy: 'macro|maya@example.com',
  title: 'Design catch-up',
  url: 'https://macro.com/app/meet/join/0194b799-cafe-7000-8000-000000000001',
};

beforeEach(() => {
  mocks.enabled = true;
  mocks.navigate.mockReset();
  mocks.source.mockReset();
  mocks.displayName.mockReset();
  mocks.displayName.mockImplementation((id) =>
    id === call.createdBy ? 'Maya Chen' : 'Ada Lovelace'
  );
});
afterEach(cleanup);

function setup() {
  const [calls, setCalls] = createSignal<ActiveQuickCall[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>();
  const source: CallSidebarSources['active'] = {
    calls,
    loading,
    error,
    refresh: vi.fn(),
  };
  mocks.source.mockReturnValue(source);
  render(() => <ChannelsLiveCallsSidebar />);
  return { setCalls, setLoading, setError };
}

it('does not mount the active-call source when calls are disabled', () => {
  mocks.enabled = false;
  setup();
  expect(mocks.source).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: 'Live' })).toBeNull();
});

it('shows Live only while active calls exist, without empty loading or error UI', () => {
  const { setCalls, setLoading, setError } = setup();
  expect(screen.queryByRole('region', { name: 'Live' })).toBeNull();
  setLoading(false);
  setError('Could not load active calls.');
  expect(screen.queryByRole('region', { name: 'Live' })).toBeNull();
  expect(screen.queryByText('Could not load active calls.')).toBeNull();

  setCalls([
    call,
    {
      ...call,
      id: 'call-two',
      createdBy: 'macro|ada@example.com',
      title: 'Planning',
      url: '/meet/another-token',
    },
  ]);
  expect(screen.getByRole('heading', { name: 'Live' })).toBeTruthy();
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(
    screen.getByRole('button', { name: 'Join Call with Ada Lovelace' })
  ).toBeTruthy();
  expect(screen.queryByText('Planning')).toBeNull();
  setCalls([]);
  expect(screen.queryByRole('region', { name: 'Live' })).toBeNull();
});

it('opens call setup from an accessible sidebar row', () => {
  const { setCalls } = setup();
  setCalls([call]);
  const button = screen.getByRole('button', {
    name: 'Join Call with Maya Chen',
  });
  expect(button.tabIndex).toBe(0);
  expect(button.querySelector('svg.incoming-call-shake')).not.toBeNull();
  fireEvent.click(button);
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
    '/meet/join/0194b799-cafe-7000-8000-000000000001'
  );
  expect(mocks.displayName).toHaveBeenCalledWith(call.createdBy);
  expect(call.title).toBe('Design catch-up');
});

it('updates the creator label without replacing a focused call row', () => {
  const [name, setName] = createSignal('maya');
  mocks.displayName.mockImplementation(() => name());
  const { setCalls } = setup();
  setCalls([call]);
  const button = screen.getByRole('button', { name: 'Join Call with maya' });
  button.focus();

  setName('Maya Chen');
  expect(screen.getByRole('button', { name: 'Join Call with Maya Chen' })).toBe(
    button
  );
  expect(document.activeElement).toBe(button);
  expect(screen.getByText('Call with Maya Chen')).toBeTruthy();
});

it('uses a neutral creator fallback when a name is unavailable', () => {
  mocks.displayName.mockReturnValue('');
  const { setCalls } = setup();
  setCalls([call]);
  expect(screen.getByText('Call with someone')).toBeTruthy();
  expect(screen.queryByText(call.title)).toBeNull();
});

it('isolates a pending active-call source from the surrounding navigation', async () => {
  let resolve!: (calls: ActiveQuickCall[]) => void;
  const response = new Promise<ActiveQuickCall[]>((done) => {
    resolve = done;
  });
  mocks.source.mockImplementation(() => {
    const [calls] = createResource(() => response);
    return {
      calls: () => calls() ?? [],
      loading: () => calls.loading,
      error: () => undefined,
      refresh: vi.fn(),
    } satisfies CallSidebarSources['active'];
  });
  render(() => (
    <Suspense fallback={<span>Navigation loading</span>}>
      <span>Conversations</span>
      <ChannelsLiveCallsSidebar />
    </Suspense>
  ));

  expect(screen.getByText('Conversations')).toBeTruthy();
  expect(screen.queryByText('Navigation loading')).toBeNull();
  resolve([call]);
  expect(await screen.findByRole('heading', { name: 'Live' })).toBeTruthy();
  expect(screen.getByText('Conversations')).toBeTruthy();
});
