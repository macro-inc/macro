import { describe, expect, it } from 'vitest';
import {
  deriveEntityResolverSchema,
  renderEntityResolverSchema,
} from './generate-graphql-cache-entity-resolver-schema';

const FIXTURE = `
  schema { query: Root }
  type Root {
    concrete(input: NestedInput!): Entity
    interfaceResult(input: NestedInput!): Node
    unionResult(id: ID!): SearchResult
    embedded(input: NestedInput!): Embedded
    list(input: NestedInput!): [Entity!]!
    listInput(ids: [ID!]!): Entity
    scalar(id: ID!): String
  }
  input NestedInput { nested: IdInput!, ignored: String }
  input IdInput { entityId: ID!, labels: [ID!]! }
  interface Node { id: ID! }
  type Entity implements Node { id: ID!, name: String }
  type OtherEntity implements Node { id: ID! }
  type Embedded { name: String }
  union SearchResult = OtherEntity | Embedded | Entity
`;

describe('GraphQL cache entity resolver schema generator', () => {
  it('derives concrete, interface, union, and nested ID metadata', () => {
    expect(deriveEntityResolverSchema(FIXTURE)).toEqual({
      Root: {
        concrete: {
          targets: ['Entity'],
          argumentPaths: [['input', 'nested', 'entityId']],
        },
        interfaceResult: {
          targets: ['Entity', 'OtherEntity'],
          argumentPaths: [['input', 'nested', 'entityId']],
        },
        unionResult: {
          targets: ['Entity', 'OtherEntity'],
          argumentPaths: [['id']],
        },
      },
    });
  });

  it('excludes embedded/list returns, list inputs, and scalar returns', () => {
    const fields = deriveEntityResolverSchema(FIXTURE).Root;
    expect(fields).not.toHaveProperty('embedded');
    expect(fields).not.toHaveProperty('list');
    expect(fields).not.toHaveProperty('listInput');
    expect(fields).not.toHaveProperty('scalar');
  });

  it('fails clearly for recursive input types', () => {
    expect(() =>
      deriveEntityResolverSchema(`
        schema { query: Root }
        type Root { entity(input: RecursiveInput!): Entity }
        input RecursiveInput { id: ID, next: RecursiveInput }
        type Entity { id: ID! }
      `)
    ).toThrow('recursive input type RecursiveInput');
  });

  it('fails instead of truncating paths beyond the documented depth', () => {
    const inputTypes = Array.from({ length: 18 }, (_, index) =>
      index === 17
        ? `input Input${index} { id: ID }`
        : `input Input${index} { next: Input${index + 1}! }`
    ).join('\n');
    expect(() =>
      deriveEntityResolverSchema(`
        schema { query: Root }
        type Root { entity(input: Input0!): Entity }
        ${inputTypes}
        type Entity { id: ID! }
      `)
    ).toThrow('exceeds maximum depth');
  });

  it('renders deterministic valid empty unions when no fields are eligible', () => {
    const output = renderEntityResolverSchema(
      deriveEntityResolverSchema(`
        schema { query: Root }
        type Root { value: String }
      `)
    );
    expect(output).toContain('export const entityResolverSchema = {\n} as const;');
    expect(output).toContain(
      'export type GeneratedEntityResolverTarget = never;'
    );
    expect(output).toContain(
      'export type GeneratedEntityResolverArgumentPath = never;'
    );
  });

  it('renders deterministically regardless of SDL declaration order', () => {
    const reordered = `
      type Embedded { name: String }
      union SearchResult = Entity | Embedded | OtherEntity
      type OtherEntity implements Node { id: ID! }
      type Entity implements Node { name: String, id: ID! }
      interface Node { id: ID! }
      input IdInput { labels: [ID!]!, entityId: ID! }
      input NestedInput { ignored: String, nested: IdInput! }
      type Root {
        scalar(id: ID!): String
        listInput(ids: [ID!]!): Entity
        list(input: NestedInput!): [Entity!]!
        embedded(input: NestedInput!): Embedded
        unionResult(id: ID!): SearchResult
        interfaceResult(input: NestedInput!): Node
        concrete(input: NestedInput!): Entity
      }
      schema { query: Root }
    `;
    expect(
      renderEntityResolverSchema(deriveEntityResolverSchema(reordered))
    ).toBe(renderEntityResolverSchema(deriveEntityResolverSchema(FIXTURE)));
  });
});
