import { describe, expect, test } from 'vitest';
import { intoFrames, MAX_CHUNK_SIZE, Reassembler } from './frames';

describe('intoFrames', () => {
  test('small payload → one final frame', () => {
    const frames = intoFrames(new Uint8Array([1, 2, 3]));
    expect(frames.length).toBe(1);
    expect(frames[0][0]).toBe(1);
    expect(Array.from(frames[0].subarray(1))).toEqual([1, 2, 3]);
  });

  test('exact boundary → one frame', () => {
    const frames = intoFrames(new Uint8Array([1, 2, 3, 4]), 4);
    expect(frames.length).toBe(1);
    expect(frames[0][0]).toBe(1);
  });

  test('multi-frame splits and flags all but last as non-final', () => {
    const payload = new Uint8Array(Array.from({ length: 10 }, (_, i) => i));
    const frames = intoFrames(payload, 4); // 4 + 4 + 2 => 3 frames
    expect(frames.length).toBe(3);
    expect(frames.map((f) => f[0])).toEqual([0, 0, 1]);

    const body = frames.flatMap((f) => Array.from(f.subarray(1)));
    expect(body).toEqual(Array.from(payload));
  });

  test('empty payload → single final empty frame', () => {
    const frames = intoFrames(new Uint8Array([]), 4);
    expect(frames.length).toBe(1);
    expect(Array.from(frames[0])).toEqual([1]);
  });
});

describe('Reassembler', () => {
  test('single final frame returns whole message', () => {
    const out = new Reassembler().push(new Uint8Array([1, 9, 8, 7]));
    expect(out && Array.from(out)).toEqual([9, 8, 7]);
  });

  test('returns null until the final frame', () => {
    const r = new Reassembler();
    expect(r.push(new Uint8Array([0, 1, 2]))).toBeNull();
    expect(r.push(new Uint8Array([0, 3]))).toBeNull();
    const out = r.push(new Uint8Array([1, 4, 5]));
    expect(out && Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  test('round-trips with intoFrames', () => {
    const payload = new Uint8Array(
      Array.from({ length: 1000 }, (_, i) => i % 256)
    );
    const r = new Reassembler();
    let out: Uint8Array | null = null;
    for (const frame of intoFrames(payload, 64)) {
      out = r.push(frame);
    }
    expect(out && Array.from(out)).toEqual(Array.from(payload));
  });
});

test('MAX_CHUNK_SIZE stays under the 1MB durable object limit', () => {
  expect(MAX_CHUNK_SIZE).toBeLessThan(1_000_000);
});
