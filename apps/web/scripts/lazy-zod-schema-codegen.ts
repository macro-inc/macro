import MagicString from 'magic-string';
import ts from 'typescript';

export function schemaGetterName(name: string): string {
  return `get${name[0].toUpperCase()}${name.slice(1)}Schema`;
}

/** Generated validators expose cached real schema objects at first validation. */
export function deferZodSchemaConstruction(code: string): string {
  const ast = ts.createSourceFile('schemas.ts', code, ts.ScriptTarget.Latest, true);
  const output = new MagicString(code);
  const schemaNames = new Set<string>();
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement) ||
        !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isCallExpression(declaration.initializer))
        schemaNames.add(declaration.name.text);
    }
  }
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement) ||
        !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
      continue;
    if (statement.declarationList.declarations.length !== 1)
      throw new Error('expected one generated schema per declaration');
    const declaration = statement.declarationList.declarations[0];
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
      throw new Error('expected a named generated schema initializer');
    const name = declaration.name.text;
    if (!schemaNames.has(name)) continue;
    const start = declaration.initializer.getStart(ast);
    const expression = new MagicString(declaration.initializer.getText(ast));
    function references(node: ts.Node) {
      if (ts.isIdentifier(node) && schemaNames.has(node.text) &&
          !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) &&
          !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
        expression.overwrite(node.getStart(ast) - start, node.getEnd() - start, `${schemaGetterName(node.text)}()`);
      }
      ts.forEachChild(node, references);
    }
    references(declaration.initializer);
    output.overwrite(statement.getStart(ast), statement.getEnd(), `
function _create_${name}() { return ${expression}; }
let _cached_${name}: ReturnType<typeof _create_${name}> | undefined;
export function ${schemaGetterName(name)}() { return _cached_${name} ??= _create_${name}(); }
`.trim());
  }
  return output.toString();
}
