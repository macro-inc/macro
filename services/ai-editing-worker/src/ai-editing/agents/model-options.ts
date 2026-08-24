import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';
import type { ModelMessage } from 'ai';

export const EDIT_PROVIDER_OPTIONS = {
  anthropic: {
    thinking: { type: 'disabled' },
  } satisfies AnthropicProviderOptions,
};

/**
 * The opening user message, marked as a cache breakpoint.
 *
 * Anthropic caches the whole prefix up to and including the breakpoint, so one
 * marker here covers the system prompt, the tool schemas, and the task/document
 * context — everything that is fixed for the agent's whole run. The breakpoint
 * goes on the user message rather than a system message so the SDK's
 * system-in-messages warning doesn't apply.
 *
 * Without it Anthropic caches nothing across steps: a 7-step coder was measured
 * re-billing its ~7.6k-token system prompt every step, 185k input tokens total
 * for one edit on a 2.5k-token document, with `cachedInputTokens` zero from
 * step 2 onward.
 *
 * Providers that don't understand `anthropic.cacheControl` ignore it, so this
 * is safe under the cerebras/openai fallbacks.
 */
export function cachedPrompt(prompt: string): ModelMessage[] {
  return [
    {
      role: 'user',
      // The breakpoint must sit on the content PART. Message-level
      // providerOptions are silently dropped on the way to the provider —
      // verified against the API, which reported cache_creation_input_tokens 0.
      content: [
        {
          type: 'text',
          text: prompt,
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        },
      ],
    },
  ];
}
