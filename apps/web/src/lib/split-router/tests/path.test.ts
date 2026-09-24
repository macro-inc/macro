import { describe, expect, it } from 'vitest';
import { compileRoutePattern } from '../path';

describe('split route path patterns', () => {
  it('matches required and optional parameters', () => {
    const required = compileRoutePattern({ path: 'folder/:folderId' });
    const optional = compileRoutePattern({ path: 'folder/:folderId?' });
    expect([...required.match(['folder', 'one'])]).toEqual([
      { params: { folderId: 'one' }, consumed: 2 },
    ]);
    expect([...optional.match(['folder'])]).toEqual([
      { params: {}, consumed: 1 },
    ]);
    expect(optional.format({})).toEqual(['folder']);
  });

  it('matches and formats a final catch-all parameter', () => {
    const pattern = compileRoutePattern({ path: 'files/*remaining' });
    expect([...pattern.match(['files', 'a', 'b'])]).toEqual([
      { params: { remaining: ['a', 'b'] }, consumed: 3 },
    ]);
    expect([...pattern.match(['files'])]).toEqual([]);
    expect(() => pattern.format({ remaining: [] })).toThrow(
      'Missing split route catch-all parameter "remaining"'
    );
    expect(pattern.format({ remaining: ['a', 'b'] })).toEqual([
      'files',
      'a',
      'b',
    ]);
  });

  it('rejects malformed canonical paths and aliases', () => {
    expect(() => compileRoutePattern({ path: 'folder/:' })).toThrow(
      'Invalid split route parameter'
    );
    expect(() => compileRoutePattern({ path: 'files/*' })).toThrow(
      'Invalid split route catch-all parameter "*"'
    );
    expect(() =>
      compileRoutePattern({ path: 'files/*remaining/edit' })
    ).toThrow('catch-all parameter must be the final segment');
    expect(() =>
      compileRoutePattern({ path: 'folder', aliases: ['folder/~/child'] })
    ).toThrow('Invalid split route path');
  });

  it('matches canonical paths and aliases but formats only canonical segments', () => {
    const pattern = compileRoutePattern({
      path: 'document/:id',
      aliases: ['doc/:id'],
    });
    expect([...pattern.match(['document', 'a/b c'])]).toEqual([
      { params: { id: 'a/b c' }, consumed: 2 },
    ]);
    expect([...pattern.match(['doc', 'a/b c'])]).toEqual([
      { params: { id: 'a/b c' }, consumed: 2 },
    ]);
    // Percent-encoding belongs to the full URL layer, not the pattern.
    expect(pattern.format({ id: 'a/b c' })).toEqual(['document', 'a/b c']);
  });

  it('tries the canonical pattern before aliases in declaration order', () => {
    const pattern = compileRoutePattern({
      path: ':first',
      aliases: [':second', '*rest'],
    });
    expect([...pattern.match(['one'])]).toEqual([
      { params: { first: 'one' }, consumed: 1 },
      { params: { second: 'one' }, consumed: 1 },
      { params: { rest: ['one'] }, consumed: 1 },
    ]);
  });

  it('formats URL-safe primitive parameters', () => {
    const pattern = compileRoutePattern({
      path: 'item/:id/:enabled/:revision',
    });
    expect(pattern.format({ id: 42, enabled: true, revision: 3n })).toEqual([
      'item',
      '42',
      'true',
      '3',
    ]);
  });

  it('requires transformed values to be serialized before formatting', () => {
    const pattern = compileRoutePattern({ path: 'calendar/:day' });
    const day = new Date('2026-01-02T00:00:00.000Z');
    expect(() => pattern.format({ day })).toThrow('requires serializeParams');
    expect(pattern.format({ day: day.toISOString().slice(0, 10) })).toEqual([
      'calendar',
      '2026-01-02',
    ]);
  });
});
