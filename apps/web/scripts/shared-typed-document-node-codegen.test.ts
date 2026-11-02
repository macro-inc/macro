import { createRequire } from 'node:module';
import { plugin as typedDocumentNode } from '@graphql-codegen/typed-document-node';
import type { DocumentNode } from 'graphql';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { plugin } from './shared-typed-document-node-codegen';

const { buildSchema, parse, print, validate }: typeof import('graphql') = createRequire(import.meta.url)('graphql');

it('shares diamond fragments while preserving complete operation ASTs and directives', async () => {
  const schema = buildSchema(`
    directive @cacheOnly on FIELD
    type Item { id: ID!, label: String! }
    type Query { item(id: ID!): Item! }
  `);
  const documents = [{ document: parse(`
    fragment Identity on Item { id }
    fragment Left on Item { ...Identity label }
    fragment Right on Item { ...Identity }
    query First($id: ID!) { item(id: $id) { ...Left ...Right } }
    query Second($id: ID!) { item(id: $id) { ...Left label @cacheOnly } }
  `) }];
  const config = {};
  const upstream = await typedDocumentNode(schema, documents, config, {} as never);
  const shared = await plugin(schema, documents, config, {} as never);
  if (typeof upstream === 'string' || typeof shared === 'string')
    throw new Error('expected structured document output');
  async function load(content: string): Promise<Record<string, DocumentNode>> {
    const javascript = ts.transpile(content, { target: ts.ScriptTarget.ESNext });
    return import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
  }
  const original = await load(upstream.content);
  const generated = await load(shared.content);
  expect(Object.keys(generated)).toEqual(Object.keys(original));
  for (const [name, document] of Object.entries(generated)) {
    expect(print(document)).toBe(print(original[name]));
    if (name.endsWith('Document')) expect(validate(schema, document)).toEqual([]);
  }
  const identity = generated.IdentityFragmentDoc.definitions[0];
  expect(generated.FirstDocument.definitions).toContain(identity);
  expect(generated.SecondDocument.definitions).toContain(identity);
  expect(generated.LeftFragmentDoc.definitions).toContain(identity);
});
