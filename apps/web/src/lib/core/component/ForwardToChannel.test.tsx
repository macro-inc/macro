import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { ComponentProps, JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForwardToChannel } from './ForwardToChannel';
import { Permissions } from './SharePermissions';

const mocks = vi.hoisted(() => ({
  sendToChannel: vi.fn(),
  sendToUsers: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  recipients: [] as { kind: 'channel' | 'user'; id: string }[],
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
  useMaybeBlockId: () => 'enclosing-document',
}));
vi.mock('@core/component/CustomScrollbar', () => ({
  CustomScrollbar: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: () => null,
}));
vi.mock('@core/component/RecipientSelector', () => ({
  RecipientSelector: (props: {
    setSelectedOptions: (items: unknown[]) => void;
  }) => (
    <button onClick={() => props.setSelectedOptions(mocks.recipients)}>
      Select recipients
    </button>
  ),
}));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareOptions: () => null,
}));
vi.mock('@core/constant/allBlocks', () => ({
  resolveBlockAlias: (name: string) =>
    ['task', 'snippet', 'skill'].includes(name) ? 'md' : name,
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
  useHotkeyDOMScope: () => [vi.fn(), 'share-scope'],
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/signal/useCombinedRecipient', () => ({
  useCombinedRecipients: () => ({ all: () => [] }),
}));
vi.mock('@core/util/channels', () => ({ useSendMessageToPeople: () => mocks }));
vi.mock('@service-storage/client', () => ({
  blockNameToItemType: () => 'agent_session',
  itemTypeToReferenceEntityType: () => 'agent_session',
}));
vi.mock('./Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure },
}));
vi.mock('./VerticalScrollIndicators', () => ({ ScrollIndicators: () => null }));
vi.mock('@ui', () => ({
  Button: (props: {
    children?: JSX.Element;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  Hotkey: () => null,
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function mountForward(
  setChannelPermissions = vi.fn().mockResolvedValue(true),
  blockName: ComponentProps<typeof ForwardToChannel>['blockName'] = 'agent'
) {
  const onSubmit = vi.fn();
  const refetch = vi.fn();
  let controls:
    | Parameters<NonNullable<ComponentProps<typeof ForwardToChannel>['ref']>>[0]
    | undefined;
  render(() => (
    <ForwardToChannel
      name="Agent session"
      blockName={blockName}
      blockId="session-1"
      onSubmit={onSubmit}
      refetch={refetch}
      ref={(value) => {
        controls = value;
      }}
      submitPermissionInfo={{
        userPermissions: Permissions.OWNER,
        setChannelPermissions,
      }}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Select recipients' }));
  return {
    onSubmit,
    refetch,
    setChannelPermissions,
    setAccessLevel: (level: 'view' | 'edit') =>
      controls?.setSubmitAccessLevel(level),
    submit: () => controls?.handleSubmit(),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.recipients = [{ kind: 'channel', id: 'channel-1' }];
});
afterEach(cleanup);

describe('forwarding with selected access', () => {
  it.each(['md', 'task', 'snippet', 'skill'] as const)(
    'retains the edit default for %s sharing',
    async (blockName) => {
      mocks.sendToChannel.mockResolvedValue({
        channelId: 'channel-1',
        navigateToChannel: vi.fn(),
      });
      const setChannelPermissions = vi.fn().mockResolvedValue(true);
      const { submit } = mountForward(setChannelPermissions, blockName);

      await submit();

      expect(setChannelPermissions).toHaveBeenCalledWith('channel-1', 'edit');
    }
  );

  it.each(['channel', 'user', 'group'] as const)(
    'finishes sending to a %s before applying the selected access level',
    async (target) => {
      mocks.recipients =
        target === 'channel'
          ? [{ kind: 'channel', id: 'channel-1' }]
          : target === 'user'
            ? [{ kind: 'user', id: 'user-1' }]
            : [
                { kind: 'user', id: 'user-1' },
                { kind: 'user', id: 'user-2' },
              ];
      const send = deferred<{
        channelId: string;
        navigateToChannel: () => void;
      }>();
      const grant = deferred<boolean>();
      const sendMessage =
        target === 'channel' ? mocks.sendToChannel : mocks.sendToUsers;
      sendMessage.mockReturnValue(send.promise);
      const setChannelPermissions = vi.fn().mockReturnValue(grant.promise);
      const { submit, onSubmit } = mountForward(setChannelPermissions);

      const submitted = submit();
      expect(sendMessage).toHaveBeenCalledOnce();
      expect(setChannelPermissions).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();

      send.resolve({ channelId: 'channel-1', navigateToChannel: vi.fn() });
      await waitFor(() =>
        expect(setChannelPermissions).toHaveBeenCalledWith('channel-1', 'view')
      );
      expect(onSubmit).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
      // A second shortcut or button press must not duplicate the message while
      // its access update is still pending.
      await submit();
      expect(sendMessage).toHaveBeenCalledOnce();

      grant.resolve(true);
      await submitted;
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(mocks.success).toHaveBeenCalledWith(
        'Message sent successfully',
        expect.any(Object)
      );
    }
  );

  it('keeps the dialog open when a permission update reports failure', async () => {
    mocks.sendToChannel.mockResolvedValue({
      channelId: 'channel-1',
      navigateToChannel: vi.fn(),
    });
    const { submit, onSubmit } = mountForward(vi.fn().mockResolvedValue(false));

    await submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it.each(['channel', 'user', 'group'] as const)(
    'retries a failed grant for a %s without repeating its delivered message',
    async (target) => {
      mocks.recipients =
        target === 'channel'
          ? [{ kind: 'channel', id: 'channel-1' }]
          : target === 'user'
            ? [{ kind: 'user', id: 'user-1' }]
            : [
                { kind: 'user', id: 'user-1' },
                { kind: 'user', id: 'user-2' },
              ];
      const sendMessage =
        target === 'channel' ? mocks.sendToChannel : mocks.sendToUsers;
      sendMessage.mockResolvedValue({
        channelId: 'channel-1',
        navigateToChannel: vi.fn(),
      });
      const grant = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      const { submit, onSubmit, setAccessLevel } = mountForward(grant);

      await submit();
      expect(onSubmit).not.toHaveBeenCalled();
      setAccessLevel('edit');
      // Reordering a group's recipients still addresses the same group.
      mocks.recipients = [...mocks.recipients].reverse();
      fireEvent.click(
        screen.getByRole('button', { name: 'Select recipients' })
      );
      await submit();

      expect(sendMessage).toHaveBeenCalledOnce();
      expect(grant).toHaveBeenNthCalledWith(1, 'channel-1', 'view');
      expect(grant).toHaveBeenNthCalledWith(2, 'channel-1', 'edit');
      expect(onSubmit).toHaveBeenCalledOnce();
    }
  );

  it('keeps completed recipients while retrying only the failed grant', async () => {
    mocks.recipients = [
      { kind: 'channel', id: 'channel-1' },
      { kind: 'channel', id: 'channel-2' },
    ];
    mocks.sendToChannel.mockImplementation(async ({ channelId }) => ({
      channelId,
      navigateToChannel: vi.fn(),
    }));
    const grant = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { submit, onSubmit } = mountForward(grant);

    await submit();
    expect(onSubmit).not.toHaveBeenCalled();
    // A newly added recipient needs delivery; existing recipients do not.
    mocks.recipients = [
      ...mocks.recipients,
      { kind: 'channel', id: 'channel-3' },
    ];
    fireEvent.click(screen.getByRole('button', { name: 'Select recipients' }));
    await submit();

    expect(mocks.sendToChannel).toHaveBeenCalledTimes(3);
    expect(
      mocks.sendToChannel.mock.calls.map(([message]) => message.channelId)
    ).toEqual(['channel-1', 'channel-2', 'channel-3']);
    expect(grant.mock.calls).toEqual([
      ['channel-1', 'view'],
      ['channel-2', 'view'],
      ['channel-2', 'view'],
      ['channel-3', 'view'],
    ]);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('handles rejected permission updates without closing the dialog', async () => {
    const error = new Error('Permission update failed');
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.sendToChannel.mockResolvedValue({
      channelId: 'channel-1',
      navigateToChannel: vi.fn(),
    });
    const { submit, onSubmit } = mountForward(vi.fn().mockRejectedValue(error));

    await submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(mocks.failure).toHaveBeenCalledWith(
      'Failed to set channel permissions'
    );
    expect(logError).toHaveBeenCalledWith(
      'Failed to set channel permissions',
      error
    );
    logError.mockRestore();
  });

  it('does not grant access or close when the message fails', async () => {
    mocks.sendToChannel.mockResolvedValue(undefined);
    const { submit, onSubmit, setChannelPermissions } = mountForward();

    await submit();

    expect(setChannelPermissions).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(mocks.failure).toHaveBeenCalledWith('Message failed to send');
  });

  it('waits for every recipient and reports partial failures', async () => {
    mocks.recipients = [
      { kind: 'channel', id: 'channel-1' },
      { kind: 'channel', id: 'channel-2' },
    ];
    const secondSend = deferred<undefined>();
    mocks.sendToChannel
      .mockResolvedValueOnce({
        channelId: 'channel-1',
        navigateToChannel: vi.fn(),
      })
      .mockReturnValueOnce(secondSend.promise);
    const { submit, onSubmit, setChannelPermissions } = mountForward();

    const submitted = submit();
    await waitFor(() =>
      expect(setChannelPermissions).toHaveBeenCalledWith('channel-1', 'view')
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    secondSend.resolve(undefined);
    await submitted;

    expect(setChannelPermissions).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(mocks.failure).toHaveBeenCalledWith('Some messages failed to send');

    mocks.sendToChannel.mockResolvedValueOnce({
      channelId: 'channel-2',
      navigateToChannel: vi.fn(),
    });
    await submit();

    expect(
      mocks.sendToChannel.mock.calls.map(([message]) => message.channelId)
    ).toEqual(['channel-1', 'channel-2', 'channel-2']);
    expect(setChannelPermissions.mock.calls).toEqual([
      ['channel-1', 'view'],
      ['channel-2', 'view'],
    ]);
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
