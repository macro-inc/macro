import { registerHotkey } from '@core/hotkey/hotkeys';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { type ComponentProps, createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForwardToChannel } from './ForwardToChannel';
import { Permissions } from './SharePermissions';

const mocks = vi.hoisted(() => ({
  sendToChannel: vi.fn(),
  sendToUsers: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  shareOptions: vi.fn(),
  uploading: (): boolean => false,
  attachments: [] as {
    entity_type: string;
    entity_id: string;
    width: number;
    height: number;
  }[],
  recipients: [] as { kind: 'channel' | 'user'; id: string }[],
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@core/component/ForwardMessageComposer', () => ({
  createForwardMessageComposer: () => ({
    message: () => ({
      content: '',
      mentions: [],
      attachments: mocks.attachments,
    }),
    isUploading: () => mocks.uploading(),
    clear: vi.fn(),
  }),
  ForwardMessageComposer: () => <textarea aria-label="Optional message" />,
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
  ShareOptions: (props: { allowedAccessLevels?: readonly string[] }) => {
    mocks.shareOptions(props.allowedAccessLevels);
    return null;
  },
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

class RecordedSpan implements Span {
  readonly children: RecordedSpan[] = [];
  readonly attributes: Record<string, unknown> = {};
  readonly errors: unknown[] = [];
  ends = 0;

  constructor(readonly name: string) {}
  span<T>(name: string, operation: (span: Span) => Promise<T>): Promise<T>;
  span(name: string): Span;
  span<T>(
    name: string,
    operation?: (span: Span) => Promise<T>
  ): Span | Promise<T> {
    const child = new RecordedSpan(name);
    this.children.push(child);
    if (!operation) return child;
    return child.run(async () => {
      try {
        return await operation(child);
      } finally {
        child.end();
      }
    });
  }
  run<T>(operation: () => T): T {
    return operation();
  }
  setAttr(name: string, value: unknown) {
    this.attributes[name] = value;
  }
  event() {}
  error(error: unknown) {
    this.errors.push(error);
  }
  traceparent() {
    return undefined;
  }
  injectTraceHeaders() {}
  end() {
    this.ends += 1;
  }
}

let trace: RecordedSpan;

function mountForward(
  setChannelPermissions = vi.fn().mockResolvedValue(true),
  blockName: ComponentProps<typeof ForwardToChannel>['blockName'] = 'agent',
  prepareChannel?: ComponentProps<typeof ForwardToChannel>['prepareChannel']
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
      prepareChannel={prepareChannel}
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
  trace = new RecordedSpan('test');
  vi.spyOn(Telemetry, 'span').mockImplementation(trace.span.bind(trace));
  mocks.uploading = () => false;
  mocks.attachments = [];
  mocks.recipients = [{ kind: 'channel', id: 'channel-1' }];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('forwarding with selected access', () => {
  it('limits the desktop form invitation to responding or editing', () => {
    render(() => (
      <ForwardToChannel
        name="Workshop booking request"
        blockName="form"
        blockId="01a10d51-874a-7b22-9204-41f537bb2572"
        allowedAccessLevels={['view', 'edit']}
        onSubmit={vi.fn()}
        refetch={vi.fn()}
        submitPermissionInfo={{
          userPermissions: Permissions.OWNER,
          setChannelPermissions: vi.fn().mockResolvedValue(true),
        }}
      />
    ));

    expect(mocks.shareOptions).toHaveBeenCalledWith(['view', 'edit']);
  });

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

  it('defaults pdf sharing to comment', async () => {
    mocks.sendToChannel.mockResolvedValue({
      channelId: 'channel-1',
      navigateToChannel: vi.fn(),
    });
    const setChannelPermissions = vi.fn().mockResolvedValue(true);
    const { submit } = mountForward(setChannelPermissions, 'pdf');

    await submit();

    expect(setChannelPermissions).toHaveBeenCalledWith('channel-1', 'comment');
  });

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
      const firstDelivery = trace.children[0].children[0];
      expect(firstDelivery.attributes).toMatchObject({
        'delivery.reused': false,
        'channel.id': 'channel-1',
        'delivery.outcome': 'failure',
      });
      expect(firstDelivery.children.map((span) => span.name)).toEqual([
        'share.send_message',
        'share.update_permissions',
      ]);
      expect(firstDelivery.children[0].errors).toEqual([]);
      expect(firstDelivery.children[1].errors).toEqual([
        'Share permission update failed',
      ]);
      expect(firstDelivery.children.map((span) => span.ends)).toEqual([1, 1]);
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
      const retryDelivery = trace.children[1].children[0];
      expect(retryDelivery.attributes).toMatchObject({
        'delivery.reused': true,
        'delivery.outcome': 'success',
      });
      expect(retryDelivery.children.map((span) => span.name)).toEqual([
        'share.update_permissions',
      ]);
      expect(retryDelivery.children[0].errors).toEqual([]);
      expect(retryDelivery.children[0].ends).toBe(1);
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
    const permissions = trace.children[0].children[0].children[1];
    expect(permissions.errors).toEqual(['Share permission update failed']);
    expect(permissions.ends).toBe(1);
    logError.mockRestore();
  });

  it.each(['empty result', 'rejection'])(
    'records a failed send without granting access for an %s',
    async (failure) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      if (failure === 'empty result')
        mocks.sendToChannel.mockResolvedValue(undefined);
      else mocks.sendToChannel.mockRejectedValue(new Error('Send failed'));
      const { submit, onSubmit, setChannelPermissions } = mountForward();

      await submit();

      expect(setChannelPermissions).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(mocks.failure).toHaveBeenCalledWith('Message failed to send');
      const delivery = trace.children[0].children[0];
      expect(delivery.children.map((span) => span.name)).toEqual([
        'share.send_message',
      ]);
      expect(delivery.children[0].errors).toEqual([
        'Share message send failed',
      ]);
      expect(delivery.children[0].ends).toBe(1);
    }
  );

  it('records a failed permission preparation before sending', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const prepare = vi.fn().mockRejectedValue(new Error('Preparation failed'));
    mocks.sendToChannel.mockImplementation(async ({ beforeSend }) => {
      await beforeSend('channel-1');
      return { channelId: 'channel-1', navigateToChannel: vi.fn() };
    });
    const { submit, onSubmit } = mountForward(undefined, 'agent', prepare);

    await submit();

    expect(onSubmit).not.toHaveBeenCalled();
    const permissions = trace.children[0].children[0].children.find(
      (span) => span.name === 'share.update_permissions'
    );
    expect(permissions?.attributes['channel.id']).toBe('channel-1');
    expect(permissions?.errors).toEqual(['Share permission update failed']);
    expect(permissions?.ends).toBe(1);
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

describe('forwarding image attachments', () => {
  it.each(['channel', 'user'] as const)(
    'includes inline images with the shared entity for a %s',
    async (target) => {
      mocks.recipients = [{ kind: target, id: 'recipient-1' }];
      mocks.attachments = [
        {
          entity_type: 'static/image',
          entity_id: 'image-1',
          width: 20,
          height: 10,
        },
      ];
      const send =
        target === 'channel' ? mocks.sendToChannel : mocks.sendToUsers;
      send.mockResolvedValue({
        channelId: 'channel-1',
        navigateToChannel: vi.fn(),
      });
      const { submit } = mountForward();
      await submit();
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            { entity_type: 'agent_session', entity_id: 'session-1' },
            {
              entity_type: 'static/image',
              entity_id: 'image-1',
              width: 20,
              height: 10,
            },
          ],
        })
      );
    }
  );

  it.each(['button', 'shortcut'] as const)(
    'blocks sharing from the %s until an image upload completes',
    async (path) => {
      const [uploading, setUploading] = createSignal(true);
      mocks.uploading = uploading;
      mocks.sendToChannel.mockResolvedValue({
        channelId: 'channel-1',
        navigateToChannel: vi.fn(),
      });
      const { onSubmit } = mountForward();
      const button = screen.getByRole('button', { name: 'Share' });
      const shortcut = vi
        .mocked(registerHotkey)
        .mock.calls.find(
          ([options]) => options.hotkey === 'cmd+enter'
        )?.[0].keyDownHandler;
      if (!shortcut) throw new Error('Share shortcut was not registered');

      expect(button.hasAttribute('disabled')).toBe(true);
      fireEvent.click(button);
      shortcut(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
      expect(mocks.sendToChannel).not.toHaveBeenCalled();

      mocks.attachments = [
        {
          entity_type: 'static/image',
          entity_id: 'image-1',
          width: 20,
          height: 10,
        },
      ];
      setUploading(false);
      await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
      if (path === 'button') fireEvent.click(button);
      else
        shortcut(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
      expect(mocks.sendToChannel).toHaveBeenCalledOnce();
      expect(mocks.sendToChannel).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            { entity_type: 'agent_session', entity_id: 'session-1' },
            ...mocks.attachments,
          ],
        })
      );
    }
  );
});
