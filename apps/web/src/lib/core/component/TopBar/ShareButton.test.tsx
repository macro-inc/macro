import { ForwardToChannel } from '@core/component/ForwardToChannel';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ok } from 'neverthrow';
import { createSignal, For, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Permissions } from '../SharePermissions';
import {
  ShareDialogContext,
  ShareModal,
  ShareOptions,
  ShareTrigger,
} from './ShareButton';

const mocks = vi.hoisted(() => ({
  sendToChannel: vi.fn(),
  sendToUsers: vi.fn(),
  mobile: false,
  hasTeam: false,
  getAgentPermissions: vi.fn(),
  updateAgentPermissions: vi.fn(),
  getDocumentPermissions: vi.fn(),
  getChatPermissions: vi.fn(),
  updateChatPermissions: vi.fn(),
  fetchCallSharePermission: vi.fn(),
  updateCallTeamShare: vi.fn(),
  setCallRecordTeamShareCache: vi.fn(),
  callRecordShared: true,
  callRecordQuerySuccess: true,
  getProjectPermissions: vi.fn(),
  editProject: vi.fn(),
  editDocument: vi.fn(),
  copyLink: vi.fn(),
  blockPermissionsRead: vi.fn(),
  blockEditPermissionEnabled: true,
  inBlock: true,
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
vi.mock('@core/constant/allBlocks', () => ({
  resolveBlockAlias: (name: string) =>
    ['task', 'snippet', 'skill'].includes(name) ? 'md' : name,
}));
vi.mock('@core/block', () => ({
  isInBlock: () => mocks.inBlock,
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
  useBlockName: () => 'md',
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
    getBatchChannelPreviews: async () => ok({ previews: [] }),
    getDocumentPermissions: mocks.getDocumentPermissions,
    editDocument: mocks.editDocument,
    projects: {
      getPermissions: mocks.getProjectPermissions,
      edit: mocks.editProject,
    },
  },
  blockNameToItemType: (name: string) =>
    name === 'agent' ? 'agent_session' : 'document',
  itemTypeToReferenceEntityType: (type: string) => type,
}));
vi.mock('@queries/agent-session/share-permissions', () => ({
  fetchAgentSessionSharePermissions: (...args: unknown[]) =>
    mocks.getAgentPermissions(...args),
  updateAgentSessionSharePermissions: (...args: unknown[]) =>
    mocks.updateAgentPermissions(...args),
}));
vi.mock('@core/component/SharePermissions', () => ({
  Permissions: { OWNER: 'owner', CAN_VIEW: 'view' },
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
  useChannelParticipants: () => ({ users: () => [], ids: () => [] }),
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@core/component/Tabs', () => ({
  Tabs: (props: {
    list: { value: string; label: string }[];
    value?: string;
    onChange?: (value: string) => void;
  }) => (
    <div role="tablist">
      <For each={props.list}>
        {(tab) => (
          <button
            role="tab"
            aria-selected={props.value === tab.value}
            onClick={() => props.onChange?.(tab.value)}
          >
            {tab.label}
          </button>
        )}
      </For>
    </div>
  ),
}));
vi.mock('@core/signal/blockElement', () => ({
  blockHotkeyScopeSignal: { get: () => '' },
}));
vi.mock('@core/signal/load', () => ({
  blockEditPermissionEnabledSignal: () => mocks.blockEditPermissionEnabled,
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
  cognitionApiServiceClient: {
    getChatPermissions: mocks.getChatPermissions,
    updateChatPermissions: mocks.updateChatPermissions,
  },
}));
vi.mock('@queries/call/call', () => ({
  fetchCallSharePermission: (...args: unknown[]) =>
    mocks.fetchCallSharePermission(...args),
  updateCallTeamShare: (...args: unknown[]) =>
    mocks.updateCallTeamShare(...args),
  setCallRecordTeamShareCache: (...args: unknown[]) =>
    mocks.setCallRecordTeamShareCache(...args),
  sharePermissionFromCallRecord: (record: {
    callId: string;
    createdBy: string;
    shareWithTeam: boolean;
  }) => ({
    id: record.callId,
    owner: record.createdBy,
    teamShareAccessLevel: record.shareWithTeam ? 'view' : null,
  }),
  useCallRecordQuery: () => ({
    get isSuccess() {
      return mocks.callRecordQuerySuccess;
    },
    get data() {
      return {
        callId: 'call-1',
        createdBy: 'owner',
        shareWithTeam: mocks.callRecordShared,
      };
    },
  }),
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isSuccess: mocks.hasTeam,
    data: mocks.hasTeam ? { id: 'team-1' } : undefined,
  }),
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
vi.mock('@ui', async () => {
  const { createContext, useContext } = await import('solid-js');
  const RadioContext = createContext<{
    label: string;
    onChange?: (value: string) => void;
  }>();
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
      // Use only rendered options, so the mock cannot invent unsupported grants.
      RadioGroup: (props: {
        children?: JSX.Element;
        value?: string;
        'aria-label'?: string;
        onChange?: (value: string) => void;
      }) => {
        const label = props['aria-label'] ?? 'option';
        return (
          <div role="group" aria-label={label} data-value={props.value}>
            <RadioContext.Provider value={{ label, onChange: props.onChange }}>
              {props.children}
            </RadioContext.Provider>
          </div>
        );
      },
      RadioItem: (props: { value: string; children?: JSX.Element }) => {
        const group = useContext(RadioContext);
        return (
          <button
            aria-label={`Set ${group?.label} ${props.value}`}
            onClick={() => group?.onChange?.(props.value)}
          >
            {props.children}
          </button>
        );
      },
      ItemIndicator: Container,
      Group: Container,
    }),
    ButtonGroup: Object.assign(Container, { Divider: () => null }),
    SegmentedControl: (props: {
      'aria-label'?: string;
      onChange?: (value: string) => void;
    }) => (
      <div role="group" aria-label={props['aria-label']}>
        <For each={['NONE', 'PUBLIC', 'TEAM']}>
          {(scope) => (
            <button onClick={() => props.onChange?.(scope)}>
              Set link {scope}
            </button>
          )}
        </For>
      </div>
    ),
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Hotkey: () => null,
  };
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.inBlock = true;
  mocks.blockEditPermissionEnabled = true;
  mocks.mobile = false;
  mocks.hasTeam = false;
  mocks.callRecordShared = true;
  mocks.callRecordQuerySuccess = true;
  mocks.getAgentPermissions.mockResolvedValue(
    ok({
      id: 'session-permissions',
      owner: 'owner',
      channelSharePermissions: [],
    })
  );
  mocks.updateAgentPermissions.mockResolvedValue(ok({}));
  mocks.updateChatPermissions.mockResolvedValue({ isErr: () => false });
  mocks.updateCallTeamShare.mockResolvedValue({ isErr: () => false });
  mocks.editProject.mockResolvedValue({ isErr: () => false });
  mocks.editDocument.mockResolvedValue({ isErr: () => false });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.copyLink },
  });
  mocks.sendToChannel.mockResolvedValue({
    channelId: 'channel-1',
    navigateToChannel: vi.fn(),
  });
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
  it.each([false, true])(
    'offers Edit for forwarding, people, and links when the legacy block disables editing (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      mocks.blockEditPermissionEnabled = false;
      mocks.getAgentPermissions.mockResolvedValue(
        ok({
          id: 'session-permissions',
          owner: 'owner',
          linkShare: 'PUBLIC',
          linkShareAccessLevel: 'view',
          channelSharePermissions: [
            { channel_id: 'shared-channel', access_level: 'view' },
          ],
        })
      );
      mountShare(true);
      const editOptions = () =>
        screen.getAllByRole('button', { name: 'Set option edit' });
      await vi.waitFor(() =>
        expect(editOptions()).toHaveLength(mobile ? 1 : 3)
      );

      fireEvent.click(editOptions()[0]);
      selectChannel();
      share();
      await vi.waitFor(() =>
        expect(mocks.updateAgentPermissions).toHaveBeenCalledWith(
          'persisted-session',
          {
            channelSharePermissions: [
              {
                operation: 'replace',
                accessLevel: 'edit',
                channelId: 'channel-1',
              },
            ],
          }
        )
      );

      if (mobile) fireEvent.click(screen.getByRole('tab', { name: 'People' }));
      fireEvent.click(editOptions()[mobile ? 0 : 1]);
      await vi.waitFor(() =>
        expect(mocks.updateAgentPermissions).toHaveBeenCalledWith(
          'persisted-session',
          {
            channelSharePermissions: [
              {
                operation: 'replace',
                accessLevel: 'edit',
                channelId: 'shared-channel',
              },
            ],
          }
        )
      );

      if (mobile) fireEvent.click(screen.getByRole('tab', { name: 'Link' }));
      fireEvent.click(editOptions()[mobile ? 0 : 2]);
      await vi.waitFor(() =>
        expect(mocks.updateAgentPermissions).toHaveBeenCalledWith(
          'persisted-session',
          { linkShare: 'PUBLIC', linkShareAccessLevel: 'edit' }
        )
      );
    }
  );

  it.each([false, true])(
    'updates public links and team access through session permissions (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      mocks.hasTeam = true;
      mountShare(true);
      if (mobile) fireEvent.click(screen.getByRole('tab', { name: 'Link' }));

      fireEvent.click(screen.getByRole('button', { name: 'Set link PUBLIC' }));
      await vi.waitFor(() =>
        expect(mocks.updateAgentPermissions).toHaveBeenCalledWith(
          'persisted-session',
          { linkShare: 'PUBLIC', linkShareAccessLevel: 'view' }
        )
      );
      fireEvent.click(screen.getByRole('button', { name: 'Set link NONE' }));
      await vi.waitFor(() =>
        expect(mocks.updateAgentPermissions).toHaveBeenCalledWith(
          'persisted-session',
          { linkShare: null, linkShareAccessLevel: null }
        )
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Set Team access level edit' })
      );
      await vi.waitFor(() =>
        expect(mocks.updateAgentPermissions).toHaveBeenCalledWith(
          'persisted-session',
          { teamShareAccessLevel: 'edit' }
        )
      );
      expect(mocks.editDocument).not.toHaveBeenCalled();
      expect(mocks.updateChatPermissions).not.toHaveBeenCalled();
    }
  );

  it('lists the owner in the mobile People tab', () => {
    mocks.mobile = true;
    mountShare(true);
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    expect(screen.getByText('Me')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
  });

  it.each([false, true])(
    'shows the standard share form for owners (mobile: %s)',
    (mobile) => {
      mocks.mobile = mobile;
      mountShare(true);
      expect(
        screen.getByRole('button', { name: 'Select channel' })
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
      if (mobile) {
        expect(screen.getByRole('tab', { name: 'People' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Link' })).toBeTruthy();
      } else {
        expect(
          screen.getByText('People with access to this agent session')
        ).toBeTruthy();
        expect(
          screen.getByRole('group', { name: 'Link sharing scope' })
        ).toBeTruthy();
      }
      expect(
        screen.queryByText(
          'Recipients can view and control this agent session.'
        )
      ).toBeNull();
    }
  );

  it('uses explicit identity outside a block', () => {
    mocks.inBlock = false;
    render(() => (
      <ShareDialogContext.Provider
        value={{ isOpen: () => false, open: vi.fn(), close: vi.fn() }}
      >
        <ShareTrigger id="task-1" blockType="task" />
      </ShareDialogContext.Provider>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Share Link' }));
    expect(mocks.copyLink).toHaveBeenCalledWith(
      'https://macro.com/app/task/task-1'
    );
  });

  it('uses a host view contextual link when provided', () => {
    mocks.inBlock = false;
    const copyContextLink = vi.fn();
    render(() => (
      <ShareDialogContext.Provider
        value={{
          isOpen: () => false,
          open: vi.fn(),
          close: vi.fn(),
          copyLink: copyContextLink,
        }}
      >
        <ShareTrigger id="task-1" blockType="task" />
      </ShareDialogContext.Provider>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Copy Share Link' }));
    expect(copyContextLink).toHaveBeenCalledOnce();
    expect(mocks.copyLink).not.toHaveBeenCalled();
  });

  it('uses the host view contextual link inside the share modal', () => {
    const copyContextLink = vi.fn();
    render(() => (
      <ShareDialogContext.Provider
        value={{
          isOpen: () => true,
          open: vi.fn(),
          close: vi.fn(),
          copyLink: copyContextLink,
        }}
      >
        <ShareModal
          id="persisted-session"
          name="Fix the menu"
          owner="someone-else"
          itemType="agent_session"
          blockAlias="agent"
          userPermissions={Permissions.CAN_VIEW}
          isSharePermOpen
          setIsSharePermOpen={vi.fn()}
        />
      </ShareDialogContext.Provider>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
    expect(copyContextLink).toHaveBeenCalledOnce();
    expect(mocks.copyLink).not.toHaveBeenCalled();
  });

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
  it('shares the persisted session instead of its enclosing launcher identity', async () => {
    const { onOpenChange } = mountShare(true);
    expect(
      screen.getByText('People with access to this agent session')
    ).toBeTruthy();
    expect(mocks.blockPermissionsRead).not.toHaveBeenCalled();
    expect(mocks.getDocumentPermissions).not.toHaveBeenCalled();
    expect(mocks.getChatPermissions).not.toHaveBeenCalled();
    expect(mocks.getProjectPermissions).not.toHaveBeenCalled();
    expect(mocks.getAgentPermissions).toHaveBeenCalledWith('persisted-session');
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
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.updateAgentPermissions).toHaveBeenCalledWith(
      'persisted-session',
      {
        channelSharePermissions: [
          { operation: 'replace', accessLevel: 'view', channelId: 'channel-1' },
        ],
      }
    );
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
      expect(
        screen.queryByRole('group', { name: 'Link sharing scope' })
      ).toBeNull();
      expect(screen.queryByRole('tab', { name: 'Link' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
      expect(onCopyLink).toHaveBeenCalledWith(
        'https://macro.com/app/agent/persisted-session'
      );
      expect(mocks.sendToChannel).not.toHaveBeenCalled();
      expect(mocks.updateAgentPermissions).not.toHaveBeenCalled();
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

describe('share edit availability', () => {
  it.each([
    { legacy: false, explicit: undefined, expected: false },
    { legacy: true, explicit: undefined, expected: true },
    { legacy: false, explicit: true, expected: true },
    { legacy: true, explicit: false, expected: false },
  ])('honors capability overrides: %j', ({ legacy, explicit, expected }) => {
    mocks.blockEditPermissionEnabled = legacy;
    render(() => (
      <ShareOptions editPermissionEnabled={explicit} setPermissions={vi.fn()} />
    ));
    expect(
      screen.queryByRole('button', { name: 'Set option edit' }) !== null
    ).toBe(expected);
  });
});

function mountChatShare() {
  mocks.blockPermissionsRead.mockReturnValue({
    isErr: () => false,
    value: {
      id: 'perm-1',
      owner: 'owner',
      linkShare: null,
      linkShareAccessLevel: null,
      teamShareAccessLevel: 'view',
      channelSharePermissions: [],
    },
  });
  render(() => (
    <ShareModal
      id="chat-1"
      name="Planning chat"
      owner="owner"
      itemType="chat"
      blockAlias="chat"
      userPermissions={Permissions.OWNER}
      isSharePermOpen
      setIsSharePermOpen={vi.fn()}
    />
  ));
}

function mountCallShare() {
  mocks.blockPermissionsRead.mockReturnValue({
    isErr: () => false,
    value: {
      id: 'perm-call',
      owner: 'owner',
      linkShare: null,
      linkShareAccessLevel: null,
      teamShareAccessLevel: 'view',
      channelSharePermissions: [],
    },
  });
  render(() => (
    <ShareModal
      id="call-1"
      name="Weekly sync"
      owner="owner"
      itemType="call"
      blockAlias="call"
      userPermissions={Permissions.OWNER}
      isSharePermOpen
      setIsSharePermOpen={vi.fn()}
    />
  ));
}

describe('call team sharing', () => {
  it('lets the owner share the call with their team at view', async () => {
    mocks.hasTeam = true;
    mountCallShare();

    expect(screen.getByText('Team access')).toBeTruthy();
    expect(
      screen.getByText("Share this call directly with the owner's team.")
    ).toBeTruthy();
    expect(
      screen
        .getByRole('group', { name: 'Team access level' })
        .getAttribute('data-value')
    ).toBe('view');

    fireEvent.click(
      screen.getByRole('button', { name: 'Set Team access level view' })
    );

    await vi.waitFor(() =>
      expect(mocks.updateCallTeamShare).toHaveBeenCalledWith('call-1', true)
    );
    expect(mocks.setCallRecordTeamShareCache).toHaveBeenCalledWith(
      'call-1',
      true
    );
    expect(mocks.updateChatPermissions).not.toHaveBeenCalled();
    expect(mocks.editDocument).not.toHaveBeenCalled();
    expect(mocks.editProject).not.toHaveBeenCalled();
  });

  it('clears call team access with an explicit null', async () => {
    mocks.hasTeam = true;
    mountCallShare();

    fireEvent.click(
      screen.getByRole('button', { name: 'Set Team access level NONE' })
    );

    await vi.waitFor(() =>
      expect(mocks.updateCallTeamShare).toHaveBeenCalledWith('call-1', false)
    );
    expect(mocks.setCallRecordTeamShareCache).toHaveBeenCalledWith(
      'call-1',
      false
    );
  });

  it('shows team access from the call record cache after the checkbox writes it', () => {
    mocks.hasTeam = true;
    mocks.callRecordShared = false;
    mountCallShare();

    expect(
      screen
        .getByRole('group', { name: 'Team access level' })
        .getAttribute('data-value')
    ).toBe('NONE');
  });

  it('hides call team access when the owner has no team', () => {
    mocks.hasTeam = false;
    mountCallShare();

    expect(screen.queryByText('Team access')).toBeNull();
    expect(
      screen.queryByRole('group', { name: 'Team access level' })
    ).toBeNull();
    expect(mocks.updateCallTeamShare).not.toHaveBeenCalled();
  });

  it('loads team access from the call record outside a block', () => {
    mocks.inBlock = false;
    mocks.hasTeam = true;
    mountCallShare();

    expect(
      screen
        .getByRole('group', { name: 'Team access level' })
        .getAttribute('data-value')
    ).toBe('view');
    expect(mocks.fetchCallSharePermission).not.toHaveBeenCalled();
  });
});

describe('chat team sharing', () => {
  it('lets the owner share the chat with their team through the chat permissions endpoint', async () => {
    mocks.hasTeam = true;
    mountChatShare();

    expect(screen.getByText('Team access')).toBeTruthy();
    expect(
      screen.getByText("Share this chat directly with the owner's team.")
    ).toBeTruthy();
    expect(
      screen.getByRole('group', { name: 'Link sharing scope' })
    ).toBeTruthy();
    expect(
      screen
        .getByRole('group', { name: 'Team access level' })
        .getAttribute('data-value')
    ).toBe('view');

    fireEvent.click(
      screen.getByRole('button', { name: 'Set Team access level edit' })
    );

    await vi.waitFor(() =>
      expect(mocks.updateChatPermissions).toHaveBeenCalledWith({
        chat_id: 'chat-1',
        sharePermission: { teamShareAccessLevel: 'edit' },
      })
    );
    expect(mocks.getDocumentPermissions).not.toHaveBeenCalled();
  });

  it('clears team access with an explicit null', async () => {
    mocks.hasTeam = true;
    mountChatShare();

    fireEvent.click(
      screen.getByRole('button', { name: 'Set Team access level NONE' })
    );

    await vi.waitFor(() =>
      expect(mocks.updateChatPermissions).toHaveBeenCalledWith({
        chat_id: 'chat-1',
        sharePermission: { teamShareAccessLevel: null },
      })
    );
  });

  it('hides team access when the owner has no team', () => {
    mocks.hasTeam = false;
    mountChatShare();

    expect(screen.queryByText('Team access')).toBeNull();
    expect(
      screen.queryByRole('group', { name: 'Team access level' })
    ).toBeNull();
    expect(mocks.updateChatPermissions).not.toHaveBeenCalled();
  });
});

function mountProjectShare() {
  mocks.blockPermissionsRead.mockReturnValue({
    isErr: () => false,
    value: {
      id: 'perm-project',
      owner: 'owner',
      linkShare: null,
      linkShareAccessLevel: null,
      teamShareAccessLevel: 'view',
      channelSharePermissions: [],
    },
  });
  render(() => (
    <ShareModal
      id="project-1"
      name="Launch folder"
      owner="owner"
      itemType="project"
      blockAlias="project"
      userPermissions={Permissions.OWNER}
      isSharePermOpen
      setIsSharePermOpen={vi.fn()}
    />
  ));
}

describe('project team sharing', () => {
  it('lets the owner share the folder with their team without a link sharing card', async () => {
    mocks.hasTeam = true;
    mountProjectShare();

    expect(screen.getByText('Team access')).toBeTruthy();
    expect(
      screen.getByText("Share this folder directly with the owner's team.")
    ).toBeTruthy();
    expect(
      screen.queryByRole('group', { name: 'Link sharing scope' })
    ).toBeNull();
    expect(screen.queryByText('Link sharing off')).toBeNull();
    expect(
      screen
        .getByRole('group', { name: 'Team access level' })
        .getAttribute('data-value')
    ).toBe('view');

    fireEvent.click(
      screen.getByRole('button', { name: 'Set Team access level edit' })
    );

    await vi.waitFor(() =>
      expect(mocks.editProject).toHaveBeenCalledWith({
        id: 'project-1',
        sharePermission: { teamShareAccessLevel: 'edit' },
      })
    );
    expect(mocks.updateChatPermissions).not.toHaveBeenCalled();
    expect(mocks.editDocument).not.toHaveBeenCalled();
  });

  it('clears folder team access with an explicit null', async () => {
    mocks.hasTeam = true;
    mountProjectShare();

    fireEvent.click(
      screen.getByRole('button', { name: 'Set Team access level NONE' })
    );

    await vi.waitFor(() =>
      expect(mocks.editProject).toHaveBeenCalledWith({
        id: 'project-1',
        sharePermission: { teamShareAccessLevel: null },
      })
    );
  });

  it('hides folder team access when the owner has no team', () => {
    mocks.hasTeam = false;
    mountProjectShare();

    expect(screen.queryByText('Team access')).toBeNull();
    expect(
      screen.queryByRole('group', { name: 'Team access level' })
    ).toBeNull();
    expect(
      screen.queryByRole('group', { name: 'Link sharing scope' })
    ).toBeNull();
    expect(mocks.editProject).not.toHaveBeenCalled();
  });

  it('puts folder team access on a Team tab and omits the Link tab', () => {
    mocks.mobile = true;
    mocks.hasTeam = true;
    mountProjectShare();

    expect(screen.queryByRole('tab', { name: 'Link' })).toBeNull();
    expect(screen.queryByText('Team access')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Team' }));

    expect(screen.getByText('Team access')).toBeTruthy();
    expect(
      screen.getByText("Share this folder directly with the owner's team.")
    ).toBeTruthy();
    expect(
      screen.queryByRole('group', { name: 'Link sharing scope' })
    ).toBeNull();
  });
});
