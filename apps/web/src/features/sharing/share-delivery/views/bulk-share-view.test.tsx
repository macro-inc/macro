import { registerHotkey } from '@core/hotkey/hotkeys';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { err, ok } from 'neverthrow';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShareDeliveryContext } from '../context/share-delivery-context';
import type { PickedRecipient } from '../core/delivery-plan';
import type {
  ChannelAccessError,
  ShareItem,
  ShareKind,
} from '../core/share-item';
import { createShareForm } from '../primitives/create-share-form';
import { type BulkShareHandle, BulkShareView } from './bulk-share-view';

const mocks = vi.hoisted(() => ({ toastSuccess: vi.fn() }));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.toastSuccess },
}));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareOptions: (props: {
    permissions?: string | null;
    disabled?: boolean;
  }) => (
    <button type="button" aria-label="Permission" disabled={props.disabled}>
      {props.permissions}
    </button>
  ),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
  useHotkeyDOMScope: () => [() => {}, 'bulk-share'],
}));
vi.mock('@ui', () => {
  const Slot = (props: ParentProps) => <div>{props.children}</div>;
  return {
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
    Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props} />
    ),
    Hotkey: () => null,
    ActionDialogShell: Object.assign(Slot, {
      Body: Slot,
      Header: Slot,
      Title: Slot,
      Description: Slot,
      Footer: Slot,
    }),
  };
});

function item(kind: ShareKind, name: string, canGrant = true): ShareItem {
  return {
    kind,
    id: name.toLowerCase(),
    name,
    markdown: false,
    canGrant,
    channelGrants: new Map(),
  };
}

const channel = (id: string): PickedRecipient => ({ kind: 'channel', id });
const person = (id: string): PickedRecipient => ({ kind: 'user', id });
const NAMES: Record<string, string> = {
  general: 'General',
  design: 'Design',
  ann: 'Ann',
  bob: 'Bob',
};

function setup(
  items: readonly ShareItem[],
  recipients: readonly PickedRecipient[]
) {
  const failingChannels = new Set<string>();
  const grantErrors = new Map<string, ChannelAccessError>();
  const opened: string[] = [];
  const context = {
    resolvePeopleChannel: vi.fn<ShareDeliveryContext['resolvePeopleChannel']>(
      async (userIds) => `dm:${userIds.join('+')}`
    ),
    send: vi.fn<ShareDeliveryContext['send']>(async ({ channelId }) => {
      if (failingChannels.has(channelId)) return undefined;
      return { open: () => opened.push(channelId) };
    }),
    changeChannelAccess: vi.fn<ShareDeliveryContext['changeChannelAccess']>(
      async (ref) => {
        const error = grantErrors.get(ref.id);
        return error ? err(error) : ok(undefined);
      }
    ),
    track: vi.fn<ShareDeliveryContext['track']>(),
  } satisfies ShareDeliveryContext;
  const onFinish = vi.fn();
  const onCancel = vi.fn();
  let handle: BulkShareHandle | undefined;
  render(() => {
    let minted = 0;
    const form = createShareForm<PickedRecipient>(
      {
        items: () => items,
        markdownComments: true,
        mintMessageId: () => `m${++minted}`,
      },
      context
    );
    form.setRecipients(recipients);
    return (
      <BulkShareView
        form={form}
        count={items.length}
        selection={null}
        recipientField={null}
        messageField={null}
        recipientName={(recipient) => NAMES[recipient.id] ?? recipient.id}
        onFinish={onFinish}
        onCancel={onCancel}
        ref={(registered) => {
          handle = registered;
        }}
      />
    );
  });
  return {
    context,
    failingChannels,
    grantErrors,
    opened,
    onFinish,
    onCancel,
    dismiss: () => handle?.dismiss(),
  };
}

const button = (name: string) => screen.getByRole('button', { name });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BulkShareView', () => {
  it('names one recipient in the success toast and finishes', async () => {
    const { onFinish, opened } = setup(
      [item('document', 'Spec'), item('chat', 'Notes')],
      [person('ann'), person('bob')]
    );

    fireEvent.click(button('Share'));
    await vi.waitFor(() => expect(onFinish).toHaveBeenCalledOnce());

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Shared with Ann, Bob', {
      actions: [{ label: 'View in channel', onClick: expect.any(Function) }],
    });
    mocks.toastSuccess.mock.calls[0][1].actions[0].onClick();
    expect(opened).toEqual(['dm:ann+bob']);
  });

  it('reports a partial failure, locks the share, and retries only what failed', async () => {
    const { context, failingChannels, onFinish } = setup(
      [item('document', 'Spec'), item('chat', 'Notes')],
      [channel('general'), channel('design')]
    );
    failingChannels.add('design');

    fireEvent.click(button('Share'));
    await screen.findByText('Design did not get Spec and Notes.');
    expect(
      screen.getByText(
        'Not every recipient got every item. Retry repeats only what failed.'
      )
    ).toBeTruthy();
    expect(button('Permission')).toHaveProperty('disabled', true);
    expect(onFinish).not.toHaveBeenCalled();

    failingChannels.delete('design');
    fireEvent.click(button('Retry'));
    expect(screen.getByText('Design did not get Spec and Notes.')).toBeTruthy();
    await vi.waitFor(() => expect(onFinish).toHaveBeenCalledOnce());

    expect(
      context.send.mock.calls.map(([message]) => message.channelId)
    ).toEqual(['general', 'design', 'design']);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'Shared with 2 recipients',
      undefined
    );
  });

  it('offers only Done when what is left is up to the owner', async () => {
    const { grantErrors, onFinish, onCancel } = setup(
      [item('document', 'Spec'), item('chat', 'Notes')],
      [channel('general')]
    );
    grantErrors.set('spec', 'not-allowed');
    grantErrors.set('notes', 'not-allowed');

    fireEvent.click(button('Share'));
    await screen.findByText(
      'General got Spec and Notes, but only the owner can change access.'
    );
    expect(
      screen.getByText(
        'Every recipient got every item, but some access was not updated.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    fireEvent.click(button('Done'));
    expect(onFinish).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels when closed with nothing delivered', async () => {
    const { failingChannels, onFinish, onCancel } = setup(
      [item('document', 'Spec'), item('chat', 'Notes')],
      [channel('general')]
    );
    failingChannels.add('general');

    fireEvent.click(button('Share'));
    await screen.findByText('General did not get Spec and Notes.');
    fireEvent.click(button('Close'));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('finishes when dismissed after someone got a message', async () => {
    const { failingChannels, onFinish, onCancel, dismiss } = setup(
      [item('document', 'Spec'), item('chat', 'Notes')],
      [channel('general'), channel('design')]
    );
    failingChannels.add('design');

    fireEvent.click(button('Share'));
    await screen.findByText('Design did not get Spec and Notes.');
    dismiss();

    expect(onFinish).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('explains rows the sender cannot fully share before sending', () => {
    setup(
      [item('agent_session', 'Run', false), item('document', 'Spec', false)],
      [channel('general')]
    );

    expect(
      screen.getByText(
        'Run will be left out, because only its owner can share it.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "You don't own Spec, so recipients get view access through the message. Only its owner can grant more."
      )
    ).toBeTruthy();
    expect(button('Share')).toHaveProperty('disabled', false);
  });

  it('explains capped access and a split batch before sending', () => {
    const markdown = (name: string): ShareItem => ({
      ...item('document', name),
      markdown: true,
    });
    setup(
      [
        markdown('Spec'),
        item('email', 'Thread'),
        ...Array.from({ length: 9 }, (_, index) =>
          markdown(`Doc ${index + 1}`)
        ),
      ],
      [channel('general')]
    );

    expect(button('Permission').textContent).toBe('edit');
    expect(
      screen.getByText('Thread can be shared with view access at most.')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Each recipient gets 2 messages, because a message holds up to 10 items. Your message goes in the first.'
      )
    ).toBeTruthy();
  });

  it('disables Share when every row is left out', () => {
    setup(
      [
        item('agent_session', 'Run', false),
        item('agent_session', 'Plan', false),
      ],
      [channel('general')]
    );

    expect(
      screen.getByText(
        'Run and Plan will be left out, because only their owners can share them.'
      )
    ).toBeTruthy();
    expect(button('Share')).toHaveProperty('disabled', true);
  });

  it('shares once per press of cmd+enter', async () => {
    const { context, onFinish } = setup(
      [item('document', 'Spec'), item('chat', 'Notes')],
      [channel('general')]
    );
    const [{ keyDownHandler }] = vi.mocked(registerHotkey).mock.calls[0];

    expect(
      keyDownHandler?.(new KeyboardEvent('keydown', { repeat: true }))
    ).toBe(true);
    expect(context.send).not.toHaveBeenCalled();

    keyDownHandler?.(new KeyboardEvent('keydown'));
    await vi.waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
    expect(context.send).toHaveBeenCalledOnce();
  });
});
