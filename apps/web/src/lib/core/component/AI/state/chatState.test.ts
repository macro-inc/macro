import type { ChatMessageWithAttachments } from '@core/component/AI/types';
import { describe, expect, it } from 'vitest';
import { type ChatPhase, type SideEffect, transition } from './chatState';

const streaming: ChatPhase = { type: 'streaming' };
const sending: ChatPhase = { type: 'sending', optimisticMessageId: 'm1' };

const userMessage: ChatMessageWithAttachments = {
  id: 'm1',
  content: 'hi',
  role: 'user',
  attachments: [],
} as ChatMessageWithAttachments;

/** The single toast effect produced by a transition, or undefined. */
function toastOf(effects: SideEffect[]) {
  return effects.find((e) => e.type === 'toast') as
    | Extract<SideEffect, { type: 'toast' }>
    | undefined;
}

describe('transition: provider failure surfaces a toast', () => {
  it('a provider_error while streaming returns to idle and emits a switch-model toast', () => {
    const result = transition(streaming, {
      type: 'stream_error',
      streamError: 'provider_error',
    });

    expect(result.phase).toEqual({ type: 'idle' });
    const toast = toastOf(result.effects);
    expect(toast).toBeDefined();
    // The message points the user at switching models...
    expect(toast!.message).toMatch(/provider/i);
    // ...and flags that a "Switch model" action should be offered.
    expect(toast!.offerModelSwitch).toBe(true);
  });

  it('also surfaces the switch-model toast from the sending phase', () => {
    const result = transition(sending, {
      type: 'stream_error',
      streamError: 'provider_error',
    });
    expect(result.phase).toEqual({ type: 'idle' });
    expect(toastOf(result.effects)?.offerModelSwitch).toBe(true);
  });

  it('a context-overflow error toasts without offering a model switch', () => {
    const toast = toastOf(
      transition(streaming, {
        type: 'stream_error',
        streamError: 'model_context_overflow',
      }).effects
    );
    expect(toast).toBeDefined();
    expect(toast!.offerModelSwitch).toBeFalsy();
    expect(toast!.message).toMatch(/context/i);
  });

  it('an unknown stream error toasts a generic message without a switch', () => {
    const toast = toastOf(
      transition(streaming, {
        type: 'stream_error',
        streamError: 'something_unexpected',
      }).effects
    );
    expect(toast).toBeDefined();
    expect(toast!.offerModelSwitch).toBeFalsy();
  });
});

describe('transition: paywall on payment failure', () => {
  it('a send_failed with paymentError opens the paywall', () => {
    const result = transition(sending, {
      type: 'send_failed',
      paymentError: true,
    });
    expect(result.phase).toEqual({ type: 'idle' });
    expect(result.effects).toContainEqual({ type: 'show_paywall' });
  });

  it('a plain send_failure does not open the paywall', () => {
    const result = transition(sending, { type: 'send_failed' });
    expect(result.effects).toHaveLength(0);
  });
});

describe('transition: sanity of the happy path used by the failure tests', () => {
  it('send_started moves idle -> sending and queues the optimistic message', () => {
    const result = transition(
      { type: 'idle' },
      { type: 'send_started', optimisticMessage: userMessage }
    );
    expect(result.phase).toEqual({
      type: 'sending',
      optimisticMessageId: 'm1',
    });
  });
});

// Note: `transition` stays availability-agnostic by design — it always sets
// `offerModelSwitch: true` for a provider_error. Whether that becomes a "Switch
// model" button or a plain "try again later" outage message depends on whether
// an accessible alternate model exists, which only the controller knows. That
// branching is covered in createChatController.test.tsx.
