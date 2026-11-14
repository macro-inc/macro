import type { EmailThreadHost } from '@app/features/email-thread/context/email-thread-context';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { ComponentProps } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailBlockAdapter } from './EmailBlockAdapter';

const state = vi.hoisted(() => ({
  search: {} as { messageId: string; seek: string },
  navigate: (_params: Record<string, unknown>) => {},
  host: undefined as EmailThreadHost | undefined,
  touch: false,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => state.touch,
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  createSearchParams: () => [state.search],
}));
vi.mock('@solidjs/router', () => ({ useSearchParams: () => [{}] }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
  useCanAutofocusSplitContent: () => false,
}));
vi.mock('@core/orchestrator', () => ({
  createMethodRegistration: (
    _handle: unknown,
    methods: { goToLocationFromParams: typeof state.navigate }
  ) => {
    state.navigate = methods.goToLocationFromParams;
  },
}));
vi.mock('@core/signal/load', () => ({
  blockHandleSignal: { get: () => undefined },
}));
vi.mock('@core/signal/blockElement', () => ({
  blockElementSignal: { get: () => undefined },
  blockHotkeyScopeSignal: { get: () => undefined },
}));
vi.mock('@core/hotkey/utils', () => ({ registerScopeSignalHotkey: () => {} }));
vi.mock('./use-email-list-navigation', () => ({
  useEmailListNavigation: () => undefined,
}));
vi.mock('./util/emailHotkeys', () => ({ registerEmailHotkeys: () => {} }));
vi.mock('./views/email-thread', () => ({
  EmailThread: (props: { host: EmailThreadHost }) => {
    state.host = props.host;
    return <p>Desktop email thread</p>;
  },
}));
vi.mock('./views/mobile/email-thread', () => ({
  MobileEmailThread: (props: { host: EmailThreadHost }) => {
    state.host = props.host;
    return <p>Mobile email thread</p>;
  },
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  state.touch = false;
});

it('mounts the mobile view on touch and the desktop view otherwise', () => {
  state.search = { messageId: '', seek: '' };
  const props = {
    title: 'Email',
    threadId: () => 'thread',
    source: {},
    threadTransport: {},
  } as ComponentProps<typeof EmailBlockAdapter>;

  const desktop = render(() => <EmailBlockAdapter {...props} />);
  expect(screen.getByText('Desktop email thread')).toBeTruthy();
  expect(screen.queryByText('Mobile email thread')).toBeNull();
  desktop.unmount();

  state.touch = true;
  render(() => <EmailBlockAdapter {...props} />);
  expect(screen.getByText('Mobile email thread')).toBeTruthy();
  expect(screen.queryByText('Desktop email thread')).toBeNull();
});

it('preserves a pending imperative target when Home clears route search', () => {
  vi.useFakeTimers();
  const [search, setSearch] = createStore({
    messageId: 'route-message',
    seek: 'request',
  });
  state.search = search;
  const props = {
    title: 'Email',
    threadId: () => 'thread',
    source: {},
    threadTransport: {},
  } as ComponentProps<typeof EmailBlockAdapter>;
  render(() => <EmailBlockAdapter {...props} />);
  expect(state.host?.targetMessageId?.()).toBe('route-message');
  state.navigate({ email_message_id: 'legacy-message' });
  setSearch({ messageId: '', seek: '' });
  vi.runAllTimers();
  expect(state.host?.targetMessageId?.()).toBe('legacy-message');
  setSearch({ messageId: 'new-route-message', seek: 'new-request' });
  expect(state.host?.targetMessageId?.()).toBe('new-route-message');
});

it('clears a route-owned target without replaying its previous message', () => {
  const [search, setSearch] = createStore({
    messageId: 'route-message',
    seek: 'request',
  });
  state.search = search;
  const props = {
    title: 'Email',
    threadId: () => 'thread',
    source: {},
    threadTransport: {},
  } as ComponentProps<typeof EmailBlockAdapter>;
  render(() => <EmailBlockAdapter {...props} />);
  setSearch({ messageId: '', seek: '' });
  expect(state.host?.targetMessageId?.()).toBeUndefined();
  expect(state.host?.targetRequest?.()).toBeUndefined();
});

it('leaves a delivered imperative target and its request unchanged when route search clears', () => {
  vi.useFakeTimers();
  const [search, setSearch] = createStore({
    messageId: 'route-message',
    seek: 'request',
  });
  state.search = search;
  const props = {
    title: 'Email',
    threadId: () => 'thread',
    source: {},
    threadTransport: {},
  } as ComponentProps<typeof EmailBlockAdapter>;
  render(() => <EmailBlockAdapter {...props} />);
  state.navigate({ email_message_id: 'legacy-message' });
  vi.runAllTimers();
  const request = state.host?.targetRequest?.();
  setSearch({ messageId: '', seek: '' });
  expect(state.host?.targetMessageId?.()).toBe('legacy-message');
  expect(state.host?.targetRequest?.()).toBe(request);
});
