import { describe, expect, it } from 'vitest';
import { apiKeyProviderOf } from './agent-api-key';

describe('apiKeyProviderOf', () => {
  it('names the provider whose key can pay for a routed model', () => {
    expect(apiKeyProviderOf('anthropic/claude-sonnet-5-5')?.prefix).toBe(
      'sk-ant-'
    );
    expect(apiKeyProviderOf('openai/gpt-6-astra')?.name).toBe('OpenAI');
    expect(apiKeyProviderOf('google/gemini-3.8-flash')).toBeUndefined();
    expect(apiKeyProviderOf('auto')).toBeUndefined();
  });
});
