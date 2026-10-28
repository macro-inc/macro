import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const src = resolve(import.meta.dirname, '../src');

it('type-checks production core without DOM libraries', () => {
  const configPath = resolve(src, '../tsconfig.core.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(config.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath)
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  expect(
    [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    )
  ).toEqual([]);
});
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(path, entry.name);
    return entry.isDirectory()
      ? files(file)
      : file.endsWith('.ts') && !file.endsWith('.test.ts')
        ? [file]
        : [];
  });
}

it('enforces core -> parsers and browser -> core, with no framework or app imports', () => {
  const violations: string[] = [];
  for (const file of files(src)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    function check(name: string) {
      const target = relative(src, resolve(dirname(file), name));
      if (name === 'parse5' || name === 'css-tree') return;
      if (
        !name.startsWith('.') ||
        target.startsWith('..') ||
        (relative(src, file).startsWith('core/') && !target.startsWith('core/'))
      ) {
        violations.push(`${relative(src, file)} -> ${name}`);
      }
    }
    function visit(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        check(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(source) === 'require')
      ) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument)) check(argument.text);
        else violations.push(`${file}: nonliteral module import`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
});
