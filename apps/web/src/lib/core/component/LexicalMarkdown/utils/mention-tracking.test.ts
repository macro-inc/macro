import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/block', () => ({
  NonDocumentBlockTypes: [
    'call',
    'calendar',
    'chat',
    'channel',
    'project',
    'email',
    'contact',
    'company',
    'automation',
    'pr',
    'agent',
  ],
}));

import { canTrackMentionFromBlock } from './mention-tracking';

describe('canTrackMentionFromBlock', () => {
  it('tracks mentions created from documents', () => {
    expect(canTrackMentionFromBlock('md')).toBe(true);
  });

  it('does not track mentions from agent sessions', () => {
    expect(canTrackMentionFromBlock('agent')).toBe(false);
  });

  it('does not track mentions from chats or channels', () => {
    expect(canTrackMentionFromBlock('chat')).toBe(false);
    expect(canTrackMentionFromBlock('channel')).toBe(false);
  });

  it('does not track when the source block is unknown', () => {
    expect(canTrackMentionFromBlock(undefined)).toBe(false);
  });
});
