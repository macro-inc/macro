import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import ts from 'typescript';
import manifest from '../package.json';
import tsconfig from '../tsconfig.json';
import {
  allowedWorkspacePackage,
  app,
  checkFile,
  checkUrl,
  localFile,
} from './boundary';

const dependencies = {
  ...manifest.dependencies,
  ...manifest.devDependencies,
};

for (const [name, version] of Object.entries(dependencies)) {
  if (
    name !== allowedWorkspacePackage &&
    (name.startsWith('@macro-inc/') ||
      /^(?:workspace:|file:|link:|npm:@macro-inc\/)/.test(version))
  ) {
    throw new Error(`Bots cannot depend on ${name} (${version})`);
  }
}

for (const [alias, paths] of Object.entries(tsconfig.compilerOptions.paths)) {
  if (!alias.startsWith(`${allowedWorkspacePackage}/`)) {
    throw new Error(`Bots cannot alias ${alias}`);
  }
  for (const path of paths) checkFile(resolve(app, path));
}

function checkImport(specifier: string, file: string): void {
  if (specifier === 'bun:test' || specifier.startsWith('node:')) {
    if (!file.startsWith(join(app, 'src/')) || file.endsWith('.test.ts'))
      return;
  }

  checkUrl(specifier);
  const source = specifier.split(/[?#]/)[0];
  if (source.startsWith('.')) {
    const target = resolve(dirname(file), source);
    if (!localFile(target))
      throw new Error(
        `Bots relative imports must stay within the app: ${source}`
      );
    checkFile(target);
  } else if (source.startsWith('/')) {
    verifyAsset(source, file);
  } else {
    const packageName = source
      .split('/')
      .slice(0, source.startsWith('@') ? 2 : 1)
      .join('/');
    if (!Object.hasOwn(dependencies, packageName)) {
      throw new Error(
        `Bots import must use a declared dependency: ${specifier}`
      );
    }
  }
}

function verifyTypeScript(file: string, contents: string): void {
  const source = ts.createSourceFile(
    file,
    contents,
    ts.ScriptTarget.Latest,
    true
  );

  function checkLiteral(node: ts.Node | undefined) {
    if (!node || !ts.isStringLiteralLike(node)) {
      throw new Error('Bots imports must use a string literal');
    }
    checkImport(node.text, file);
  }

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) checkLiteral(node.moduleSpecifier);
    } else if (ts.isExternalModuleReference(node)) {
      checkLiteral(node.expression);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      checkLiteral(node.argument.literal);
    } else if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      ['src', 'href', 'poster', 'action'].includes(node.name.text) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      verifyAsset(node.initializer.text, file);
    } else if (ts.isCallExpression(node)) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      ) {
        checkLiteral(node.arguments[0]);
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isMetaProperty(node.expression.expression) &&
        node.expression.name.text.startsWith('glob')
      ) {
        throw new Error('Bots imports must name individual modules');
      }
    }
    ts.forEachChild(node, visit);
  }

  for (const entry of source.referencedFiles) checkImport(entry.fileName, file);
  for (const entry of source.typeReferenceDirectives)
    checkImport(entry.fileName, file);
  visit(source);
}

function visitFile(file: string): void {
  const info = lstatSync(file);
  if (info.isSymbolicLink()) {
    if (!localFile(realpathSync(file))) {
      throw new Error(`Bots symlinks must stay within the app: ${file}`);
    }
    return;
  }
  if (info.isDirectory()) {
    for (const entry of readdirSync(file)) visitFile(join(file, entry));
    return;
  }

  const extension = extname(file);
  if (!['.ts', '.tsx', '.css', '.html', '.svg'].includes(extension)) return;
  const contents = readFileSync(file, 'utf8');

  try {
    if (extension === '.ts' || extension === '.tsx')
      verifyTypeScript(file, contents);
    if (extension === '.html' || extension === '.svg') {
      for (const match of contents.matchAll(
        /\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi
      )) {
        verifyAsset(match[1] ?? match[2] ?? match[3], file);
      }
    }
    if (extension === '.css') {
      for (const match of contents.matchAll(
        /@import\s+["']([^"']+)["']|url\(\s*["']?([^"'\s)]+)/gi
      )) {
        verifyAsset(match[1] ?? match[2], file);
      }
    }
  } catch (error) {
    throw new Error(`${file}: ${String(error)}`);
  }
}

function verifyAsset(url: string, file: string): void {
  if (url.startsWith('#')) return;
  checkUrl(url);
  const path = url.split(/[?#]/)[0];
  const target = path.startsWith('/')
    ? resolve(app, `.${path}`)
    : resolve(dirname(file), path);
  if (!localFile(target))
    throw new Error(`Bots assets must stay within the app: ${url}`);
  checkFile(target);
}

for (const entry of readdirSync(app)) {
  if (['dist', 'dist-local', 'node_modules', '.gitignore'].includes(entry))
    continue;
  visitFile(join(app, entry));
}

console.log('Bots workspace boundary passed.');
