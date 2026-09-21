import { createSearchParamsCodec } from '@app/lib/split-router/search-params-codec';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRIVE_SEARCH_PARAMS,
  deserializeDriveSearchParams,
  driveSearchParamsOptions,
  serializeDriveSearchParams,
} from './drive-search-params';

describe('Drive search params', () => {
  it('uses arrays for scalars and facets and omits default state', () => {
    const state = {
      scope: 'all' as const,
      sort: 'created_at' as const,
      facets: { status: ['todo', 'done', 'todo'], project: ['one'] },
    };
    expect(serializeDriveSearchParams(state)).toEqual({
      scope: ['all'],
      sort: ['created_at'],
      status: ['done', 'todo'],
      project: ['one'],
    });
    expect(
      serializeDriveSearchParams(DEFAULT_DRIVE_SEARCH_PARAMS)
    ).toBeUndefined();
    const codec = createSearchParamsCodec(driveSearchParamsOptions);
    expect(codec.parse(serializeDriveSearchParams(state))).toEqual({
      value: {
        ...state,
        facets: { status: ['done', 'todo'], project: ['one'] },
      },
      valid: true,
    });
  });

  it('uses last scalar values and preserves legacy facet compatibility', () => {
    const codec = createSearchParamsCodec(driveSearchParamsOptions);
    const parsed = codec.parse({
      scope: ['attachments', 'all'],
      sort: ['updated_at', 'viewed_at'],
      facets: [JSON.stringify({ status: ['old'], project: ['two', 'one'] })],
      status: ['new', 'new'],
    });
    expect(parsed).toEqual({
      value: {
        scope: 'all',
        sort: 'viewed_at',
        facets: { project: ['one', 'two'], status: ['new'] },
      },
      valid: true,
    });
    expect(codec.serialize(parsed.value)).toEqual({
      scope: ['all'],
      sort: ['viewed_at'],
      project: ['one', 'two'],
      status: ['new'],
    });
  });

  it('ignores reserved or unsafe facet names without colliding with scalar fields', () => {
    expect(
      serializeDriveSearchParams({
        ...DEFAULT_DRIVE_SEARCH_PARAMS,
        facets: {
          scope: ['all'],
          sort: ['created_at'],
          facets: ['legacy'],
          'bad.name': ['bad'],
          constructor: ['bad'],
          status: ['todo'],
        },
      })
    ).toEqual({ status: ['todo'] });
  });

  it('keeps empty, malformed, and repeated legacy values compatible', () => {
    expect(deserializeDriveSearchParams({ facets: ['bad-json'] })).toEqual({
      facets: {},
    });
    expect(
      deserializeDriveSearchParams({
        facets: ['bad-json', JSON.stringify({ status: ['todo'] })],
      })
    ).toEqual({ facets: { status: ['todo'] } });
    expect(deserializeDriveSearchParams({ status: [] })).toEqual({
      facets: {},
    });
    const codec = createSearchParamsCodec(driveSearchParamsOptions);
    expect(codec.parse({ sort: ['invalid'] })).toEqual({
      value: DEFAULT_DRIVE_SEARCH_PARAMS,
      valid: false,
    });
  });
});
