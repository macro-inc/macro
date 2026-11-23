import { APICallError, generateText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import {
  accountUnavailable,
  reportingAccountFailures,
} from './provider-account';

describe('accountUnavailable', () => {
  it('reads a Fireworks suspension as suspended', () => {
    expect(
      accountUnavailable(
        412,
        '{"error":{"object":"error","type":"invalid_request_error","message":"Account acct-example1 is suspended, possibly due to reaching the monthly spending limit or failure to pay past invoices."}}'
      )
    ).toBe('suspended');
  });

  it('reads an Anthropic low credit balance as out of credit', () => {
    expect(
      accountUnavailable(
        400,
        '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'
      )
    ).toBe('out_of_credit');
  });

  it('reads an OpenAI insufficient quota as out of credit', () => {
    expect(
      accountUnavailable(
        429,
        '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}}'
      )
    ).toBe('out_of_credit');
  });

  it('reads a Cerebras payment required as out of credit', () => {
    expect(accountUnavailable(402, '{"message":"Payment required"}')).toBe(
      'out_of_credit'
    );
  });

  it('leaves a Gemini per-minute quota alone', () => {
    expect(
      accountUnavailable(
        429,
        '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_paid_tier_input_token_count, limit: 4000000","status":"RESOURCE_EXHAUSTED"}}'
      )
    ).toBeUndefined();
  });

  it('leaves an unrelated failed precondition alone', () => {
    expect(
      accountUnavailable(
        412,
        '{"error":{"message":"Precondition Failed: the If-Match header does not match"}}'
      )
    ).toBeUndefined();
  });

  it('leaves a server error alone', () => {
    expect(
      accountUnavailable(500, 'upstream account is suspended')
    ).toBeUndefined();
  });
});

describe('reportingAccountFailures', () => {
  it('rethrows the provider error so a fallback chain still advances', async () => {
    const suspended = new APICallError({
      message: 'Precondition Failed',
      url: 'https://api.fireworks.ai/inference/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 412,
      responseBody:
        '{"error":{"message":"Account acct-example1 is suspended, possibly due to reaching the monthly spending limit or failure to pay past invoices."}}',
      isRetryable: false,
    });
    const model = reportingAccountFailures(
      'fireworks',
      new MockLanguageModelV3({
        doGenerate: async () => {
          throw suspended;
        },
      })
    );

    await expect(
      generateText({ model, prompt: 'hello', maxRetries: 0 })
    ).rejects.toBe(suspended);
  });
});
