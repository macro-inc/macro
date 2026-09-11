import { Model } from '@core/component/AI/constant';
import { resolveChatInputModel } from '@core/component/AI/util/parse';
import { storeChatStateImmediate } from '@core/component/AI/util/storage';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatProviderIcon } from './ChatProviderIcon';

vi.hoisted(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: (props: { targetType: string }) => (
    <svg data-entity-type={props.targetType} />
  ),
}));
afterEach(cleanup);

describe('soup chat provider selection', () => {
  it('reacts to soup model updates without a query provider', () => {
    const [model, setModel] = createSignal<string>();
    const { container } = render(() => (
      <ChatProviderIcon id="soup-updates" model={model()} />
    ));
    expect(container.querySelector('[data-entity-type="chat"]')).not.toBeNull();
    setModel(Model.gpt56);
    expect(
      container.querySelector('[data-ai-provider="openai"]')
    ).not.toBeNull();
    setModel(Model.sonnet5);
    expect(
      container.querySelector('[data-ai-provider="anthropic"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-entity-type="chat"]')).toBeNull();
  });

  it('uses a saved selection without a saved soup model', async () => {
    storeChatStateImmediate('draft-only', { model: Model.sonnet5 });
    const { container } = render(() => <ChatProviderIcon id="draft-only" />);
    expect(
      container.querySelector('[data-ai-provider="anthropic"]')
    ).not.toBeNull();
  });

  it.each(['gpt-4o', ''])(
    'matches the composer default for unsupported server model %j',
    async (model) => {
      const { container } = render(() => (
        <ChatProviderIcon id={`unsupported-model-${model}`} model={model} />
      ));
      expect(resolveChatInputModel(model)).toBe(Model.sonnet5);
      await vi.waitFor(() =>
        expect(
          container.querySelector('[data-ai-provider="anthropic"] svg')
        ).not.toBeNull()
      );
    }
  );

  it('keeps supported OpenAI and Anthropic chats distinct', async () => {
    const { container } = render(() => (
      <>
        <ChatProviderIcon id="openai-chat" model={Model.gpt56} />
        <ChatProviderIcon id="anthropic-chat" model={Model.opus5} />
      </>
    ));
    expect(
      Array.from(container.querySelectorAll('[data-ai-provider]'), (el) =>
        el.getAttribute('data-ai-provider')
      )
    ).toEqual(['openai', 'anthropic']);
  });

  it.each([undefined, 'retired-model' as Model])(
    'uses the soup model when a draft has no valid model (%s)',
    async (model) => {
      const id = `draft-with-${model}`;
      storeChatStateImmediate(id, { input: 'draft', model });
      const { container } = render(() => (
        <ChatProviderIcon id={id} model={Model.gpt56} />
      ));
      await vi.waitFor(() =>
        expect(
          container.querySelector('[data-ai-provider="openai"]')
        ).not.toBeNull()
      );
    }
  );

  it('reacts to per-chat selections without changing another row', () => {
    const { container } = render(() => (
      <>
        <ChatProviderIcon id="selected-chat" model={Model.gpt56} />
        <ChatProviderIcon id="other-chat" model={Model.gpt56} />
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

  it.each([undefined, null])(
    'shows the standard chat icon when the model is %s',
    async (model) => {
      const { container } = render(() => (
        <ChatProviderIcon id="unloaded-chat" model={model} />
      ));
      expect(container.querySelector('[data-ai-provider]')).toBeNull();
      expect(
        container.querySelector('[data-entity-type="chat"]')
      ).not.toBeNull();
    }
  );
});
