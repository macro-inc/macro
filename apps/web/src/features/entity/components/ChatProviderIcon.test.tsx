import { Model } from '@core/component/AI/constant';
import { resolveChatInputModel } from '@core/component/AI/util/parse';
import { storeChatStateImmediate } from '@core/component/AI/util/storage';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatProviderIcon } from './ChatProviderIcon';

const chats = vi.hoisted(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  return new Map<string, { model?: string | null }>();
});
vi.mock('@queries/cognition/chat-data', () => ({
  useChatDataQuery: (id: () => string) => ({
    get isSuccess() {
      return chats.has(id());
    },
    get data() {
      return chats.get(id());
    },
  }),
}));
afterEach(() => {
  cleanup();
  chats.clear();
});

describe('soup chat provider selection', () => {
  it('matches the composer default for retired server models', () => {
    chats.set('retired-model', { model: 'gpt-4o' });
    const { container } = render(() => <ChatProviderIcon id="retired-model" />);
    expect(resolveChatInputModel('gpt-4o')).toBe(Model.sonnet5);
    expect(
      container.querySelector('[data-ai-provider="anthropic"] svg')
    ).not.toBeNull();
  });

  it('keeps supported OpenAI and Anthropic chats distinct', () => {
    chats.set('openai-chat', { model: Model.gpt56 });
    chats.set('anthropic-chat', { model: Model.opus5 });
    const { container } = render(() => (
      <>
        <ChatProviderIcon id="openai-chat" />
        <ChatProviderIcon id="anthropic-chat" />
      </>
    ));
    expect(
      Array.from(container.querySelectorAll('[data-ai-provider]'), (el) =>
        el.getAttribute('data-ai-provider')
      )
    ).toEqual(['openai', 'anthropic']);
  });

  it('reacts to per-chat selections without changing another row', () => {
    chats.set('selected-chat', { model: Model.gpt56 });
    chats.set('other-chat', { model: Model.gpt56 });
    const { container } = render(() => (
      <>
        <ChatProviderIcon id="selected-chat" />
        <ChatProviderIcon id="other-chat" />
      </>
    ));
    storeChatStateImmediate('selected-chat', { model: Model.sonnet5 });
    expect(resolveChatInputModel(Model.gpt56, Model.sonnet5)).toBe(
      Model.sonnet5
    );
    expect(
      Array.from(container.querySelectorAll('[data-ai-provider]'), (el) =>
        el.getAttribute('data-ai-provider')
      )
    ).toEqual(['anthropic', 'openai']);
    storeChatStateImmediate('selected-chat', { model: Model.gpt56 });
    expect(
      container.querySelector('[data-ai-provider="anthropic"]')
    ).toBeNull();
  });

  it('does not guess a provider for an unloaded chat', () => {
    const { container } = render(() => <ChatProviderIcon id="unloaded-chat" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
