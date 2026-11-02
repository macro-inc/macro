import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import ts from 'typescript';

/** Generated schema construction is pure, including the whole fluent chain. */
export function pureGeneratedZodSchemas(): Plugin {
  return {
    name: 'pure-generated-zod-schemas',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]generated[\\/](?:zod|tools[\\/]schemas)\.ts$/.test(id))
        return;
      const source = new MagicString(code);
      const ast = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
      for (const statement of ast.statements) {
        if (
          !ts.isVariableStatement(statement) ||
          !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        )
          continue;
        for (const declaration of statement.declarationList.declarations) {
          const initializer = declaration.initializer;
          if (!initializer || !ts.isCallExpression(initializer)) continue;
          // Annotating z.object() alone leaves .describe(), .optional(), etc.
          // alive, as well as side-effectful arguments to unused constructors.
          // Enclose the complete initializer so Rollup can remove it as a unit.
          source.prependLeft(initializer.getStart(ast), '/* @__PURE__ */ (() => ');
          source.appendRight(initializer.getEnd(), ')()');
        }
      }
      return {
        code: source.toString(),
        map: source.generateMap({ hires: true, source: id, includeContent: true }).toString(),
      };
    },
  };
}
