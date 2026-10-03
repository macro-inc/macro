import type { EmailThreadHost } from '@app/features/email-thread/context/email-thread-context';
import { cleanup, render } from '@solidjs/testing-library';
import type { ComponentProps } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailBlockAdapter } from './EmailBlockAdapter';

const state = vi.hoisted(() => ({
  search: {} as { messageId: string; seek: string },
  navigate: (_params: Record<string, unknown>) => {},
  host: undefined as EmailThreadHost | undefined,
}));
vi.mock('@app/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/split-router')>()),
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
vi.mock('./component/TopBar', () => ({ TopBar: () => null }));
vi.mock('./EmailThreadHostView', () => ({
  EmailThreadHostView: (props: { host: EmailThreadHost }) => {
    state.host = props.host;
    return null;
  },
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
