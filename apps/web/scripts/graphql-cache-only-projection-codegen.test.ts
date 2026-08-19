import { buildSchema, parse } from 'graphql';
import { describe, expect, it } from 'vitest';
import { plugin } from './graphql-cache-only-projection-codegen';

const schema = buildSchema(`
  directive @cacheOnly on FIELD
  type Query { page: Page!, node: Node!, property: Property! }
  type Page { items: [Item!]!, nextCursor: String }
  interface Node { id: ID! }
  type Item implements Node { id: ID!, label: String! }
  type Other implements Node { id: ID!, count: Int! }
  type Property { value: GraphqlPropertyValue }
  union GraphqlPropertyValue = StringValue | NumberValue
  type StringValue { value: String!, label: String! }
  type NumberValue { value: Float! }
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

  it('finds cache-only fields inside named fragments', async () => {
    const document = parse(`
      query NamedFragmentHydration {
        page { ...PageFields }
      }
      fragment PageFields on Page {
        items @cacheOnly { id }
        nextCursor
      }
    `);

    const output = await plugin(
      schema,
      [{ document, location: 'test.graphql' }],
      {},
      {} as never
    );

    expect(output).toBe(
      'export type NamedFragmentHydrationResult = { "page": { "nextCursor": string | null } };'
    );
  });

  it('renders visible inline-fragment fields for each type condition', async () => {
    const document = parse(`
      query InlineFragmentHydration {
        node {
          __typename
          ... on Item {
            id @cacheOnly
            label
          }
          ... on Other { count }
        }
      }
    `);

    const output = await plugin(
      schema,
      [{ document, location: 'test.graphql' }],
      {},
      {} as never
    );

    expect(output).toBe(
      'export type InlineFragmentHydrationResult = { "node": ({ "__typename": "Item"; "label": string } | { "__typename": "Other"; "count": number }) };'
    );
  });

  it('renders union fields selected through fragments', async () => {
    const document = parse(`
      query UnionHydration {
        property {
          value {
            __typename
            ...StringValueFields
            ... on NumberValue { value }
          }
        }
      }
      fragment StringValueFields on StringValue {
        value @cacheOnly
        label
      }
    `);

    const output = await plugin(
      schema,
      [{ document, location: 'test.graphql' }],
      {},
      {} as never
    );

    expect(output).toBe(
      'export type UnionHydrationResult = { "property": { "value": ({ "__typename": "StringValue"; "label": string } | { "__typename": "NumberValue"; "value": number }) | null } };'
    );
  });
});
