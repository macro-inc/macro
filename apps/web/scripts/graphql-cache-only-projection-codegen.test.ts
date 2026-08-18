import { buildSchema, parse } from 'graphql';
import { describe, expect, it } from 'vitest';
import { plugin } from './graphql-cache-only-projection-codegen';

const schema = buildSchema(`
  directive @cacheOnly on FIELD
  type Query { page: Page! }
  type Page { items: [Item!]!, nextCursor: String }
  type Item { id: ID! }
`);

describe('@cacheOnly result codegen', () => {
  it('generates a narrow projection and void for a fully cache-only query', async () => {
    const document = parse(`
      query CursorHydration {
        page {
          items @cacheOnly { id }
          nextCursor
        }
      }
      query VoidHydration {
        page @cacheOnly {
          items { id }
          nextCursor
        }
      }
    `);

    const output = await plugin(
      schema,
      [{ document, location: 'test.graphql' }],
      {},
      {} as never
    );

    expect(output).toContain(
      'export type CursorHydrationResult = { "page": { "nextCursor": string | null } };'
    );
    expect(output).toContain('export type VoidHydrationResult = void;');
  });
});
