/**
 * @vitest-environment jsdom
 */

import {
  alternateProviderModel,
  MODEL_PROVIDER,
  Model,
  modelsForPlan,
  type TModel,
} from '@core/component/AI/constant';
import type { ChatMessageWithAttachments } from '@core/component/AI/types';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ failure: vi.fn() }));

// Capture toast calls so we can inspect the action buttons the controller wires.
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));

// The controller subscribes to live streams on creation; no streams in tests.
vi.mock('@service-connection/stream', () => ({
  getEntityStreams: () => () => [],
}));

import {
  type ChatControllerOptions,
  createChatController,
} from './createChatController';

type ToastAction = { label: string; onClick: () => void };

function lastToastActions(): ToastAction[] | undefined {
  const call = mocks.failure.mock.calls.at(-1);
  return call?.[1]?.actions as ToastAction[] | undefined;
}

const optimistic: ChatMessageWithAttachments = {
  id: 'm1',
  content: 'hi',
  role: 'user',
  attachments: [],
} as ChatMessageWithAttachments;

/** Create a controller inside a reactive root and drive it into a failure. */
function failWhileSending(options?: ChatControllerOptions) {
  let dispose = () => {};
  createRoot((d) => {
    dispose = d;
    const controller = createChatController('chat-1', [], options);
    controller.dispatch({
      type: 'send_started',
      optimisticMessage: optimistic,
    });
    controller.dispatch({
      type: 'stream_error',
      streamError: 'provider_error',
    });
  });
  return dispose;
}

beforeEach(() => {
  mocks.failure.mockClear();
});

describe('createChatController: provider-failure toast', () => {
  it('shows a failure toast on a provider error', () => {
    const dispose = failWhileSending({ onSwitchModel: () => {} });
    expect(mocks.failure).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('offers a "Switch model" action button when a model switch is wired up', () => {
    const onSwitchModel = vi.fn();
    const dispose = failWhileSending({ onSwitchModel });

    const actions = lastToastActions();
    expect(actions).toBeDefined();
    expect(actions![0].label).toBe('Switch model');

    // Clicking the button invokes the supplied switch handler.
    actions![0].onClick();
    expect(onSwitchModel).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('the switch action swaps the active model to a different provider', () => {
    // Mirror exactly how Chat.tsx wires onSwitchModel: the chat's model signal
    // is the single source of truth, swapped via alternateProviderModel against
    // the user's accessible (paid) models.
    const [model, setModel] = createSignal<TModel>(Model.opus48);
    const onSwitchModel = () => {
      const alt = alternateProviderModel(model(), {
        candidates: [...modelsForPlan(true)],
      });
      if (alt) setModel(alt);
    };

    const dispose = failWhileSending({ onSwitchModel });
    expect(MODEL_PROVIDER[model()]).toBe('anthropic'); // before the swap

    lastToastActions()![0].onClick();

    // After clicking, the active model is from a different provider.
    expect(MODEL_PROVIDER[model()]).not.toBe('anthropic');
    expect(MODEL_PROVIDER[model()]).toBe('openai');
    dispose();
  });

  it('falls back to a plain toast (no action) when no switch handler is wired', () => {
    const dispose = failWhileSending(); // no onSwitchModel
    expect(mocks.failure).toHaveBeenCalledTimes(1);
    expect(lastToastActions()).toBeUndefined();
    dispose();
  });

  it('shows an outage message with no action when no alternate model is available', () => {
    // A switch handler is wired, but there is no accessible model on another
    // provider to switch to (e.g. every other provider already failed this
    // session). Instead of a dead "Switch model" button, the user gets a plain
    // "try again later" outage message.
    const onSwitchModel = vi.fn();
    const dispose = failWhileSending({
      onSwitchModel,
      hasAlternateModel: () => false,
    });

    const [message] = mocks.failure.mock.calls.at(-1)!;
    expect(lastToastActions()).toBeUndefined(); // no dead button
    expect(String(message)).toMatch(/try again later/i);
    dispose();
  });

  it('keeps offering the switch button while an alternate is still available', () => {
    const dispose = failWhileSending({
      onSwitchModel: () => {},
      hasAlternateModel: () => true,
    });
    expect(lastToastActions()?.[0].label).toBe('Switch model');
    dispose();
  });
});
