import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoupState } from '../create-soup-state';
import { makeMuteAction } from './make-mute-action';

const mocks = vi.hoisted(() => ({
  muteAsync: vi.fn(async () => {}),
  unmuteAsync: vi.fn(async () => {}),
  mutePending: false,
  unmutePending: false,
  toast: {
    success: vi.fn(),
    failure: vi.fn(),
  },
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: mocks.toast,
}));

vi.mock('@queries/notification/unsubscribes', () => ({
  useMuteItemMutation: () => ({
    get isPending() {
      return mocks.mutePending;
    },
    mutateAsync: mocks.muteAsync,
  }),
  useUnmuteItemMutation: () => ({
    get isPending() {
      return mocks.unmutePending;
    },
    mutateAsync: mocks.unmuteAsync,
  }),
}));

const entity = (type: EntityData['type'], id = 'e1') =>
  ({ type, id, name: 'Thing' }) as EntityData;

const threadEntity = (channelId = 'chan-1') =>
  ({
    type: 'channel_thread',
    id: 'msg-1',
    channelId,
    name: 'Channel thread',
    content: 'ship it',
  }) as EntityData;

const soupState = () => ({}) as SoupState;

function sourceWith(
  muted: Array<{ item_id: string; item_type: string }> = []
): NotificationSource {
  return {
    mutedEntities: () => muted,
  } as NotificationSource;
}

function createAction(source: NotificationSource) {
  return createRoot(() =>
    makeMuteAction({
      notificationSource: () => source,
    })
  );
}

describe('makeMuteAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutePending = false;
    mocks.unmutePending = false;
  });

  it('can run for entity types that produce notifications', () => {
    const { canExecute } = createAction(sourceWith());

    expect(canExecute(entity('document'))).toBe(true);
    expect(canExecute(entity('email'))).toBe(true);
    expect(canExecute(entity('channel'))).toBe(true);
    expect(canExecute(entity('chat'))).toBe(true);
    expect(canExecute(entity('calendar_event'))).toBe(true);
    expect(canExecute(entity('foreign'))).toBe(true);
    expect(canExecute(threadEntity())).toBe(true);
  });

  it('cannot run for entity types that do not produce notifications', () => {
    const { canExecute } = createAction(sourceWith());

    expect(canExecute(entity('automation'))).toBe(false);
    expect(canExecute(entity('crm_company'))).toBe(false);
    expect(canExecute(entity('crm_contact'))).toBe(false);
  });

  it('treats an email as muted when the stored item is email_thread', () => {
    const { isMuted } = createAction(
      sourceWith([{ item_id: 'e1', item_type: 'email_thread' }])
    );

    expect(isMuted(entity('email'))).toBe(true);
    expect(isMuted(entity('email', 'other'))).toBe(false);
  });

  it('treats a channel thread as muted when the parent channel is muted', () => {
    const { isMuted } = createAction(
      sourceWith([{ item_id: 'chan-1', item_type: 'channel' }])
    );

    expect(isMuted(threadEntity('chan-1'))).toBe(true);
    expect(isMuted(threadEntity('chan-2'))).toBe(false);
  });

  it('mutes the canonical notification entity', async () => {
    const action = createAction(sourceWith());

    await action.execute([entity('email')]);

    expect(mocks.muteAsync).toHaveBeenCalledWith({
      item_id: 'e1',
      item_type: 'email_thread',
    });
    expect(mocks.toast.success).toHaveBeenCalledWith('Muted notifications');
  });

  it('mutes a channel thread as its parent channel', async () => {
    const action = createAction(sourceWith());

    await action.execute([threadEntity()]);

    expect(mocks.muteAsync).toHaveBeenCalledWith({
      item_id: 'chan-1',
      item_type: 'channel',
    });
  });

  it('unmutes when every selected entity is already muted', async () => {
    const action = createAction(
      sourceWith([{ item_id: 'e1', item_type: 'email_thread' }])
    );

    await action.execute([entity('email')]);

    expect(mocks.unmuteAsync).toHaveBeenCalledWith({
      item_id: 'e1',
      item_type: 'email_thread',
    });
    expect(mocks.muteAsync).not.toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith('Unmuted notifications');
  });

  it('dedupes threads that share a channel', async () => {
    const action = createAction(sourceWith());

    await action.execute([
      threadEntity('chan-1'),
      {
        ...threadEntity('chan-1'),
        id: 'msg-2',
      } as EntityData,
    ]);

    expect(mocks.muteAsync).toHaveBeenCalledTimes(1);
    expect(mocks.muteAsync).toHaveBeenCalledWith({
      item_id: 'chan-1',
      item_type: 'channel',
    });
    expect(mocks.toast.success).toHaveBeenCalledWith('Muted notifications');
  });

  it('reports a bulk mute when several distinct items succeed', async () => {
    const action = createAction(sourceWith());

    await action.execute([
      entity('document', 'doc-1'),
      entity('chat', 'chat-1'),
    ]);

    expect(mocks.muteAsync).toHaveBeenCalledTimes(2);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      'Muted notifications for 2 items'
    );
  });

  it('does not run while a mute is already in flight', async () => {
    mocks.mutePending = true;
    const action = createAction(sourceWith());

    await action.execute([entity('document')]);

    expect(mocks.muteAsync).not.toHaveBeenCalled();
  });

  it('toasts a failure when every mute rejects', async () => {
    mocks.muteAsync.mockRejectedValueOnce(new Error('nope'));
    const action = createAction(sourceWith());

    await action.execute([entity('document')]);

    expect(mocks.toast.failure).toHaveBeenCalledWith(
      'Failed to mute notifications'
    );
  });

  it('keeps selection when run through soup', async () => {
    const action = createAction(sourceWith());

    await action.executeWithSoup([entity('document')], soupState());

    expect(mocks.muteAsync).toHaveBeenCalledWith({
      item_id: 'e1',
      item_type: 'document',
    });
  });
});
