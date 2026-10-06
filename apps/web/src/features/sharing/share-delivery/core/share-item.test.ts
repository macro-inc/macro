import { describe, expect, it } from 'vitest';
import {
  levelChoice,
  owedGrant,
  parseChannelAccessLevel,
  type ShareItem,
  shareAccess,
} from './share-item';

const item = (overrides: Partial<ShareItem> = {}): ShareItem => ({
  kind: 'document',
  id: 'doc-1',
  name: 'Doc',
  markdown: false,
  canGrant: true,
  channelGrants: new Map(),
  ...overrides,
});

const commentsOn = { markdownComments: true };

describe('shareAccess', () => {
  it.each(['agent_session', 'initiative'] as const)(
    'leaves out a %s the sender does not own',
    (kind) => {
      expect(shareAccess(item({ kind, canGrant: false }))).toEqual({
        t: 'cannot-send',
      });
    }
  );

  it('gives view through the message when the sender cannot grant', () => {
    expect(shareAccess(item({ canGrant: false }))).toEqual({
      t: 'view-via-message',
    });
    expect(shareAccess(item({ kind: 'call' }))).toEqual({
      t: 'view-via-message',
    });
  });

  it('sets a level on an owned document after its message', () => {
    expect(shareAccess(item())).toEqual({
      t: 'set-level',
      when: 'after-send',
      maxLevel: 'edit',
    });
  });
});

describe('owedGrant', () => {
  it('grants native projects before the message and the rest after', () => {
    expect(owedGrant(item({ kind: 'initiative' }), 'edit')).toEqual({
      when: 'before-send',
      level: 'edit',
    });
    expect(owedGrant(item(), 'comment')).toEqual({
      when: 'after-send',
      level: 'comment',
    });
  });

  it('caps email at view', () => {
    expect(owedGrant(item({ kind: 'email' }), 'edit')).toEqual({
      when: 'after-send',
      level: 'view',
    });
  });

  it('owes nothing for items the sender cannot grant', () => {
    expect(owedGrant(item({ canGrant: false }), 'edit')).toBeUndefined();
    expect(owedGrant(item({ canGrant: true }), 'edit')).toEqual({
      when: 'after-send',
      level: 'edit',
    });
  });
});

describe('levelChoice', () => {
  it('offers no control when nothing can be granted above view', () => {
    expect(levelChoice([item({ kind: 'email' })], commentsOn)).toBeUndefined();
    expect(
      levelChoice([item({ canGrant: false })], commentsOn)
    ).toBeUndefined();
    expect(levelChoice([item({ kind: 'call' })], commentsOn)).toBeUndefined();
    expect(levelChoice([item()], commentsOn)).toEqual({
      options: ['view', 'comment', 'edit'],
      initial: 'view',
    });
  });

  it('defaults markdown to edit, as the single dialog does', () => {
    expect(levelChoice([item({ markdown: true })], commentsOn)).toEqual({
      options: ['view', 'comment', 'edit'],
      initial: 'edit',
    });
  });

  it('defaults a mixed batch to the lowest item default', () => {
    const choice = levelChoice(
      [item({ markdown: true }), item({ kind: 'chat', id: 'chat-1' })],
      commentsOn
    );
    expect(choice?.initial).toBe('view');
  });

  it('does not let email pull a markdown batch down to view', () => {
    const choice = levelChoice(
      [item({ markdown: true }), item({ kind: 'email', id: 'thread-1' })],
      commentsOn
    );
    expect(choice?.initial).toBe('edit');
  });

  it('seeds from the sole channel when every item already has that level there', () => {
    const grants = new Map([['channel-1', 'comment' as const]]);
    const prefill = { prefillChannelId: 'channel-1', markdownComments: true };
    expect(
      levelChoice([item({ markdown: true, channelGrants: grants })], prefill)
        ?.initial
    ).toBe('comment');
    expect(
      levelChoice(
        [
          item({ markdown: true, channelGrants: grants }),
          item({ id: 'doc-2' }),
        ],
        prefill
      )?.initial
    ).toBe('view');
  });

  it('offers comment on markdown only while markdown comments are on', () => {
    expect(
      levelChoice([item({ markdown: true })], { markdownComments: false })
    ).toEqual({ options: ['view', 'edit'], initial: 'edit' });
    expect(levelChoice([item()], { markdownComments: false })?.options).toEqual(
      ['view', 'comment', 'edit']
    );
  });

  it('ignores a seeded comment level the control does not offer', () => {
    const grants = new Map([['channel-1', 'comment' as const]]);
    expect(
      levelChoice([item({ markdown: true, channelGrants: grants })], {
        prefillChannelId: 'channel-1',
        markdownComments: false,
      })
    ).toEqual({ options: ['view', 'edit'], initial: 'edit' });
  });
});

describe('parseChannelAccessLevel', () => {
  it('rejects owner, which channels cannot hold', () => {
    expect(parseChannelAccessLevel('owner')).toBeUndefined();
    expect(parseChannelAccessLevel('edit')).toBe('edit');
  });
});
