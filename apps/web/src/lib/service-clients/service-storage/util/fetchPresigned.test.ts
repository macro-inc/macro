import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPresigned } from './fetchPresigned';

const platformFetch = vi.hoisted(() => vi.fn());
vi.mock('@core/util/platformFetch', () => ({ platformFetch }));

const bytes = new Uint8Array([80, 75, 3, 4]);

describe('fetchPresigned', () => {
  beforeEach(() => platformFetch.mockReset());

  it.each([
    ['arrayBuffer', (data: unknown) => new Uint8Array(data as ArrayBuffer)],
    [
      'blob',
      async (data: unknown) =>
        new Uint8Array(await (data as Blob).arrayBuffer()),
    ],
  ] as const)('reads the body as %s', async (responseType, read) => {
    platformFetch.mockResolvedValue(new Response(bytes));
    const result = await fetchPresigned('https://bucket/file', responseType);
    expect(result.isOk()).toBe(true);
    expect(await read(result._unsafeUnwrap())).toEqual(bytes);
  });

  it('reads text and JSON bodies', async () => {
    platformFetch.mockResolvedValueOnce(new Response('hello'));
    expect(
      (await fetchPresigned('https://bucket/file', 'text'))._unsafeUnwrap()
    ).toBe('hello');
    platformFetch.mockResolvedValueOnce(new Response('{"a":1}'));
    expect(
      (await fetchPresigned('https://bucket/file', 'json'))._unsafeUnwrap()
    ).toEqual({ a: 1 });
  });

  it('maps HTTP failures', async () => {
    platformFetch.mockResolvedValue(new Response('', { status: 404 }));
    expect(
      (
        await fetchPresigned('https://bucket/file', 'arrayBuffer')
      )._unsafeUnwrapErr()[0]?.code
    ).toBe('NOT_FOUND');
  });
});
