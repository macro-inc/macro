import { ThrownResultError } from '@core/util/result';
import { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import {
  canEditChat,
  loadChatSession,
  usesLocalChatScope,
} from './chat-session';

const fetchAndCacheChat = vi.hoisted(() => vi.fn());
vi.mock('@queries/cognition/chat-data', () => ({ fetchAndCacheChat }));

describe('direct chat session', () => {
  it('uses the cached fetch result and propagates failures to the load gate', async () => {
    const data = { chat: { id: 'chat-1' } };
    fetchAndCacheChat.mockResolvedValueOnce(ok(data));
    await expect(loadChatSession('chat-1')).resolves.toBe(data);
    expect(fetchAndCacheChat).toHaveBeenCalledWith('chat-1');
    const errors = [{ code: 'NOT_FOUND', message: 'Chat not found' }];
    fetchAndCacheChat.mockResolvedValueOnce(err(errors));
    await expect(loadChatSession('chat-1')).rejects.toMatchObject({
      name: 'ThrownResultError',
      errors,
    });
    expect(new ThrownResultError(errors).message).toBe('Chat not found');
  });

  it('keeps edit permissions gated by authentication', () => {
    expect(canEditChat(AccessLevel.owner, true)).toBe(true);
    expect(canEditChat(AccessLevel.view, true)).toBe(false);
    expect(canEditChat(AccessLevel.owner, false)).toBe(false);
  });

  it('attaches local scopes outside a standalone split', () => {
    expect(usesLocalChatScope(true, true)).toBe(true);
    expect(usesLocalChatScope(false, false)).toBe(true);
    expect(usesLocalChatScope(false, true)).toBe(false);
  });
});
