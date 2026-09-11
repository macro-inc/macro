import { ForwardToChannel } from '@core/component/ForwardToChannel';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSessionShareDialog } from './AgentSessionShare';

const mocks = vi.hoisted(() => ({
  sendToChannel: vi.fn(),
  sendToUsers: vi.fn(),
  mobile: false,
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
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareOptions: () => <span>Access selector</span>,
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
vi.mock('@ui', () => {
  const Container = (props: { children?: JSX.Element }) => props.children;
  return {
    Button: (props: {
      children?: JSX.Element;
      disabled?: boolean;
      onClick?: () => void;
    }) => (
      <button disabled={props.disabled} onClick={props.onClick}>
        {props.children}
      </button>
    ),
    ButtonGroup: Object.assign(Container, { Divider: () => null }),
    Dialog: Object.assign(
      (props: { open: boolean; children?: JSX.Element }) => (
        <Show when={props.open}>{props.children}</Show>
      ),
      {
        Title: Container,
        Description: (props: { children?: JSX.Element }) => (
          <p>{props.children}</p>
        ),
      }
    ),
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Hotkey: () => null,
  };
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mobile = false;
  mocks.sendToChannel.mockResolvedValue({ navigateToChannel: vi.fn() });
});
afterEach(cleanup);
function mountShare(isOwner: boolean) {
  const onOpenChange = vi.fn();
  const onCopyLink = vi.fn();
  render(() => (
    <AgentSessionShareDialog
      sessionId="persisted-session"
      name="Fix the menu"
      isOwner={isOwner}
      open
      onOpenChange={onOpenChange}
      onCopyLink={onCopyLink}
    />
  ));
  return { onOpenChange, onCopyLink };
}
const selectChannel = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Select channel' }));
const share = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));

describe('agent session sharing', () => {
  it('shares the persisted session instead of its enclosing launcher identity', () => {
    const { onOpenChange } = mountShare(true);
    expect(
      screen.getByText('Recipients can view and control this agent session.')
    ).toBeTruthy();
    expect(screen.queryByText('Access selector')).toBeNull();
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
  it('lets participants copy a link without exposing a grant action', () => {
    const { onCopyLink } = mountShare(false);
    expect(screen.queryByRole('button', { name: 'Select channel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(onCopyLink).toHaveBeenCalledOnce();
    expect(mocks.sendToChannel).not.toHaveBeenCalled();
  });
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
    render(() => <ForwardToChannel name="Document" />);
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
      <ForwardToChannel name="Session" blockName="agent" blockId={id()} />
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
