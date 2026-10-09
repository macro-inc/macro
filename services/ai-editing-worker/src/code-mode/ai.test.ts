import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import codeMode from '../endpoints/code-mode';
import { generationRequestSchema, objectSchema, runGeneration } from './ai';

function provider(text: string) {
  return new MockLanguageModelV3({
    modelId: 'test-model',
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 100, noCache: 70, cacheRead: 20, cacheWrite: 10 },
        outputTokens: { total: 12, text: 12, reasoning: 0 },
      },
      response: { modelId: 'test-model' },
      warnings: [],
    },
  });
}

const schema = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
  additionalProperties: false,
};
const signal = new AbortController().signal;

describe('Vercel generation wrapper', () => {
  it('runs text through the SDK and preserves provider usage evidence', async () => {
    const model = provider('Hello');
    const result = await runGeneration(
      generationRequestSchema.parse({ prompt: 'Greet me' }),
      model,
      signal
    );
    expect(result).toMatchObject({
      text: 'Hello',
      model: 'test-model',
      usage: {
        inputTokens: 100,
        outputTokens: 12,
        cacheReadTokens: 20,
        cacheWriteTokens: 10,
      },
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(1024);
    expect(model.doGenerateCalls[0]?.tools).toBeUndefined();
  });

  it('validates structured output and retains usage when validation fails', async () => {
    const request = generationRequestSchema.parse({ prompt: 'Title', schema });
    expect(
      await runGeneration(request, provider('{"title":"Hi"}'), signal)
    ).toMatchObject({ object: { title: 'Hi' } });
    const invalid = await runGeneration(
      request,
      provider('{"title":17}'),
      signal
    );
    expect(invalid).toMatchObject({
      error: 'AI output did not match the requested schema.',
      usage: { inputTokens: 100, outputTokens: 12 },
    });
    expect(invalid).not.toHaveProperty('object');
  });

  it('rejects arbitrary models, external schemas, expensive schema features and output sizes', () => {
    expect(() =>
      generationRequestSchema.parse({ prompt: 'x', model: 'arbitrary-model' })
    ).toThrow();
    expect(() =>
      generationRequestSchema.parse({ prompt: 'x', maxOutputTokens: 4097 })
    ).toThrow();
    expect(() =>
      generationRequestSchema.parse({ prompt: '😀'.repeat(32_768) })
    ).toThrow();
    expect(() =>
      objectSchema({ type: 'object', $ref: 'https://example.com/schema' })
    ).toThrow();
    expect(() => objectSchema({ type: 'string', pattern: '(a+)+$' })).toThrow();
    let nested: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 9; i++) nested = { type: 'array', items: nested };
    expect(() =>
      objectSchema({ type: 'object', properties: { nested } })
    ).toThrow('complexity');
    expect(() => objectSchema({ type: 'null' })).toThrow('object root');
    for (const invalid of [
      { type: 'object', enum: [null] },
      { type: 'object', properties: { x: { type: 'string', enum: [null] } } },
      {
        type: 'object',
        properties: { x: { type: 'string', enum: ['a'], minLength: 5 } },
      },
    ])
      expect(() => objectSchema(invalid)).toThrow();
    expect(
      objectSchema({
        type: 'object',
        properties: { x: { type: 'string', enum: ['a', 'b'] } },
        required: ['x'],
      }).parse({ x: 'a' })
    ).toEqual({ x: 'a' });
  });

  it('retains usage when a structured reply exhausts its budget without text', async () => {
    const model = new MockLanguageModelV3({
      modelId: 'test-model',
      doGenerate: {
        content: [{ type: 'reasoning', text: 'Thinking' }],
        finishReason: { unified: 'length', raw: 'length' },
        usage: {
          inputTokens: { total: 8, noCache: 8, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 128, text: 0, reasoning: 128 },
        },
        response: { modelId: 'test-model' },
        warnings: [],
      },
    });
    expect(
      await runGeneration(
        generationRequestSchema.parse({
          prompt: 'Title',
          schema,
          maxOutputTokens: 128,
        }),
        model,
        signal
      )
    ).toMatchObject({
      error: expect.any(String),
      finishReason: 'length',
      usage: { inputTokens: 8, outputTokens: 128 },
    });
  });

  it('requires backend authentication before generation', async () => {
    const response = await codeMode.request(
      '/generate',
      { method: 'POST', body: '{}' },
      { INTERNAL_API_KEY: 'test-key' }
    );
    expect(response.status).toBe(401);
    const disabled = await codeMode.request(
      '/generate',
      { method: 'POST', body: '{}' },
      {}
    );
    expect(disabled.status).toBe(503);
  });
});
