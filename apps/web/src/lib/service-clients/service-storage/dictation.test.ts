import { fetchWithToken } from '@core/util/fetchWithToken';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DictationCapacityError, transcribeDictation } from './dictation';

vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: vi.fn() }));
const fetch = vi.mocked(fetchWithToken);

beforeEach(() => {
  fetch.mockReset();
  fetch.mockResolvedValue(ok({ text: 'transcript' }));
});

describe('dictation HTTP adapter', () => {
  it('sends encoded bytes unchanged with cancellation and no transport retries', async () => {
    const audio = new Blob(['encoded'], { type: 'audio/webm' });
    const controller = new AbortController();
    await transcribeDictation(audio, 'en-US', controller.signal);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('/dictation/transcribe?language=en'),
      expect.objectContaining({
        method: 'POST',
        body: audio,
        signal: controller.signal,
        headers: { 'Content-Type': 'audio/webm' },
        retry: { maxTries: 1 },
      })
    );
  });

  it.each([
    [503, '1', 'DICTATION_CAPACITY'],
    [503, null, 'HTTP_ERROR'],
    [503, '-1', 'HTTP_ERROR'],
    [503, 'nonsense', 'HTTP_ERROR'],
    [429, '1', 'DICTATION_RATE_LIMITED'],
    [400, null, 'HTTP_ERROR'],
    [502, '1', 'HTTP_ERROR'],
  ])(
    'classifies status %s / Retry-After %s without retaining response content',
    async (status, retryAfter, code) => {
      await transcribeDictation(new Blob(), 'en', new AbortController().signal);
      const handler = fetch.mock.calls[0][1]?.errorResponseHandler;
      const headers = retryAfter
        ? { 'Retry-After': String(retryAfter) }
        : undefined;
      const error = await handler!(
        new Response('PRIVATE_PROVIDER_CONTENT', {
          status: Number(status),
          headers,
        })
      );
      expect(error?.code).toBe(code);
      expect(error?.message).not.toContain('PRIVATE');
      expect(JSON.stringify(error)).not.toContain('PRIVATE');
      if (code === 'DICTATION_CAPACITY') {
        expect(error).toBeInstanceOf(DictationCapacityError);
        expect((error as DictationCapacityError).retryAfterMs).toBe(1_000);
      }
    }
  );
});
