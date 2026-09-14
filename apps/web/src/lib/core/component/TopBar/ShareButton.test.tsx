import { ForwardToChannel } from '@core/component/ForwardToChannel';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Permissions } from '../SharePermissions';
import { ShareDialogContext, ShareModal, ShareTrigger } from './ShareButton';

const mocks = vi.hoisted(() => ({
  sendToChannel: vi.fn(),
  sendToUsers: vi.fn(),
  mobile: false,
  getDocumentPermissions: vi.fn(),
  getChatPermissions: vi.fn(),
  getProjectPermissions: vi.fn(),
  copyLink: vi.fn(),
  blockPermissionsRead: vi.fn(),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@channel/Input', () => ({
  createConfiguredChannelMarkdownEditor: () => ({
    controls: { focus: vi.fn() },
  }),
}));
vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@core/block', () => ({
  isInBlock: () => true,
  useBlockAliasedName: () => 'agent',
  useBlockId: () => 'launcher-placeholder',
  createBlockEffect: vi.fn(),
  createBlockResource: () => [
    {
      get latest() {
        return mocks.blockPermissionsRead();
      },
    },
    { refetch: vi.fn() },
  ],
  useMaybeBlockName: () => 'md',
  useMaybeBlockAliasedName: () => 'md',
  useMaybeBlockId: () => 'launcher-placeholder',
}));
vi.mock('@core/component/CustomScrollbar', () => ({
  CustomScrollbar: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: () => <textarea aria-label="Optional message" />,
}));
vi.mock('@core/component/RecipientSelector', () => ({
  RecipientSelector: (props: {
    setSelectedOptions: (items: unknown[]) => void;
  }) => (
    <button
      onClick={() =>
        props.setSelectedOptions([{ kind: 'channel', id: 'channel-1' }])
      }
    >
      Select channel
    </button>
  ),
}));

vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
  useHotkeyDOMScope: () => [vi.fn(), 'share-scope'],
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.mobile }));
vi.mock('@core/signal/useCombinedRecipient', () => ({
  useCombinedRecipients: () => ({ all: () => [] }),
}));
vi.mock('@core/util/channels', () => ({ useSendMessageToPeople: () => mocks }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getDocumentPermissions: mocks.getDocumentPermissions,
    projects: { getPermissions: mocks.getProjectPermissions },
  },
  blockNameToItemType: (name: string) =>
    name === 'agent' ? 'agent_session' : 'document',
  itemTypeToReferenceEntityType: (type: string) => type,
}));
vi.mock('@core/component/SharePermissions', () => ({
  Permissions: { OWNER: 'owner' },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@core/component/VerticalScrollIndicators', () => ({
  ScrollIndicators: () => null,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'owner',
  useReferralCode: () => () => undefined,
}));
vi.mock('@channel/use-channel-participants', () => ({
  useChannelParticipants: () => () => [],
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@core/component/Tabs', () => ({ Tabs: () => null }));
vi.mock('@core/signal/blockElement', () => ({
  blockHotkeyScopeSignal: { get: () => '' },
}));
vi.mock('@core/signal/load', () => ({
  blockEditPermissionEnabledSignal: () => true,
}));
vi.mock('@core/signal/permissions', () => ({
  useGetPermissions: () => () => 'owner',
  useIsDocumentOwner: () => () => true,
}));
vi.mock('@core/user', () => ({ idToEmail: (id: string) => id }));
vi.mock('@core/util/currentBlockDocumentName', () => ({
  useBlockDocumentName: () => () => '',
}));
vi.mock('@core/util/url', () => ({
  buildSimpleEntityUrl: ({ type, id }: { type: string; id: string }) =>
    `https://macro.com/app/${type}/${id}`,
}));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: { getChatPermissions: mocks.getChatPermissions },
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('./LoginButton', () => ({ openLoginModal: vi.fn() }));
vi.mock('@kobalte/core/dialog', () => {
  const Container = (props: { children?: JSX.Element }) => props.children;
  return {
    Dialog: Object.assign(Container, {
      Portal: Container,
      Overlay: () => null,
      Content: Container,
      Title: Container,
    }),
  };
});
vi.mock('@components/app/mobile/MobileDrawer', () => {
  const Container = (props: { children?: JSX.Element }) => props.children;
  return {
    MobileDrawer: Object.assign(Container, {
      Portal: Container,
      Overlay: () => null,
      Content: Container,
    }),
  };
});
vi.mock('@ui', () => {
  const Container = (props: { children?: JSX.Element }) => props.children;
  return {
    Button: (props: {
      children?: JSX.Element;
      disabled?: boolean;
      tooltip?: string;
      onClick?: () => void;
    }) => (
      <button
        disabled={props.disabled}
        onClick={props.onClick}
        aria-label={props.tooltip}
      >
        {props.children}
      </button>
    ),
    Panel: Object.assign(Container, { Header: Container, Body: Container }),
    Tooltip: Container,
    Dropdown: Object.assign(Container, {
      Trigger: Container,
      Content: Container,
      Item: Container,
    }),
    ButtonGroup: Object.assign(Container, { Divider: () => null }),
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Hotkey: () => null,
  };
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mobile = false;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.copyLink },
  });
  mocks.sendToChannel.mockResolvedValue({ navigateToChannel: vi.fn() });
});
afterEach(cleanup);
function mountShare(isOwner: boolean) {
  const onOpenChange = vi.fn();
  const onCopyLink = mocks.copyLink;
  render(() => (
    <ShareModal
      id="persisted-session"
      name="Fix the menu"
      owner={isOwner ? 'owner' : 'someone-else'}
      itemType="agent_session"
      blockAlias="agent"
      userPermissions={Permissions.OWNER}
      isSharePermOpen
      setIsSharePermOpen={onOpenChange}
    />
  ));
  return { onOpenChange, onCopyLink };
}
const selectChannel = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Select channel' }));
const share = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));

describe('agent session sharing', () => {
  it('copies the saved session link from the shared header trigger', () => {
    const [id, setId] = createSignal('saved-session');
    render(() => (
      <ShareDialogContext.Provider
        value={{ isOpen: () => false, open: vi.fn(), close: vi.fn() }}
      >
        <ShareTrigger id={id()} />
      </ShareDialogContext.Provider>
    ));
    setId('current-session');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Share Link' }));
    expect(mocks.copyLink).toHaveBeenCalledWith(
      'https://macro.com/app/agent/current-session'
    );
  });
  it('shares the persisted session instead of its enclosing launcher identity', () => {
    const { onOpenChange } = mountShare(true);
    expect(
      screen.getByText('Recipients can view and control this agent session.')
    ).toBeTruthy();
    expect(screen.queryByText('Can view')).toBeNull();
    expect(screen.queryByText('People with access')).toBeNull();
    expect(mocks.blockPermissionsRead).not.toHaveBeenCalled();
    expect(mocks.getDocumentPermissions).not.toHaveBeenCalled();
    expect(mocks.getChatPermissions).not.toHaveBeenCalled();
    expect(mocks.getProjectPermissions).not.toHaveBeenCalled();
    selectChannel();
    share();
    expect(mocks.sendToChannel).toHaveBeenCalledWith({
      attachments: [
        { entity_type: 'agent_session', entity_id: 'persisted-session' },
      ],
      content: '',
      channelId: 'channel-1',
      mentions: [],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it.each([false, true])(
    'lets participants copy a link without exposing a grant action (mobile: %s)',
    (mobile) => {
      mocks.mobile = mobile;
      const { onCopyLink } = mountShare(false);
      expect(
        screen.queryByRole('button', { name: 'Select channel' })
      ).toBeNull();
      expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
      expect(onCopyLink).toHaveBeenCalledWith(
        'https://macro.com/app/agent/persisted-session'
      );
      expect(mocks.sendToChannel).not.toHaveBeenCalled();
    }
  );
  it('cancels an owner draft without sharing', () => {
    const { onOpenChange } = mountShare(true);
    selectChannel();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.sendToChannel).not.toHaveBeenCalled();
  });
  it('provides a working Share action on mobile', () => {
    mocks.mobile = true;
    mountShare(true);
    const button = screen.getByRole('button', { name: 'Share' });
    expect(button.hasAttribute('disabled')).toBe(true);
    selectChannel();
    expect(button.hasAttribute('disabled')).toBe(false);
    share();
    expect(mocks.sendToChannel).toHaveBeenCalledOnce();
  });
  it('keeps context identity for existing forwarding callers without overrides', () => {
    render(() => <ForwardToChannel name="Document" hideAccessLevelSelector />);
    selectChannel();
    share();
    expect(mocks.sendToChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          { entity_type: 'document', entity_id: 'launcher-placeholder' },
        ],
      })
    );
  });
  it('uses the current explicit identity if it changes while mounted', () => {
    const [id, setId] = createSignal('old-session');
    render(() => (
      <ForwardToChannel
        name="Session"
        blockName="agent"
        blockId={id()}
        hideAccessLevelSelector
      />
    ));
    setId('new-session');
    selectChannel();
    share();
    expect(mocks.sendToChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          { entity_type: 'agent_session', entity_id: 'new-session' },
        ],
      })
    );
  });
});
