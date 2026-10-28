// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PartLimits } from '../../../features/slack-import/core/worker-protocol';
import { normalizeMessage, type StoredMessage } from './message-store';
import {
  DEFAULT_PART_LIMITS,
  type NdjsonOutput,
  ndjsonParts,
} from './ndjson-parts';

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
async function* messages(
  count: number,
  text = 'hello'
): AsyncGenerator<StoredMessage> {
  for (let n = 0; n < count; n++) {
    const message = normalizeMessage('C100', { ts: `${n}.0`, text });
    if (message) yield message;
  }
}
async function collect(
  count: number,
  text = 'hello',
  limits: PartLimits = DEFAULT_PART_LIMITS
): Promise<NdjsonOutput[]> {
  const result = [];
  for await (const item of ndjsonParts('C100', messages(count, text), limits))
    result.push(item);
  return result;
}
function parts(
  output: NdjsonOutput[]
): Extract<NdjsonOutput, { type: 'part' }>[] {
  return output.filter((item) => item.type === 'part');
}

describe('bounded NDJSON parts and canonical manifest', () => {
  it('seals zero parts with the Rust empty-manifest vector', async () => {
    expect(await collect(0)).toEqual([
      {
        type: 'seal',
        seal: {
          slackChannelId: 'C100',
          partCount: 0,
          manifestSha256:
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      },
    ]);
  });

  it('caps records at 20,000 and hashes actual LF-terminated bytes', async () => {
    const output = await collect(20_001);
    const result = parts(output);
    expect(result.map((item) => item.descriptor.recordCount)).toEqual([
      20_000, 1,
    ]);
    let manifest = '';
    for (const [index, item] of result.entries()) {
      expect(item.descriptor.sha256).toBe(hash(item.bytes));
      expect(item.descriptor.byteLength).toBe(item.bytes.length);
      expect(item.bytes.at(-1)).toBe(10);
      manifest += `${index}:${item.descriptor.sha256}:${item.bytes.length}:${item.descriptor.recordCount}\n`;
    }
    expect(output.at(-1)).toMatchObject({
      seal: { partCount: 2, manifestSha256: hash(manifest) },
    });
  });

  it('splits at UTF-8 byte boundaries, not character counts, with deterministic repeated output', async () => {
    const text = '界é';
    const bytes =
      normalizeMessage('C100', { ts: '0.0', text })?.byteLength ?? 0;
    const limits = { ...DEFAULT_PART_LIMITS, partBytes: bytes * 2 - 1 };
    const output = await collect(3, text, limits);
    expect(parts(output).map((part) => part.descriptor.recordCount)).toEqual([
      1, 1, 1,
    ]);
    expect(await collect(3, text, limits)).toEqual(output);
    const exact = parts(
      await collect(3, text, { ...limits, partBytes: bytes * 2 })
    );
    expect(exact.map((part) => part.descriptor.recordCount)).toEqual([2, 1]);
    expect(
      exact
        .map((part) =>
          new TextDecoder('utf-8', { fatal: true }).decode(part.bytes)
        )
        .join('')
    ).toContain(text);
  });

  it('enforces the actual default 16 MiB ceiling with multibyte records', async () => {
    const output = await collect(18, '界'.repeat(330_000));
    const result = parts(output);
    expect(result).toHaveLength(2);
    expect(result.every((part) => part.bytes.length <= 16 * 1024 * 1024)).toBe(
      true
    );
    expect(result.map((part) => part.descriptor.recordCount)).toEqual([16, 2]);
  });

  it('enforces per-record bytes including LF and refuses limits above the contract', async () => {
    const size =
      normalizeMessage('C100', { ts: '0.0', text: 'hello' })?.byteLength ?? 0;
    expect(
      parts(
        await collect(1, 'hello', { ...DEFAULT_PART_LIMITS, recordBytes: size })
      )
    ).toHaveLength(1);
    await expect(
      collect(1, 'hello', { ...DEFAULT_PART_LIMITS, recordBytes: size - 1 })
    ).rejects.toMatchObject({ code: 'record_limit' });
    await expect(
      collect(1, 'hello', { ...DEFAULT_PART_LIMITS, partBytes: size - 1 })
    ).rejects.toMatchObject({ code: 'record_limit' });
    await expect(
      collect(1, 'hello', { ...DEFAULT_PART_LIMITS, partRecords: 20_001 })
    ).rejects.toMatchObject({ code: 'invalid_metadata' });
  });

  it('does not prefetch beyond one lookahead record while a part is outstanding', async () => {
    let reads = 0;
    async function* source(): AsyncGenerator<StoredMessage> {
      for await (const message of messages(100)) {
        reads++;
        yield message;
      }
    }
    const abort = new AbortController();
    const iterator = ndjsonParts(
      'C100',
      source(),
      { ...DEFAULT_PART_LIMITS, partRecords: 2 },
      abort.signal
    );
    expect((await iterator.next()).value?.type).toBe('part');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reads).toBe(3);
    abort.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'cancelled' });
    expect(reads).toBe(3);
  });
});
