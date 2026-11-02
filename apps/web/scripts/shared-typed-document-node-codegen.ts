import { plugin as typedDocumentNode } from '@graphql-codegen/typed-document-node';
import type { PluginFunction } from '@graphql-codegen/plugin-helpers';
import { type DocumentNode, Kind } from 'graphql';
import MagicString from 'magic-string';
import ts from 'typescript';

/** Preserve upstream types/ASTs, but emit each named fragment definition once. */
export const plugin: PluginFunction = async (schema, documents, config, info) => {
  const result = await typedDocumentNode(schema, documents, config, info);
  if (typeof result === 'string')
    throw new Error('typed-document-node must return structured output');
  const ast = ts.createSourceFile('documents.ts', result.content, ts.ScriptTarget.Latest, true);
  const output = new MagicString(result.content);
  const fragments = new Map<string, string>();
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      let initializer = declaration.initializer;
      if (!initializer) continue;
      while (ts.isAsExpression(initializer)) initializer = initializer.expression;
      if (!ts.isObjectLiteralExpression(initializer))
        throw new Error('shared documents require generated document-node objects');
      const document: DocumentNode = JSON.parse(initializer.getText(ast));
      if (document.kind !== Kind.DOCUMENT)
        throw new Error('expected a generated GraphQL document');
      const definitions = document.definitions.map((definition) => {
        if (definition.kind !== Kind.FRAGMENT_DEFINITION)
          return JSON.stringify(definition);
        const name = definition.name.value;
        const serialized = JSON.stringify(definition);
        const previous = fragments.get(name);
        if (previous !== undefined && previous !== serialized)
          throw new Error(`inconsistent generated fragment ${name}`);
        fragments.set(name, serialized);
        return `_sharedFragment_${name}`;
      });
      output.overwrite(initializer.getStart(ast), initializer.getEnd(),
        `{"kind":"Document","definitions":[${definitions.join(',')}]}`);
    }
  }
  const declarations = [...fragments].map(([name, definition]) =>
    `const _sharedFragment_${name} = ${definition} as const;`).join('\n');
  return { ...result, content: `${declarations}\n${output.toString()}` };
};
