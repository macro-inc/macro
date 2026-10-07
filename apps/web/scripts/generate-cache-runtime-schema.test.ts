import { describe, expect, it } from 'vitest';
import { generateCacheRuntimeSchema } from './generate-cache-runtime-schema';

describe('runtime cache schema', () => {
  it('generates identity, wrapping, abstract membership, and opaque scalar metadata', () => {
    const artifact = generateCacheRuntimeSchema(
      `
      scalar JSON
      interface Entity { id: ID! }
      type Note implements Entity { id: ID!, content: JSON!, related: [Entity!] }
      union Result = Note
      type Query { notes: [Note!]!, result: Result }
    `,
      3
    );
    expect(artifact.queryRoot).toBe('Query');
    expect(
      artifact.types.find((t) => t.name === 'Entity')?.possible_types
    ).toEqual(['Note']);
    const note = artifact.types.find((t) => t.name === 'Note');
    expect(note?.key_fields).toEqual(['id']);
    expect(note?.fields.find((f) => f.name === 'related')?.ty).toEqual({
      name: 'Entity',
      kind: 'Composite',
      nullable: true,
      list: true,
      item_nullable: false,
    });
    expect(note?.fields.find((f) => f.name === 'content')?.ty.kind).toBe(
      'OpaqueScalar'
    );
  });

  it.each([
    'type Query { id: ID! }',
    'type Query { note: Note } type Note { id: ID }',
    'type Query { note: Note } type Note { id: String! }',
    'type Query { nested: [[String]] }',
  ])('rejects unsupported schema shapes: %s', (sdl) => {
    expect(() => generateCacheRuntimeSchema(sdl, 3)).toThrow();
  });
});
