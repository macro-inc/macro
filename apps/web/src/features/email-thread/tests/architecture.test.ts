import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const web = process.cwd();
const features = resolve(web, 'src/features');
const names = ['email-message', 'email-compose', 'email-thread'];
const configPath = resolve(web, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  web
).options;
const cache = ts.createModuleResolutionCache(web, (path) => path, options);

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : files(path);
    return /\.tsx?$/.test(path) && !/\.(test|spec)\.tsx?$/.test(path)
      ? [path]
      : [];
  });
}

function imports(file: string) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const result: { name: string; typeOnly: boolean; target?: string }[] = [];
  const add = (name: string, typeOnly: boolean) =>
    result.push({
      name,
      typeOnly,
      target: ts.resolveModuleName(name, file, options, ts.sys, cache)
        .resolvedModule?.resolvedFileName,
    });
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly =
        !!clause?.isTypeOnly ||
        (!clause?.name &&
          !!named &&
          ts.isNamedImports(named) &&
          named.elements.every((element) => element.isTypeOnly));
      add(node.moduleSpecifier.text, typeOnly);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier.text, node.isTypeOnly);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(source) === 'require')
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) add(argument.text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

const production = names.flatMap((name) => files(resolve(features, name)));
describe('email ownership boundaries', () => {
  it('keeps block dependencies out and dependencies flowing from thread to compose/message', () => {
    const violations: string[] = [];
    for (const file of production) {
      const [owner, layer] = relative(features, file).split('/');
      for (const entry of imports(file)) {
        const target = entry.target
          ? relative(features, entry.target)
          : entry.name;
        const [targetOwner, targetLayer] = target.split('/');
        const report = () =>
          violations.push(`${relative(web, file)} -> ${entry.name}`);
        if (
          /^@block-|^@core\/block|^@core\/signal\/(block|load)/.test(
            entry.name
          ) ||
          /(^|\/)block-[^/]+\//.test(target)
        )
          report();
        if (
          owner === 'email-message' &&
          ['email-thread', 'email-compose'].includes(targetOwner)
        )
          report();
        if (owner === 'email-compose' && targetOwner === 'email-thread')
          report();
        if (names.includes(targetOwner)) {
          if (layer === 'core' && targetLayer !== 'core') report();
          if (
            [
              'core',
              'context',
              'primitives',
              'components',
              'views',
              'queries',
            ].includes(layer) &&
            !targetLayer.includes('/') &&
            ![
              'core',
              'context',
              'primitives',
              'components',
              'views',
              'queries',
            ].includes(targetLayer)
          )
            report();
          if (
            ['primitives', 'queries'].includes(layer) &&
            ['views', 'components'].includes(targetLayer)
          )
            report();
          if (
            layer === 'components' &&
            !entry.typeOnly &&
            ['primitives', 'queries', 'views', 'context'].includes(targetLayer)
          )
            report();
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('can import controllers and contracts without transitively loading production app services or rendering', () => {
    const visited = new Set<string>();
    const violations: string[] = [];
    const visit = (file: string, trail: string[]) => {
      if (visited.has(file)) return;
      visited.add(file);
      for (const entry of imports(file)) {
        if (entry.name.startsWith('@tanstack/')) {
          violations.push(
            [...trail, relative(web, file), entry.name].join(' -> ')
          );
          continue;
        }
        if (
          entry.typeOnly ||
          !entry.target ||
          !entry.target.startsWith(resolve(web, 'src'))
        )
          continue;
        const path = relative(web, entry.target);
        if (
          /src\/(components\/app|lib\/(queries|service-clients|urql-solid))\//.test(
            path
          ) ||
          /\/features\/block-/.test(path) ||
          /\/core\/(context\/user|signal\/(block|load))/.test(path)
        ) {
          violations.push([...trail, relative(web, file), path].join(' -> '));
          continue;
        }
        // Shared pure DOM/editor helpers are allowed; application UI imports are not.
        if (
          entry.target.endsWith('.tsx') &&
          path.includes('/core/component/')
        ) {
          violations.push([...trail, relative(web, file), path].join(' -> '));
          continue;
        }
        visit(entry.target, [...trail, relative(web, file)]);
      }
    };
    for (const file of production.filter((file) =>
      /\/(primitives|context)\//.test(file)
    ))
      visit(file, []);
    expect(violations).toEqual([]);
  });
});
