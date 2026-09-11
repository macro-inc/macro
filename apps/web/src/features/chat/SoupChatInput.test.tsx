import type { MobileNavViewId } from '@components/app/mobile/mobile-nav-views';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createChat: vi.fn(),
  replace: vi.fn(),
  pending: vi.fn(),
  rename: vi.fn(),
  view: 'mail' as MobileNavViewId | undefined,
  createItem: vi.fn(),
  createMenu: vi.fn(),
  openEvent: vi.fn(),
  openCompany: vi.fn(),
}));
vi.mock('@app/features/command/Launcher', () => ({
  setCreateMenuOpen: mocks.createMenu,
  useCreateMenuBlocks: () => () =>
    ['Message', 'Email', 'Document', 'Task', 'Agent'].map((label) => ({
      label,
      keyDownHandler: () => mocks.createItem(label),
    })),
}));
vi.mock('@block-calendar/components/use-open-event-composer', () => ({
  useOpenEventComposer: () => mocks.openEvent,
}));
vi.mock('@app/features/companies/CreateCompanyModal', () => ({
  openCreateCompanyModal: mocks.openCompany,
}));
vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@components/app/mobile/use-mobile-nav', () => ({
  useForegroundMobileView: () => () => mocks.view,
}));
vi.mock('@components/app/mobile/MobileDockIsland', () => ({
  MobileDockIsland: (props: { children: import('solid-js').JSX.Element }) => (
    <div>{props.children}</div>
  ),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@app/features/command/mobile/mobileSearchState', () => ({
  SearchState: { isOpen: () => false },
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
  useSplitPanelOrThrow: () => ({ handle: { replace: mocks.replace } }),
}));
vi.mock('@core/component/AI/component/input/buildChatEditor', () => ({
  buildChatEditor: () => ({ withMentions: () => ({}) }),
}));
vi.mock('@core/component/AI/component/input/ChatInput', () => ({
  ChatInput: (props: {
    onSend: (request: unknown) => void;
    variant?: string;
  }) => (
    <button
      data-variant={props.variant}
      onClick={() =>
        props.onSend({
          content: 'Summarize this document',
          model: 'claude-sonnet-5',
          attachments: [{ entity_id: 'document-id', entity_type: 'document' }],
        })
      }
    >
      Send
    </button>
  ),
}));
vi.mock('@core/component/AI/context', () => ({
  ChatInputProvider: (props: { children: unknown }) => props.children,
  useChatInputContext: () => ({
    model: () => 'claude-sonnet-5',
    attachments: {},
  }),
}));
vi.mock('@core/component/AI/signal/attachment', () => ({
  useGetChatAttachmentInfo: () => ({}),
}));
vi.mock('@core/component/AI/signal/mention-attachment-callbacks', () => ({
  createMentionAttachmentCallbacks: () => ({}),
}));
vi.mock('@core/component/AI/signal/pendingSend', () => ({
  setPendingSendData: mocks.pending,
}));
vi.mock('@core/component/AI/util/storage', () => ({
  getSoupInputStoredModel: () => undefined,
  storeSoupInputModel: vi.fn(),
}));
vi.mock('@core/constant/PaywallState', () => ({
  PaywallKey: {},
  usePaywallState: () => ({}),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
  useHotkeyDOMScope: () => [vi.fn()],
}));
vi.mock('@core/util/handlePaymentError', () => ({
  isPaymentError: () => false,
}));
vi.mock('@entity', () => ({
  createRenameDssEntityMutation: () => ({ mutate: mocks.rename }),
}));
vi.mock('@queries/soup/cache', () => ({ invalidateAllSoup: vi.fn() }));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: { createChat: mocks.createChat },
}));

import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { SoupChatInput } from './SoupChatInput';

let mount: HTMLDivElement;
afterEach(() => {
  cleanup();
  mount.remove();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.view = 'mail';
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // jsdom reports an empty animation name; browsers report `none`. Let
  // Kobalte finish dismissal here; actual motion is checked in the browser.
  const getComputedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = getComputedStyle(element);
    if (!style.animationName) {
      Object.defineProperty(style, 'animationName', { value: 'none' });
    }
    return style;
  });
  mount = document.createElement('div');
  document.body.append(mount);
  FloatRegions.setMount('accessory', mount);
});

describe('Mobile screen AI composer', () => {
  it('starts compact and yields to screen-specific controls, then returns', () => {
    render(() => <SoupChatInput />);
    expect(
      screen.getByRole('button', { name: 'Send' }).getAttribute('data-variant')
    ).toBe('default');
    expect(screen.getByRole('button', { name: 'New email' })).toBeTruthy();
    const reply = render(() => (
      <FloatRegion region="accessory">
        <button>Reply</button>
      </FloatRegion>
    ));
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New email' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
    reply.unmount();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New email' })).toBeTruthy();
  });
  it('creates and opens a chat with the first prompt, selected model, and attachments', async () => {
    mocks.createChat.mockResolvedValue({
      isErr: () => false,
      value: { id: 'new-chat' },
    });
    render(() => <SoupChatInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith({
        next: { type: 'chat', id: 'new-chat' },
      })
    );
    expect(mocks.createChat).toHaveBeenCalledTimes(1);
    expect(mocks.pending).toHaveBeenCalledWith({
      content: 'Summarize this document',
      model: 'claude-sonnet-5',
      attachments: [{ entity_id: 'document-id', entity_type: 'document' }],
    });
    expect(mocks.pending.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.replace.mock.invocationCallOrder[0]
    );
  });
  it('does not navigate or queue a message when creation fails', async () => {
    mocks.createChat.mockResolvedValue({ isErr: () => true });
    render(() => <SoupChatInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.createChat).toHaveBeenCalledTimes(1));
    expect(mocks.pending).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it.each([
    ['mail', 'Email'],
    ['tasks', 'Task'],
    ['documents', 'Document'],
    ['channels', 'Message'],
  ] as const)('keeps New on %s alongside the AI composer', (view, label) => {
    mocks.view = view;
    render(() => <SoupChatInput />);
    const createButton = screen.getByRole('button', {
      name: `New ${label.toLowerCase()}`,
    });
    expect(createButton.textContent).toBe(label);
    fireEvent.click(createButton);
    expect(mocks.createItem).toHaveBeenCalledWith(label);
    expect(mocks.createChat).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });
  it('shows only the AI composer on Agents, without a redundant create button', () => {
    mocks.view = 'agents';
    render(() => <SoupChatInput />);
    expect(screen.queryByRole('button', { name: /^New/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });
  it('opens company creation from CRM alongside the AI composer', () => {
    mocks.view = 'companies';
    render(() => <SoupChatInput />);
    const createButton = screen.getByRole('button', { name: 'New company' });
    expect(createButton.textContent).toBe('Company');
    fireEvent.click(createButton);
    expect(mocks.openCompany).toHaveBeenCalledOnce();
    expect(mocks.createMenu).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });
  it('opens the event composer from the calendar New button', () => {
    mocks.view = 'calendar';
    render(() => <SoupChatInput />);
    const createButton = screen.getByRole('button', { name: 'New event' });
    expect(createButton.textContent).toBe('Event');
    fireEvent.click(createButton);
    expect(mocks.openEvent).toHaveBeenCalledOnce();
  });
  it('opens the create menu on views without a specific New action', () => {
    mocks.view = undefined;
    render(() => <SoupChatInput />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(mocks.createMenu).toHaveBeenCalledWith(true);
  });
  it('opens Home’s quick create actions in the requested order and restores focus on dismissal', async () => {
    mocks.view = 'inbox';
    render(() => <SoupChatInput />);
    const trigger = screen.getByRole('button', { name: 'New' });
    expect(screen.queryByRole('button', { name: 'New message' })).toBeNull();
    fireEvent.click(trigger);
    const menu = await screen.findByRole('dialog', { name: 'Create new' });
    expect(
      within(menu)
        .getAllByRole('button')
        .map((item) => item.textContent)
    ).toEqual(['Email', 'Message', 'Document', 'Event', 'Task', 'More', 'New']);
    fireEvent.click(
      within(menu).getByRole('button', { name: 'Close create menu' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(mocks.createItem).not.toHaveBeenCalled();
  });
  it.each(['Email', 'Message', 'Document', 'Event', 'Task', 'More'])(
    'hands off Home’s %s action after closing the quick menu',
    async (label) => {
      mocks.view = 'inbox';
      render(() => <SoupChatInput />);
      fireEvent.click(screen.getByRole('button', { name: 'New' }));
      const menu = await screen.findByRole('dialog', { name: 'Create new' });
      fireEvent.click(within(menu).getByRole('button', { name: label }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => {
        if (label === 'More')
          expect(mocks.createMenu).toHaveBeenCalledWith(true);
        else if (label === 'Event')
          expect(mocks.openEvent).toHaveBeenCalledOnce();
        else expect(mocks.createItem).toHaveBeenCalledWith(label);
      });
      expect(mocks.createChat).not.toHaveBeenCalled();
    }
  );
});
