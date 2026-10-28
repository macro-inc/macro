import type { EntityData } from '@entity';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

// The real module reaches the query clients, which open websockets under jsdom.
vi.mock('./make-mark-done-action', () => ({
  canExecuteMarkDoneOnView: () => true,
}));

import {
  emailSenderBucket,
  resolveEntityActionViewContext,
  toSingleEntityActionListState,
} from './entity-action-context';

const channel: EntityData = {
  id: 'channel',
  type: 'channel',
  name: 'Design',
  ownerId: 'owner',
  channelType: 'private',
};

describe('toSingleEntityActionListState', () => {
  it('holds the one entity and has nowhere to move on to', () => {
    createRoot((dispose) => {
      const list = toSingleEntityActionListState(() => channel);

      expect(list.items.count()).toBe(1);
      expect(list.items.at(0)?.original).toBe(channel);
      expect(list.items.get('channel')?.original).toBe(channel);

      list.focus.set('channel');
      expect(list.focus.index()).toBe(0);
      // Nothing to advance to: peeking either way stays on the entity.
      expect(list.navigate.peekOffset(1)?.index).toBe(0);
      expect(list.navigate.peekOffset(-1)?.index).toBe(0);

      dispose();
    });
  });

  it('is empty until the surface resolves its entity', () => {
    createRoot((dispose) => {
      const list = toSingleEntityActionListState(() => undefined);

      expect(list.items.count()).toBe(0);
      expect(list.navigate.peekOffset(1)).toBeUndefined();

      dispose();
    });
  });
});

describe('resolveEntityActionViewContext sender bucket', () => {
  const bucket = (activeListView: string, activeTab: string | undefined) =>
    resolveEntityActionViewContext({ activeListView, activeTab }).senderBucket;

  it('follows the Signal and Noise tabs', () => {
    expect(bucket('mail', 'important')).toBe('signal');
    expect(bucket('home', 'signal')).toBe('signal');
    expect(bucket('home', 'noise')).toBe('noise');
  });

  it('has none for views without those tabs', () => {
    expect(bucket('search', 'all')).toBeUndefined();
    expect(bucket('project-1', undefined)).toBeUndefined();
  });
});

describe('emailSenderBucket', () => {
  const email = (isSignal?: boolean) =>
    ({
      type: 'email',
      id: 't1',
      name: 'Thread',
      ownerId: 'owner',
      isRead: true,
      isDraft: false,
      isImportant: false,
      done: false,
      isSignal,
    }) as EntityData;

  it("reads an email's own Signal or Noise placement", () => {
    expect(emailSenderBucket(email(true))).toBe('signal');
    expect(emailSenderBucket(email(false))).toBe('noise');
  });

  it('is unknown when the server did not say, or for other rows', () => {
    expect(emailSenderBucket(email())).toBeUndefined();
    expect(emailSenderBucket(channel)).toBeUndefined();
  });
});
