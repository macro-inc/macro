/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, Model } from '../constant';
import { getChatInputStoredState, storeChatStateImmediate } from './storage';

beforeEach(() => {
  localStorage.clear();
});

describe('chat input storage: model defaults', () => {
  it('remembers the last model a user picked for a chat', () => {
    storeChatStateImmediate('chat-a', { model: Model.gpt55, input: 'draft' });

    const restored = getChatInputStoredState('chat-a');
    expect(restored.model).toBe(Model.gpt55);
    expect(restored.input).toBe('draft');
  });

  it('keeps each chat on its own remembered model', () => {
    storeChatStateImmediate('chat-a', { model: Model.gpt55 });
    storeChatStateImmediate('chat-b', { model: Model.sonnet46 });

    expect(getChatInputStoredState('chat-a').model).toBe(Model.gpt55);
    expect(getChatInputStoredState('chat-b').model).toBe(Model.sonnet46);
  });

  it('returns no stored model for a chat that has never been used', () => {
    expect(getChatInputStoredState('never-seen').model).toBeUndefined();
  });

  it('falls back to the default model when the persisted value is stale/unknown', () => {
    // A model id that is no longer valid (e.g. left over from a previous build).
    storeChatStateImmediate('chat-c', {
      model: 'anthropic/claude-opus-4-7' as Model,
    });
    expect(getChatInputStoredState('chat-c').model).toBe(DEFAULT_MODEL);
  });
});
