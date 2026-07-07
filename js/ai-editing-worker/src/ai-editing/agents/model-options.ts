import type { AnthropicProviderOptions } from '@ai-sdk/anthropic';

export const EDIT_PROVIDER_OPTIONS = {
  anthropic: {
    thinking: { type: 'disabled' },
  } satisfies AnthropicProviderOptions,
};
