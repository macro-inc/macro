/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, Model } from '../constant';
import {
  getChatInputStoredModel,
  getChatInputStoredState,
  storeChatStateImmediate,
} from './storage';

beforeEach(() => {
  localStorage.clear();
});

describe('chat input storage: model defaults', () => {
  it('remembers the last model a user picked for a chat', () => {
    storeChatStateImmediate('chat-a', { model: Model.gpt56, input: 'draft' });

    const restored = getChatInputStoredState('chat-a');
    expect(restored.model).toBe(Model.gpt56);
    expect(restored.input).toBe('draft');
    expect(getChatInputStoredModel('chat-a')).toBe(Model.gpt56);
  });

  it('keeps each chat on its own remembered model', () => {
    storeChatStateImmediate('chat-a', { model: Model.gpt56 });
    storeChatStateImmediate('chat-b', { model: Model.sonnet5 });

    expect(getChatInputStoredState('chat-a').model).toBe(Model.gpt56);
    expect(getChatInputStoredState('chat-b').model).toBe(Model.sonnet5);
  });

  it('returns no stored model for a chat that has never been used', () => {
    expect(getChatInputStoredModel('never-seen')).toBeUndefined();
    expect(getChatInputStoredState('never-seen').model).toBeUndefined();
  });

  it('defaults a draft without a model only when restoring composer state', () => {
    storeChatStateImmediate('input-only', { input: 'draft' });
    expect(getChatInputStoredModel('input-only')).toBeUndefined();
    expect(getChatInputStoredState('input-only').model).toBe(DEFAULT_MODEL);
    expect(getChatInputStoredModel('input-only')).toBeUndefined();
  });

  it('falls back to the default model when the persisted value is stale/unknown', () => {
    // A model id that is no longer valid (e.g. left over from a previous build).
    storeChatStateImmediate('chat-c', {
      model: 'anthropic/claude-opus-4-7' as Model,
    });
    expect(getChatInputStoredModel('chat-c')).toBeUndefined();
    expect(getChatInputStoredState('chat-c').model).toBe(DEFAULT_MODEL);
  });
});
