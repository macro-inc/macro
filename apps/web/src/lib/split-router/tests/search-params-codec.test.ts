import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createSearchParamsCodec } from '../search-params-codec';

const defaults = { sort: 'name', page: 1, enabled: true, tags: ['default'] };
const schema = z.object({
  sort: z.enum(['name', 'recent']),
  page: z.number().int().positive(),
  enabled: z.boolean(),
  tags: z.array(z.string()),
});

// No Solid owner or router is needed to exercise conversion and validation.
describe('search params codec', () => {
  it('uses the last scalar value while preserving repeated array values', () => {
    const codec = createSearchParamsCodec({ schema, defaults });
    const parsed = codec.parse({
      sort: ['name', 'recent'],
      page: ['2', '3'],
      enabled: ['true', 'false'],
      tags: ['b', 'a', 'b'],
    });
    expect(parsed).toEqual({
      value: { sort: 'recent', page: 3, enabled: false, tags: ['b', 'a', 'b'] },
      valid: true,
    });
    expect(codec.serialize(parsed.value)).toEqual({
      sort: ['recent'],
      page: ['3'],
      enabled: ['false'],
      tags: ['b', 'a', 'b'],
    });
  });

  it('omits defaults and preserves the explicit empty-array marker', () => {
    const codec = createSearchParamsCodec({ schema, defaults });
    expect(codec.parse(undefined)).toEqual({ value: defaults, valid: true });
    expect(codec.serialize(defaults)).toBeUndefined();
    const empty = { ...defaults, tags: [] };
    expect(codec.serialize(empty)).toEqual({ tags: [''] });
    expect(codec.parse({ tags: [''] })).toEqual({ value: empty, valid: true });
    expect(codec.parse({ tags: [] })).toEqual({ value: defaults, valid: true });
  });

  it('falls back on invalid inbound state and rejects invalid write candidates', () => {
    const codec = createSearchParamsCodec({ schema, defaults });
    expect(codec.parse({ page: ['not-a-number'] })).toEqual({
      value: defaults,
      valid: false,
    });
    expect(codec.validate({ ...defaults, page: -1 }).success).toBe(false);
    expect(codec.validate({ ...defaults, page: 2 })).toEqual({
      success: true,
      data: { ...defaults, page: 2 },
    });
    expect(codec.parse({ unknown: ['ignored'] })).toEqual({
      value: defaults,
      valid: true,
    });
  });

  it('passes the same array-valued representation to custom codecs', () => {
    const codec = createSearchParamsCodec({
      schema: z.object({ tags: z.array(z.string()) }),
      defaults: { tags: [] as string[] },
      deserialize: (params) => ({ tags: params.labels ?? [] }),
      serialize: (value) => ({ labels: value.tags }),
    });
    const parsed = codec.parse({ labels: ['one', 'two', 'one'] });
    expect(parsed).toEqual({
      value: { tags: ['one', 'two', 'one'] },
      valid: true,
    });
    const serialized = codec.serialize(parsed.value);
    expect(serialized).toEqual({ labels: ['one', 'two', 'one'] });
    expect(serialized?.labels).not.toBe(parsed.value.tags);
    expect(codec.serialize({ tags: [] })).toBeUndefined();
  });

  it('falls back if a custom deserializer throws', () => {
    const codec = createSearchParamsCodec({
      schema,
      defaults,
      deserialize: () => {
        throw new Error('bad URL');
      },
      serialize: () => undefined,
    });
    expect(codec.parse({ page: ['broken'] })).toEqual({
      value: defaults,
      valid: false,
    });
  });

  it('accepts Standard Schema implementations without a safeParse method', () => {
    const codec = createSearchParamsCodec({
      defaults: { value: 'default' },
      schema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (value) => ({ value: value as { value: string } }),
        },
      },
    });
    expect(codec.parse({ value: ['one', 'two'] })).toEqual({
      value: { value: 'two' },
      valid: true,
    });
  });

  it('rejects invalid defaults and asynchronous schemas at creation', () => {
    expect(() =>
      createSearchParamsCodec({ schema, defaults: { ...defaults, page: -1 } })
    ).toThrow('Invalid defaults for search params');
    expect(() =>
      createSearchParamsCodec({
        schema: schema.transform(async (value) => value),
        defaults,
      })
    ).toThrow('must be synchronous');
  });
});
