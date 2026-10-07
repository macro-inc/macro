import { ForwardToChannel } from '@core/component/ForwardToChannel';
import { queryClient } from '@queries/client';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { err, ok } from 'neverthrow';
import { createSignal, For, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Permissions } from '../SharePermissions';
import {
  refetchDocumentShareButtonResource,
  ShareModal,
  ShareOptions,
  ShareTrigger,
  shareLevelsFor,
} from './ShareButton';

const ME = 'macro|me@example.com';
const SOMEONE_ELSE = 'macro|someone-else@example.com';

const mocks = vi.hoisted(() => ({
  sendToChannel: vi.fn(),
  sendToUsers: vi.fn(),
  mobile: false,
  hasTeam: false,
  getAgentPermissions: vi.fn(),
  updateAgentPermissions: vi.fn(),
  getInitiativePermissions: vi.fn(),
  updateInitiativePermissions: vi.fn(),
  getDocumentPermissions: vi.fn(),
  getDatabasePermissions: vi.fn(),
  updateDatabasePermissions: vi.fn(),
  getFormPermissions: vi.fn(),
  updateFormPermissions: vi.fn(),
  getChatPermissions: vi.fn(),
  updateChatPermissions: vi.fn(),
  fetchCallSharePermission: vi.fn(),
  updateCallTeamShare: vi.fn(),
  setCallRecordTeamShareCache: vi.fn(),
  callRecordShared: true,
  callRecordChannelId: 'channel-1' as string | null,
  callRecordQuerySuccess: true,
  getProjectPermissions: vi.fn(),
  editProject: vi.fn(),
  editDocument: vi.fn(),
  copyLink: vi.fn(),
  blockPermissionsRead: vi.fn(),
  blockEditPermissionEnabled: true,
  inBlock: true,
}));
vi.mock('@queries/storage/databases', () => ({
  getDatabaseSharePermissions: mocks.getDatabasePermissions,
  updateDatabaseSharePermissions: mocks.updateDatabasePermissions,
}));
vi.mock('@queries/storage/forms', () => ({
  getFormSharePermissions: mocks.getFormPermissions,
  updateFormSharePermissions: mocks.updateFormPermissions,
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
    name === 'agent' ? 'agent_session' : name === 'form' ? 'form' : 'document',
  itemTypeToReferenceEntityType: (type: string) => type,
}));
vi.mock('@queries/agent-session/share-permissions', () => ({
  fetchAgentSessionSharePermissions: (...args: unknown[]) =>
    mocks.getAgentPermissions(...args),
  updateAgentSessionSharePermissions: (...args: unknown[]) =>
    mocks.updateAgentPermissions(...args),
}));
vi.mock('@queries/initiative/share-permissions', () => ({
  fetchInitiativeSharePermissions: (...args: unknown[]) =>
    mocks.getInitiativePermissions(...args),
  updateInitiativeSharePermissions: (...args: unknown[]) =>
    mocks.updateInitiativePermissions(...args),
}));
vi.mock('@core/component/SharePermissions', () => ({
  Permissions: { OWNER: 'owner', CAN_VIEW: 'view' },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn(), alert: vi.fn() },
}));
vi.mock('@core/component/VerticalScrollIndicators', () => ({
  ScrollIndicators: () => null,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => ME,
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
vi.mock('@core/user', () => ({ getDisplayName: (id: string) => id }));
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
        channelId: mocks.callRecordChannelId,
        createdBy: ME,
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
  const Button = (props: {
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
  );
  return {
    Button,
    CopyButton: Button,
    Panel: Object.assign(Container, { Header: Container, Body: Container }),
    // The owner row draws an unknown owner's avatar.
    Avatar: Object.assign(Container, { Fallback: Container }),
    Tooltip: (props: { label?: string; children?: JSX.Element }) => (
      <span title={props.label}>{props.children}</span>
    ),
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
  queryClient.clear();
  vi.clearAllMocks();
  mocks.inBlock = true;
  mocks.blockEditPermissionEnabled = true;
  mocks.mobile = false;
  mocks.hasTeam = false;
  mocks.callRecordShared = true;
  mocks.callRecordChannelId = 'channel-1';
  mocks.callRecordQuerySuccess = true;
  mocks.getAgentPermissions.mockResolvedValue(
    ok({
      id: 'session-permissions',
      owner: ME,
      channelSharePermissions: [],
    })
  );
  mocks.updateAgentPermissions.mockResolvedValue(ok({}));
  mocks.getInitiativePermissions.mockResolvedValue(
    ok({ id: 'project-permissions', owner: ME })
  );
  mocks.updateInitiativePermissions.mockResolvedValue(ok({}));
  mocks.getFormPermissions.mockResolvedValue(
    ok({ id: 'form-id', owner: ME, channelSharePermissions: [] })
  );
  mocks.updateFormPermissions.mockResolvedValue(ok({}));
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
      owner={isOwner ? ME : SOMEONE_ELSE}
      itemType="agent_session"
      blockAlias="agent"
      userPermissions={Permissions.OWNER}
      open
      onOpenChange={onOpenChange}
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
          owner: ME,
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

      await vi.waitFor(() =>
        expect(mocks.getAgentPermissions).toHaveBeenCalledWith(
          'persisted-session'
        )
      );
      await vi.waitFor(() =>
        expect(screen.getByText('Link sharing off')).toBeTruthy()
      );
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
      <ShareTrigger onClick={vi.fn()} id="task-1" blockType="task" />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Share Link' }));
    expect(mocks.copyLink).toHaveBeenCalledWith(
      'https://macro.com/app/task/task-1'
    );
  });

  it('opens sharing through the provided handler', () => {
    mocks.inBlock = false;
    const onClick = vi.fn();
    render(() => (
      <ShareTrigger onClick={onClick} id="task-1" blockType="task" />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('uses a host view contextual link when provided', () => {
    mocks.inBlock = false;
    const copyContextLink = vi.fn();
    render(() => (
      <ShareTrigger
        onClick={vi.fn()}
        id="task-1"
        blockType="task"
        copyLink={copyContextLink}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Copy Share Link' }));
    expect(copyContextLink).toHaveBeenCalledOnce();
    expect(mocks.copyLink).not.toHaveBeenCalled();
  });

  it('uses the host view contextual link inside the share modal', () => {
    const copyContextLink = vi.fn();
    render(() => (
      <ShareModal
        id="persisted-session"
        name="Fix the menu"
        owner={SOMEONE_ELSE}
        itemType="agent_session"
        blockAlias="agent"
        userPermissions={Permissions.CAN_VIEW}
        open
        onOpenChange={vi.fn()}
        copyLink={copyContextLink}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
    expect(copyContextLink).toHaveBeenCalledOnce();
    expect(mocks.copyLink).not.toHaveBeenCalled();
  });

  it('copies the saved session link from the shared header trigger', () => {
    const [id, setId] = createSignal('saved-session');
    render(() => <ShareTrigger onClick={vi.fn()} id={id()} />);
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
    await vi.waitFor(() =>
      expect(mocks.getAgentPermissions).toHaveBeenCalledWith(
        'persisted-session'
      )
    );
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
  const sharePermissions = {
    id: 'perm-1',
    owner: ME,
    linkShare: null,
    linkShareAccessLevel: null,
    teamShareAccessLevel: 'view' as const,
    channelSharePermissions: [],
  };
  render(() => (
    <ShareModal
      id="chat-1"
      name="Planning chat"
      owner={ME}
      itemType="chat"
      blockAlias="chat"
      sharePermissions={sharePermissions}
      userPermissions={Permissions.OWNER}
      open
      onOpenChange={vi.fn()}
    />
  ));
}

function mountCallShare() {
  mocks.blockPermissionsRead.mockReturnValue({
    isErr: () => false,
    value: {
      id: 'perm-call',
      owner: ME,
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
      owner={ME}
      itemType="call"
      blockAlias="call"
      userPermissions={Permissions.OWNER}
      open
      onOpenChange={vi.fn()}
    />
  ));
}

describe('call team sharing', () => {
  it('hides team access for a standalone call even when stale permissions claim it is shared', () => {
    mocks.hasTeam = true;
    mocks.callRecordChannelId = null;
    mountCallShare();

    expect(screen.queryByText('Team access')).toBeNull();
    expect(
      screen.queryByRole('group', { name: 'Team access level' })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(mocks.updateCallTeamShare).not.toHaveBeenCalled();
  });

  it('does not offer team access until the call channel is known', () => {
    mocks.hasTeam = true;
    mocks.callRecordQuerySuccess = false;
    mountCallShare();
    expect(screen.queryByText('Team access')).toBeNull();
  });

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
  const sharePermissions = {
    id: 'perm-project',
    owner: ME,
    linkShare: null,
    linkShareAccessLevel: null,
    teamShareAccessLevel: 'view' as const,
    channelSharePermissions: [],
  };
  render(() => (
    <ShareModal
      id="project-1"
      name="Launch folder"
      owner={ME}
      itemType="project"
      blockAlias="project"
      sharePermissions={sharePermissions}
      userPermissions={Permissions.OWNER}
      open
      onOpenChange={vi.fn()}
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

describe('native project sharing', () => {
  function mountProject(
    options: {
      owner?: string;
      people?: () => JSX.Element;
      hasDirectShares?: boolean;
    } = {}
  ) {
    mocks.inBlock = false;
    const owner = options.owner ?? ME;
    render(() => (
      <ShareModal
        id="initiative-1"
        name="Launch"
        owner={owner}
        itemType="initiative"
        blockAlias="initiative"
        userPermissions={
          owner === ME ? Permissions.OWNER : Permissions.CAN_VIEW
        }
        people={options.people}
        hasDirectShares={options.hasDirectShares}
        open
        onOpenChange={vi.fn()}
      />
    ));
  }

  it('grants the destination before forwarding the project itself', async () => {
    const order: string[] = [];
    mocks.updateInitiativePermissions.mockImplementation(async () => {
      order.push('grant');
      return ok({});
    });
    mocks.sendToChannel.mockImplementation(async (input) => {
      await input.beforeSend?.(input.channelId);
      order.push('message');
      return { channelId: input.channelId, navigateToChannel: vi.fn() };
    });
    mountProject();
    selectChannel();
    share();
    await vi.waitFor(() => expect(order).toEqual(['grant', 'message']));
    expect(mocks.sendToChannel.mock.calls[0][0].attachments).toEqual([
      { entity_type: 'initiative', entity_id: 'initiative-1' },
    ]);
    expect(mocks.updateInitiativePermissions).toHaveBeenCalledOnce();
    expect(mocks.updateInitiativePermissions).toHaveBeenCalledWith(
      'initiative-1',
      {
        channelSharePermissions: [
          { operation: 'replace', accessLevel: 'view', channelId: 'channel-1' },
        ],
      }
    );
    expect(mocks.getDocumentPermissions).not.toHaveBeenCalled();
    expect(mocks.blockPermissionsRead).not.toHaveBeenCalled();
  });

  it('does not post the project when its grant fails', async () => {
    mocks.updateInitiativePermissions.mockResolvedValue(
      err([{ code: 'FORBIDDEN', message: 'Not the owner' }])
    );
    const posted = vi.fn();
    mocks.sendToChannel.mockImplementation(async (input) => {
      await input.beforeSend?.(input.channelId);
      posted();
      return { channelId: input.channelId, navigateToChannel: vi.fn() };
    });
    mountProject();
    selectChannel();
    share();
    const { toast } = await import('@core/component/Toast/Toast');
    await vi.waitFor(() =>
      expect(toast.failure).toHaveBeenCalledWith('Message failed to send')
    );
    expect(posted).not.toHaveBeenCalled();
  });

  it('lets only the owner forward a project', () => {
    mountProject({ owner: SOMEONE_ELSE });
    expect(
      screen.getByText(
        'Only the owner can share access to this project. You can copy a link for people who already have access.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select channel' })).toBeNull();
  });

  it('changes team, link and channel grants through the project', async () => {
    mocks.hasTeam = true;
    mocks.getInitiativePermissions.mockResolvedValue(
      ok({
        id: 'project-permissions',
        owner: ME,
        teamShareAccessLevel: 'view',
        channelSharePermissions: [
          { channel_id: 'channel-1', access_level: 'edit' },
        ],
      })
    );
    mountProject();
    // The recipient row appears once the project's grants have loaded.
    await screen.findByRole('button', { name: 'Set option none' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Set Team access level edit' })
    );
    await vi.waitFor(() =>
      expect(mocks.updateInitiativePermissions).toHaveBeenCalledWith(
        'initiative-1',
        { teamShareAccessLevel: 'edit' }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set link PUBLIC' }));
    await vi.waitFor(() =>
      expect(mocks.updateInitiativePermissions).toHaveBeenCalledWith(
        'initiative-1',
        { linkShare: 'PUBLIC', linkShareAccessLevel: 'view' }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set option none' }));
    await vi.waitFor(() =>
      expect(mocks.updateInitiativePermissions).toHaveBeenCalledWith(
        'initiative-1',
        {
          channelSharePermissions: [
            { operation: 'remove', channelId: 'channel-1' },
          ],
        }
      )
    );
    expect(mocks.editDocument).not.toHaveBeenCalled();
    expect(mocks.editProject).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'lists direct collaborators among the people with access (mobile: %s)',
    (mobile) => {
      mocks.mobile = mobile;
      mountProject({
        people: () => <div>Collaborator row</div>,
        hasDirectShares: true,
      });
      if (mobile) fireEvent.click(screen.getByRole('tab', { name: 'People' }));
      else
        expect(
          screen.getByText('People with access to this project')
        ).toBeTruthy();
      expect(screen.getByText('Collaborator row')).toBeTruthy();
      if (mobile) fireEvent.click(screen.getByRole('tab', { name: 'Link' }));
      expect(screen.getByText('Shared')).toBeTruthy();
    }
  );

  it('copies the project route instead of a block URL', () => {
    mocks.inBlock = false;
    render(() => (
      <ShareTrigger
        onClick={vi.fn()}
        id="initiative-1"
        blockType="initiative"
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Share Link' }));
    expect(mocks.copyLink).toHaveBeenCalledWith(
      'https://macro.com/app/component/initiative-view~initiative-1~overview'
    );
  });
});

it('database sharing accepts supplied grants and disables public links', () => {
  const sharePermissions = {
    id: 'database-id',
    owner: 'owner',
    channelSharePermissions: [],
  };
  render(() => (
    <ShareModal
      id="database-id"
      sharePermissions={sharePermissions}
      itemType="database"
      blockAlias="database"
      owner="owner"
      name="Ideas"
      userPermissions={Permissions.OWNER}
      open
      onOpenChange={() => {}}
    />
  ));
  expect(mocks.blockPermissionsRead).not.toHaveBeenCalled();
  expect(mocks.getDatabasePermissions).not.toHaveBeenCalled();
  expect(screen.queryByText('Anyone with the link')).toBeNull();
});

describe('entity-owned sharing queries', () => {
  it('shares one cached request across triggers for the same entity', async () => {
    mocks.inBlock = false;
    mocks.getDocumentPermissions.mockResolvedValue(
      ok({
        id: 'doc-1',
        owner: ME,
        linkShare: 'PUBLIC',
        channelSharePermissions: [],
      })
    );
    render(() => (
      <>
        <ShareTrigger id="doc-1" blockType="md" onClick={vi.fn()} />
        <ShareTrigger id="doc-1" blockType="md" onClick={vi.fn()} />
      </>
    ));
    await vi.waitFor(() =>
      expect(mocks.getDocumentPermissions).toHaveBeenCalledOnce()
    );
    await vi.waitFor(() =>
      expect(
        screen.getAllByTitle('Anyone with the link can access this item.')
      ).toHaveLength(2)
    );
  });

  it('invalidates cached grants through the legacy refetch API', async () => {
    mocks.inBlock = false;
    mocks.getDocumentPermissions.mockResolvedValue(
      ok({ id: 'doc-refresh', owner: ME, channelSharePermissions: [] })
    );
    render(() => (
      <ShareTrigger id="doc-refresh" blockType="md" onClick={vi.fn()} />
    ));
    await vi.waitFor(() =>
      expect(mocks.getDocumentPermissions).toHaveBeenCalledOnce()
    );
    await vi.waitFor(() =>
      expect(
        queryClient
          .getQueryCache()
          .getAll()
          .find((q) => q.queryKey[0] === 'sharing')?.state.fetchStatus
      ).toBe('idle')
    );
    refetchDocumentShareButtonResource();
    await vi.waitFor(() =>
      expect(mocks.getDocumentPermissions).toHaveBeenCalledTimes(2)
    );
  });

  it('uses entity identity instead of the enclosing block identity', async () => {
    mocks.getDocumentPermissions.mockResolvedValue(
      ok({ id: 'doc-2', owner: ME, channelSharePermissions: [] })
    );
    render(() => (
      <ShareTrigger id="doc-2" blockType="spreadsheet" onClick={vi.fn()} />
    ));
    await vi.waitFor(() =>
      expect(mocks.getDocumentPermissions).toHaveBeenCalledWith({
        document_id: 'doc-2',
      })
    );
    expect(mocks.getDocumentPermissions).not.toHaveBeenCalledWith({
      document_id: 'launcher-placeholder',
    });
  });

  it('keeps direct host grants in the badge while query grants are unknown', () => {
    mocks.inBlock = false;
    render(() => (
      <ShareTrigger
        id="doc-direct"
        blockType="md"
        hasDirectShares
        onClick={vi.fn()}
      />
    ));
    expect(
      screen.getByTitle('Shared with specific people or channels.')
    ).toBeTruthy();
  });

  it('uses supplied grants without fetching and honors an empty grant list', () => {
    mocks.inBlock = false;
    render(() => (
      <ShareTrigger
        id="doc-supplied"
        blockType="md"
        sharePermissions={{
          id: 'doc-supplied',
          owner: ME,
          channelSharePermissions: [],
          linkShare: null,
        }}
        onClick={vi.fn()}
      />
    ));
    expect(screen.getByTitle('Only you can access this item.')).toBeTruthy();
    expect(mocks.getDocumentPermissions).not.toHaveBeenCalled();
  });
});
describe('form share roles', () => {
  it('shares one entity query between a form trigger and its dialog', async () => {
    mocks.inBlock = false;
    render(() => (
      <>
        <ShareTrigger id="form-id" blockType="form" onClick={vi.fn()} />
        <ShareModal
          id="form-id"
          itemType="form"
          blockAlias="form"
          owner={ME}
          name="RSVP"
          userPermissions={Permissions.OWNER}
          open
          onOpenChange={() => {}}
        />
      </>
    ));
    await vi.waitFor(() =>
      expect(mocks.getFormPermissions).toHaveBeenCalledOnce()
    );
    expect(mocks.getFormPermissions).toHaveBeenCalledWith('form-id');
    expect(mocks.getDocumentPermissions).not.toHaveBeenCalled();
    expect(mocks.blockPermissionsRead).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'shows form link sharing in the native link area (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      mocks.getFormPermissions.mockResolvedValue(
        ok({ id: 'form-id', owner: ME, channelSharePermissions: [] })
      );
      render(() => (
        <ShareModal
          id="form-id"
          itemType="form"
          blockAlias="form"
          owner={ME}
          name="RSVP"
          userPermissions={Permissions.OWNER}
          open
          onOpenChange={() => {}}
          linkSharing={() => <div>Form link controls</div>}
        />
      ));
      if (mobile) {
        expect(screen.queryByText('Form link controls')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Link' }));
      }
      expect(await screen.findByText('Form link controls')).toBeTruthy();
    }
  );

  it('shares a form opened outside its host like any entity', async () => {
    mocks.inBlock = false;
    mocks.getFormPermissions.mockResolvedValue(
      ok({ id: 'form-id', owner: ME, channelSharePermissions: [] })
    );
    render(() => (
      <ShareModal
        id="form-id"
        itemType="form"
        blockAlias="form"
        owner={ME}
        name="RSVP"
        userPermissions={Permissions.OWNER}
        open
        onOpenChange={() => {}}
      />
    ));
    expect(await screen.findByText('RSVP')).toBeTruthy();
    expect(screen.queryByText('Loading form sharing…')).toBeNull();
    expect(screen.queryByText('Anyone with the link')).toBeNull();
    await vi.waitFor(() =>
      expect(mocks.getFormPermissions).toHaveBeenCalledWith('form-id')
    );
    expect(mocks.blockPermissionsRead).not.toHaveBeenCalled();
  });

  it('copies a form’s entity link unless its host supplies another', () => {
    mocks.inBlock = false;
    render(() => (
      <ShareTrigger onClick={vi.fn()} id="form-id" blockType="form" />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Share Link' }));
    expect(mocks.copyLink).toHaveBeenCalledWith(
      'https://macro.com/app/form/form-id'
    );
  });

  it('offers View and Edit on a form, which has no comments, and every level elsewhere', () => {
    expect(shareLevelsFor('form')).toEqual(['view', 'edit']);
    expect(shareLevelsFor('document')).toBeUndefined();
    render(() => (
      <ShareOptions
        editPermissionEnabled
        allowedAccessLevels={shareLevelsFor('form')}
        setPermissions={vi.fn()}
      />
    ));
    expect(
      screen.queryByRole('button', { name: 'Set option comment' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Set option edit' })
    ).toBeTruthy();
  });
});
