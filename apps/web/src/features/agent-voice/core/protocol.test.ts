import { describe, expect, it } from 'vitest';
import {
  boundedText,
  parseAgentCancel,
  parseAgentRequest,
  parseWorkerEvent,
  serializeVoicePayload,
} from './protocol';

const requestId = '0195a574-e470-7a43-b74c-d06a7f374836';
describe('voice protocol boundary', () => {
  it('accepts versioned bounded requests with stable UUIDs', () => {
    expect(
      parseAgentRequest(
        JSON.stringify({ version: 1, requestId, prompt: ' Find my draft ' })
      )
    ).toEqual({ version: 1, requestId, prompt: 'Find my draft' });
    expect(() =>
      parseAgentRequest(
        JSON.stringify({ version: 1, requestId: 'untrusted', prompt: 'hello' })
      )
    ).toThrow();
    expect(() =>
      parseAgentRequest(
        JSON.stringify({ version: 2, requestId, prompt: 'hello' })
      )
    ).toThrow();
    expect(() =>
      parseAgentRequest(
        JSON.stringify({ version: 1, requestId, prompt: 'x'.repeat(24_001) })
      )
    ).toThrow();
  });
  it('rejects a targetless cancellation or empty replacement', () => {
    expect(() =>
      parseAgentCancel(JSON.stringify({ version: 1, requestId }))
    ).toThrow();
    expect(() =>
      parseAgentCancel(
        JSON.stringify({
          version: 1,
          requestId,
          taskId: requestId,
          replacementPrompt: ' ',
        })
      )
    ).toThrow();
  });
  it('ignores malformed and future worker packets', () => {
    expect(parseWorkerEvent(new TextEncoder().encode('{'))).toBeUndefined();
    expect(
      parseWorkerEvent(new TextEncoder().encode('{"version":2,"type":"error"}'))
    ).toBeUndefined();
  });
  it('enforces the serialized UTF-8 budget for multilingual requests', () => {
    expect(() =>
      parseAgentRequest(
        JSON.stringify({ version: 1, requestId, prompt: '界'.repeat(6000) })
      )
    ).toThrow('too large');
    const text = boundedText('🗣️界'.repeat(6000), 8000);
    expect(text).not.toContain('�');
    expect(
      new TextEncoder().encode(serializeVoicePayload({ text })).byteLength
    ).toBeLessThan(8100);
  });
  it('budgets JSON escape bytes as well as Unicode text', () => {
    const text = boundedText('\u0000\n"'.repeat(5000), 8000);
    expect(
      new TextEncoder().encode(JSON.stringify(text)).byteLength
    ).toBeLessThanOrEqual(8002);
    expect(() => serializeVoicePayload({ text: '界'.repeat(6000) })).toThrow(
      'too large'
    );
  });
});
