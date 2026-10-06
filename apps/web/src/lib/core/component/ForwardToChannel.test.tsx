import { toShareItem } from '@app/features/sharing/share-delivery/share-delivery';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { err, ok } from 'neverthrow';
import type { ComponentProps, JSX } from 'solid-js';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';
import { ForwardToChannel } from './ForwardToChannel';

const mocks = vi.hoisted(() => ({
  resolvePeopleChannel: vi.fn(),
  sendToChannel: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  alert: vi.fn(),
  editDocument: vi.fn(),
  updateAgentSessionSharePermissions: vi.fn(),
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
vi.mock('@queries/agent-session/share-permissions', () => ({
  updateAgentSessionSharePermissions: mocks.updateAgentSessionSharePermissions,
}));
vi.mock('@queries/messages/mutations', () => {
  let minted = 0;
  return { newMessageId: () => `message-${++minted}` };
});
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { editDocument: mocks.editDocument },
}));
vi.mock('./Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure, alert: mocks.alert },
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

const replace = (channelId: string, accessLevel: string) => ({
  channelSharePermissions: [{ operation: 'replace', accessLevel, channelId }],
});

const serverError = err([{ code: 'SERVER_ERROR', message: 'Server error' }]);

function silenceErrors() {
  const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
  onTestFinished(() => logError.mockRestore());
  return logError;
}

function mountForward(
  item = toShareItem({
    id: 'session-1',
    kind: 'agent_session',
    name: 'Agent session',
    block: 'agent',
    canGrant: true,
  })
) {
  const onSubmit = vi.fn();
  const refetch = vi.fn();
  let controls:
    | Parameters<NonNullable<ComponentProps<typeof ForwardToChannel>['ref']>>[0]
    | undefined;
  render(() => (
    <ForwardToChannel
      item={item}
      onSubmit={onSubmit}
      refetch={refetch}
      ref={(value) => {
        controls = value;
      }}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Select recipients' }));
  return {
    onSubmit,
    refetch,
    setAccessLevel: (level: 'view' | 'edit') =>
      controls?.setSubmitAccessLevel(level),
    submit: () => controls?.handleSubmit(),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.recipients = [{ kind: 'channel', id: 'channel-1' }];
  mocks.editDocument.mockResolvedValue(ok({}));
  mocks.updateAgentSessionSharePermissions.mockResolvedValue(ok({}));
});
afterEach(cleanup);

describe('forwarding with selected access', () => {
  it.each(['md', 'task', 'snippet', 'skill'] as const)(
    'retains the edit default for %s sharing',
    async (block) => {
      mocks.sendToChannel.mockResolvedValue({
        channelId: 'channel-1',
        navigateToChannel: vi.fn(),
      });
      const { submit } = mountForward(
        toShareItem({
          id: 'doc-1',
          kind: 'document',
          name: 'Document',
          block,
          canGrant: true,
        })
      );

      await submit();

      expect(mocks.editDocument).toHaveBeenCalledWith({
        documentId: 'doc-1',
        sharePermission: replace('channel-1', 'edit'),
      });
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
      const grant = deferred<unknown>();
      mocks.resolvePeopleChannel.mockResolvedValue('channel-1');
      mocks.sendToChannel.mockReturnValue(send.promise);
      mocks.updateAgentSessionSharePermissions.mockReturnValue(grant.promise);
      const { submit, onSubmit } = mountForward();

      const submitted = submit();
      expect(
        target === 'channel' ? mocks.sendToChannel : mocks.resolvePeopleChannel
      ).toHaveBeenCalledOnce();
      await waitFor(() => expect(mocks.sendToChannel).toHaveBeenCalledOnce());
      expect(mocks.updateAgentSessionSharePermissions).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();

      send.resolve({ channelId: 'channel-1', navigateToChannel: vi.fn() });
      await waitFor(() =>
        expect(mocks.updateAgentSessionSharePermissions).toHaveBeenCalledWith(
          'session-1',
          replace('channel-1', 'view')
        )
      );
      expect(onSubmit).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
      // A second shortcut or button press must not duplicate the message while
      // its access update is still pending.
      await submit();
      expect(mocks.sendToChannel).toHaveBeenCalledOnce();

      grant.resolve(ok({}));
      await submitted;
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(mocks.success).toHaveBeenCalledWith(
        'Message sent successfully',
        expect.any(Object)
      );
    }
  );

  it('keeps the dialog open when a permission update reports failure', async () => {
    silenceErrors();
    mocks.sendToChannel.mockResolvedValue({
      channelId: 'channel-1',
      navigateToChannel: vi.fn(),
    });
    mocks.updateAgentSessionSharePermissions.mockResolvedValue(serverError);
    const { submit, onSubmit } = mountForward();

    await submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Failed to change channel access',
      { subtext: 'Please try again' }
    );
  });

  it.each(['channel', 'user', 'group'] as const)(
    'retries a failed grant for a %s without repeating its delivered message',
    async (target) => {
      silenceErrors();
      mocks.recipients =
        target === 'channel'
          ? [{ kind: 'channel', id: 'channel-1' }]
          : target === 'user'
            ? [{ kind: 'user', id: 'user-1' }]
            : [
                { kind: 'user', id: 'user-1' },
                { kind: 'user', id: 'user-2' },
              ];
      mocks.resolvePeopleChannel.mockResolvedValue('channel-1');
      mocks.sendToChannel.mockResolvedValue({
        channelId: 'channel-1',
        navigateToChannel: vi.fn(),
      });
      mocks.updateAgentSessionSharePermissions.mockResolvedValueOnce(
        serverError
      );
      const { submit, onSubmit, setAccessLevel } = mountForward();

      await submit();
      expect(onSubmit).not.toHaveBeenCalled();
      setAccessLevel('edit');
      mocks.recipients = [...mocks.recipients].reverse();
      fireEvent.click(
        screen.getByRole('button', { name: 'Select recipients' })
      );
      await submit();

      expect(mocks.sendToChannel).toHaveBeenCalledOnce();
      expect(mocks.updateAgentSessionSharePermissions.mock.calls).toEqual([
        ['session-1', replace('channel-1', 'view')],
        ['session-1', replace('channel-1', 'view')],
      ]);
      expect(onSubmit).toHaveBeenCalledOnce();
    }
  );

  it('keeps completed recipients while retrying only the failed grant', async () => {
    silenceErrors();
    mocks.recipients = [
      { kind: 'channel', id: 'channel-1' },
      { kind: 'channel', id: 'channel-2' },
    ];
    mocks.sendToChannel.mockImplementation(async ({ channelId }) => ({
      channelId,
      navigateToChannel: vi.fn(),
    }));
    mocks.updateAgentSessionSharePermissions
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(serverError);
    const { submit, onSubmit } = mountForward();

    await submit();
    expect(onSubmit).not.toHaveBeenCalled();
    mocks.recipients = [
      ...mocks.recipients,
      { kind: 'channel', id: 'channel-3' },
    ];
    fireEvent.click(screen.getByRole('button', { name: 'Select recipients' }));
    await submit();

    expect(mocks.sendToChannel).toHaveBeenCalledTimes(2);
    expect(
      mocks.sendToChannel.mock.calls.map(([message]) => message.channelId)
    ).toEqual(['channel-1', 'channel-2']);
    expect(mocks.updateAgentSessionSharePermissions.mock.calls).toEqual([
      ['session-1', replace('channel-1', 'view')],
      ['session-1', replace('channel-2', 'view')],
      ['session-1', replace('channel-2', 'view')],
    ]);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('handles rejected permission updates without closing the dialog', async () => {
    const error = new Error('Permission update failed');
    const logError = silenceErrors();
    mocks.sendToChannel.mockResolvedValue({
      channelId: 'channel-1',
      navigateToChannel: vi.fn(),
    });
    mocks.updateAgentSessionSharePermissions.mockRejectedValue(error);
    const { submit, onSubmit } = mountForward();

    await submit();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Failed to change channel access',
      { subtext: 'Please try again' }
    );
    expect(logError).toHaveBeenCalledWith(
      'Failed to change channel access',
      error
    );
  });

  it('does not grant access or close when the message fails', async () => {
    mocks.sendToChannel.mockResolvedValue(undefined);
    const { submit, onSubmit } = mountForward();

    await submit();

    expect(mocks.updateAgentSessionSharePermissions).not.toHaveBeenCalled();
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
    const { submit, onSubmit } = mountForward();

    const submitted = submit();
    await waitFor(() =>
      expect(mocks.updateAgentSessionSharePermissions).toHaveBeenCalledWith(
        'session-1',
        replace('channel-1', 'view')
      )
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    secondSend.resolve(undefined);
    await submitted;

    expect(mocks.updateAgentSessionSharePermissions).toHaveBeenCalledOnce();
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
    expect(mocks.updateAgentSessionSharePermissions.mock.calls).toEqual([
      ['session-1', replace('channel-1', 'view')],
      ['session-1', replace('channel-2', 'view')],
    ]);
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
