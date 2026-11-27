import type { EmailThreadHost } from '@app/features/email-thread/context/email-thread-context';
import {
  attachGlobalDOMScope,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { cleanup, render } from '@solidjs/testing-library';
import { type JSX, onMount } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailDetailView } from './EmailDetailView';

type KeyboardHandlers = Parameters<
  NonNullable<EmailThreadHost['registerKeyboard']>
>[0];

const state = vi.hoisted(() => ({
  splitScope: '',
  closeThread: vi.fn(),
  loadFailed: false,
  cancel: vi.fn(() => false),
}));

vi.mock('../email-view-context', () => ({
  useEmailView: () => ({
    closeThread: state.closeThread,
    selectedThread: () => undefined,
  }),
}));
vi.mock('../reader-pane', () => ({ useEmailReaderPane: () => undefined }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    splitHotkeyScope: state.splitScope,
    isPanelActive: () => true,
  }),
  useCanAutofocusSplitContent: () => false,
  useSplitDisplayName: () => {},
}));
vi.mock('@components/app/split-layout/utils/createSplitAutofocus', () => ({
  createSplitAutofocus: () => {},
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: { Root: (props: { children: JSX.Element }) => props.children },
}));
vi.mock('@queries/email/thread', () => ({
  useThreadQuery: () => ({
    get isError() {
      return state.loadFailed;
    },
    get isSuccess() {
      return !state.loadFailed;
    },
    isLoading: false,
    error: new Error('Network error occurred'),
    refetch: () => Promise.resolve(),
  }),
}));
vi.mock('@app/features/email-thread/queries/thread-source', () => ({
  createEmailThreadSource: () => ({
    thread: () => (state.loadFailed ? undefined : { messages: [] }),
    isLocalDraft: () => false,
  }),
}));
vi.mock('@app/observability/flow', () => ({ usePending: () => {} }));
vi.mock('@app/features/next-soup/actions', () => ({
  useBlockEntityCommands: () => {},
}));
vi.mock('../use-email-detail-list-navigation', () => ({
  useEmailDetailListNavigation: () => ({}),
}));
vi.mock('@app/components/entity-detail/use-list-navigation-hotkeys', () => ({
  useListNavigationHotkeys: () => {},
}));
vi.mock('@block-email/util/emailHotkeys', () => ({
  registerEmailHotkeys: () => {},
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock(
  import('@core/mobile/native-network-status'),
  async (importOriginal) => ({
    ...(await importOriginal()),
    nativeNetworkStatus: () => 'online',
  })
);
vi.mock('@notifications', () => ({ EmailReadMarker: () => null }));
vi.mock('../views/mobile/email-detail', () => ({
  MobileEmailDetail: () => null,
}));
// The thread content registers its keys once it renders, as
// thread-navigation does.
vi.mock('../views/email-detail', () => ({
  EmailDetail: (props: {
    host: EmailThreadHost;
    frame: (thread: () => JSX.Element) => JSX.Element;
  }) =>
    props.frame(() => {
      onMount(() =>
        props.host.registerKeyboard?.({
          cancel: state.cancel,
        } as unknown as KeyboardHandlers)
      );
      return <p>Thread content</p>;
    }),
}));

beforeEach(() => {
  state.closeThread.mockReset();
  state.cancel.mockReset().mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  setActiveScope('global');
});

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function renderThread(loadFailed: boolean) {
  state.loadFailed = loadFailed;
  function Harness() {
    useHotKeyRoot();
    const [attachSplit, splitScope] = useHotkeyDOMScope('email-split');
    state.splitScope = splitScope;
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div ref={attachSplit} tabIndex={0} data-testid="split">
          <EmailDetailView thread={{ id: 'thread-1' }} />
        </div>
      </div>
    );
  }
  const view = render(() => <Harness />);
  view.getByTestId('split').focus();
  return view;
}

it('goes back to the list on Escape when the thread failed to load', () => {
  const view = renderThread(true);
  expect(view.getByText('Unable to load this email')).toBeTruthy();

  press('Escape');

  expect(state.closeThread).toHaveBeenCalledOnce();
});

it('unwinds thread state on Escape before going back to the list', () => {
  const view = renderThread(false);
  expect(view.getByText('Thread content')).toBeTruthy();

  state.cancel.mockReturnValueOnce(true);
  press('Escape');
  expect(state.cancel).toHaveBeenCalledOnce();
  expect(state.closeThread).not.toHaveBeenCalled();

  press('Escape');
  expect(state.closeThread).toHaveBeenCalledOnce();
});
