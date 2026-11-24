/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, Model } from '../constant';
import { resolveChatInputModel } from './parse';
import {
  getChatInputStoredState,
  getChatStoredModel,
  storeChatState,
  storeChatStateImmediate,
} from './storage';

beforeEach(() => {
  localStorage.clear();
});

describe('chat input storage: model defaults', () => {
  it('remembers the last model a user picked for a chat', () => {
    storeChatStateImmediate('chat-a', { model: Model.gpt62Sol, input: 'draft' });

    const restored = getChatInputStoredState('chat-a');
    expect(restored.model).toBe(Model.gpt62Sol);
    expect(restored.input).toBe('draft');
    expect(getChatStoredModel('chat-a')).toBe(Model.gpt62Sol);
  });

  it('keeps each chat on its own remembered model', () => {
    storeChatStateImmediate('chat-a', { model: Model.gpt62Sol });
    storeChatStateImmediate('chat-b', { model: Model.sonnet55 });

    expect(getChatInputStoredState('chat-a').model).toBe(Model.gpt62Sol);
    expect(getChatInputStoredState('chat-b').model).toBe(Model.sonnet55);
  });

  it('returns no stored model for a chat that has never been used', () => {
    expect(getChatStoredModel('never-seen')).toBeUndefined();
    expect(getChatInputStoredState('never-seen').model).toBeUndefined();
  });

  it('lets the server model win when a saved draft has no model', () => {
    storeChatStateImmediate('input-only', { input: 'draft' });
    const restored = getChatInputStoredState('input-only');
    expect(restored.model).toBeUndefined();
    expect(resolveChatInputModel(Model.gpt62Sol, restored.model)).toBe(
      Model.gpt62Sol
    );
    expect(resolveChatInputModel(undefined, restored.model)).toBe(
      DEFAULT_MODEL
    );
    expect(getChatStoredModel('input-only')).toBeUndefined();
  });

  it('drops a pending draft save when the composer is cleared', () => {
    vi.useFakeTimers();
    try {
      storeChatState('chat-a', {
        input: 'sent prompt',
        model: Model.gpt62Sol,
        attachments: [],
      });
      storeChatStateImmediate('chat-a', {
        input: '',
        model: Model.gpt62Sol,
        attachments: [],
      });
      vi.advanceTimersByTime(300);
      expect(getChatInputStoredState('chat-a').input).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves a historical provider for icons without selecting an unavailable model', () => {
    storeChatStateImmediate('chat-c', {
      model: 'openai/gpt-4o' as Model,
    });
    const restored = getChatInputStoredState('chat-c');
    expect(restored.model).toBeUndefined();
    expect(getChatStoredModel('chat-c')).toBe('openai/gpt-4o');
    expect(resolveChatInputModel(Model.gpt62Sol, restored.model)).toBe(
      Model.gpt62Sol
    );
    expect(resolveChatInputModel(undefined, restored.model)).toBe(
      DEFAULT_MODEL
    );
  });

  it('reopens a draft saved on a retired model on its replacement', () => {
    storeChatStateImmediate('chat-d', {
      model: 'openai/gpt-5.6-mini' as Model,
      input: 'draft',
    });
    expect(getChatInputStoredState('chat-d').model).toBe(Model.gpt6Luna);
  });
});
