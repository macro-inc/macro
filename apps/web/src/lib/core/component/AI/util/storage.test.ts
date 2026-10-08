/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, Model } from '../constant';
import { resolveChatInputModel } from './parse';
import {
  explicitSoupModel,
  getChatInputStoredState,
  getChatStoredModel,
  rememberSoupModelChoice,
  resolveSoupInitialModel,
  storeChatStateImmediate,
  storeSoupInputModel,
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
    expect(getChatStoredModel('chat-a')).toBe(Model.gpt56);
  });

  it('keeps each chat on its own remembered model', () => {
    storeChatStateImmediate('chat-a', { model: Model.gpt56 });
    storeChatStateImmediate('chat-b', { model: Model.sonnet55 });

    expect(getChatInputStoredState('chat-a').model).toBe(Model.gpt56);
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
    expect(resolveChatInputModel(Model.gpt56, restored.model)).toBe(
      Model.gpt56
    );
    expect(resolveChatInputModel(undefined, restored.model)).toBe(
      DEFAULT_MODEL
    );
    expect(getChatStoredModel('input-only')).toBeUndefined();
  });

  it('preserves a historical provider for icons without selecting an unavailable model', () => {
    storeChatStateImmediate('chat-c', {
      model: 'openai/gpt-5.5' as Model,
    });
    const restored = getChatInputStoredState('chat-c');
    expect(restored.model).toBeUndefined();
    expect(getChatStoredModel('chat-c')).toBe('openai/gpt-5.5');
    expect(resolveChatInputModel(Model.gpt56, restored.model)).toBe(
      Model.gpt56
    );
    expect(resolveChatInputModel(undefined, restored.model)).toBe(
      DEFAULT_MODEL
    );
  });

  it('upgrades to Opus unless the soup composer model was actually chosen', () => {
    storeSoupInputModel(Model.sonnet55);
    expect(explicitSoupModel()).toBe(Model.sonnet55);
    expect(resolveSoupInitialModel({ paid: true, sawFreePlan: true })).toBe(
      Model.sonnet55
    );

    storeSoupInputModel(Model.gemini38Flash);
    expect(explicitSoupModel()).toBeUndefined();
    expect(resolveSoupInitialModel({ paid: true, sawFreePlan: true })).toBe(
      Model.opus55
    );
    expect(resolveSoupInitialModel({ paid: false, sawFreePlan: true })).toBe(
      Model.gemini38Flash
    );

    rememberSoupModelChoice(Model.gemini38Flash);
    expect(explicitSoupModel()).toBe(Model.gemini38Flash);
    expect(resolveSoupInitialModel({ paid: true, sawFreePlan: true })).toBe(
      Model.gemini38Flash
    );
  });
});
