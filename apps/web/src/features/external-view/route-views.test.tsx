import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ExternalChatRouteView, ExternalRouteView } from './route-views';

const fixture = vi.hoisted(() => ({
  navigate: vi.fn(),
  whatsappFlag: undefined as unknown as () => {
    enabled: boolean;
    loading: boolean;
  },
  provider: undefined as unknown as () => string | undefined,
}));

vi.mock('@components/app/split-layout/split-router/app-route-shell', () => ({
  withAuth: (component: () => JSX.Element) => component,
  usePageViewTracking: () => {},
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useNavigate: () => fixture.navigate,
  useRouteParams: () => ({ chatId: 'chat-1' }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => fixture.whatsappFlag(),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'macro|me' }));
vi.mock('@queries/external-chats', () => ({
  useExternalChatDetailQuery: () => ({
    get data() {
      const provider = fixture.provider();
      return provider ? { provider } : undefined;
    },
  }),
}));
vi.mock('../external-chat/external-chat-entry', () => ({
  ExternalChatEntry: (props: { leading?: JSX.Element }) => (
    <div>{props.leading}</div>
  ),
}));
vi.mock('./external-view', () => ({
  ExternalView: () => <p>External view</p>,
}));
vi.mock('./external-view-skeleton', () => ({
  ExternalViewSkeleton: () => <p>Loading External</p>,
}));

afterEach(() => {
  cleanup();
  fixture.navigate.mockReset();
});

it('names Back after the open chat’s provider once its detail loads', () => {
  const [provider, setProvider] = createSignal<string>();
  fixture.provider = provider;
  render(() => <ExternalChatRouteView />);
  expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  setProvider('slack');
  screen.getByRole('button', { name: 'Back to Slack' }).click();
  expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ params: {} }),
    { state: { provider: 'slack' } }
  );
});

it('shows External while a provider’s flag is on and leaves when none is', () => {
  const [flag, setFlag] = createSignal({ enabled: false, loading: true });
  fixture.whatsappFlag = flag;
  render(() => <ExternalRouteView />);
  expect(screen.getByText('Loading External')).toBeTruthy();
  setFlag({ enabled: true, loading: false });
  expect(screen.getByText('External view')).toBeTruthy();
  setFlag({ enabled: false, loading: false });
  expect(fixture.navigate).toHaveBeenCalledOnce();
});
