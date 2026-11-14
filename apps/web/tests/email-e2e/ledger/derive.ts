// What can be read off the web app's source: the requests its email code can
// make, the hotkeys it registers and the toasts it raises. The report checks
// the manifest against these, so a new one cannot go unlisted.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import ts from 'typescript';
import { WEB } from './paths';

/** The web app's email code, from `apps/web`. */
export const EMAIL_SOURCE = [
  'src/features/email-compose',
  'src/features/email-message',
  'src/features/email-thread',
  'src/features/email-view',
  'src/features/block-email',
  'src/lib/queries/email',
  'src/lib/core/email-link',
  'src/lib/core/component/AI/component/tool/email',
  'src/lib/service-clients/service-email',
];

/** Where the app's GraphQL documents are. */
const GRAPHQL = 'src/lib/service-clients/service-storage/graphql';

/** The email service's client: every REST call the app makes to it. */
const EMAIL_CLIENT = 'src/lib/service-clients/service-email/client.ts';

/** The hotkey tokens outside `TOKENS.email` that are email's. */
const EMAIL_TOKENS_ELSEWHERE = [
  'create.email',
  'create.emailNewSplit',
  'split.go.email',
  'sidebar.goTo.mail',
];

function isTest(path: string): boolean {
  return (
    /(^|\/)(browser-test|tests|__tests__|__mocks__|fixtures|generated)\//.test(
      path
    ) || /\.(test|spec|e2e|stories|d)\.tsx?$/.test(path)
  );
}

/** The app code under a directory or the file itself, from `apps/web`. */
export function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (path: string) => {
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) visit(`${path}/${name}`);
      return;
    }
    const file = relative(WEB, path);
    if (/\.tsx?$/.test(file) && !isTest(file)) found.push(file);
  };
  visit(`${WEB}${root}`);
  return found.sort();
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(`${WEB}${file}`, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function calls(file: ts.SourceFile, callee: RegExp): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && callee.test(node.expression.getText())) {
      found.push(node);
    }
    node.forEachChild(visit);
  };
  visit(file);
  return found;
}

function property(
  object: ts.Expression | undefined,
  name: string
): ts.Expression | undefined {
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  for (const member of object.properties) {
    if (ts.isPropertyAssignment(member) && member.name.getText() === name) {
      return member.initializer;
    }
  }
  return undefined;
}

/** The text a user would read in an expression: its first string, else its source. */
function text(node: ts.Expression): string {
  let found: string | undefined;
  const visit = (inner: ts.Node) => {
    if (found !== undefined) return;
    if (ts.isStringLiteralLike(inner)) found = inner.text;
    else if (ts.isTemplateExpression(inner)) {
      found = inner.getText().slice(1, -1);
    } else inner.forEachChild(visit);
  };
  visit(node);
  return (found ?? node.getText()).replace(/\s+/g, ' ').slice(0, 80);
}

export type DerivedOperation = {
  id: string;
  kind: 'rest' | 'query' | 'mutation' | 'subscription';
  file: string;
};

/** Every operation in the app's GraphQL documents. */
export function graphqlOperations(): DerivedOperation[] {
  const found: DerivedOperation[] = [];
  for (const name of readdirSync(`${WEB}${GRAPHQL}`).sort()) {
    if (!name.endsWith('.graphql')) continue;
    const document = readFileSync(`${WEB}${GRAPHQL}/${name}`, 'utf8');
    for (const match of document.matchAll(
      /^\s*(query|mutation|subscription)\s+(\w+)/gm
    )) {
      found.push({
        id: match[2],
        kind: match[1] as DerivedOperation['kind'],
        file: `${GRAPHQL}/${name}`,
      });
    }
  }
  return found;
}

/** The front's path prefix of the service a host variable names. */
const HOSTS: Record<string, string> = {
  emailHost: '/email',
  calendarHost: '/calendar',
};

/**
 * The paths an expression can be, with `{}` for what is filled in at run
 * time and no query string.
 */
function paths(node: ts.Expression, scope: ts.Node): string[] {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return paths(node.expression, scope);
  if (ts.isConditionalExpression(node)) {
    return [...paths(node.whenTrue, scope), ...paths(node.whenFalse, scope)];
  }
  if (ts.isIdentifier(node)) {
    if (HOSTS[node.text]) return [HOSTS[node.text]];
    // A path built in a variable of the same function.
    let found: string[] | undefined;
    const visit = (inner: ts.Node) => {
      if (
        ts.isVariableDeclaration(inner) &&
        inner.name.getText() === node.text &&
        inner.initializer
      ) {
        found = paths(inner.initializer, scope);
      }
      inner.forEachChild(visit);
    };
    visit(scope);
    return found ?? ['{}'];
  }
  if (ts.isTemplateExpression(node)) {
    let all = [node.head.text];
    for (const span of node.templateSpans) {
      const filled = paths(span.expression, scope);
      all = all.flatMap((prefix) =>
        filled.map((part) => `${prefix}${part}${span.literal.text}`)
      );
    }
    return all;
  }
  return ['{}'];
}

function template(path: string): string {
  return (
    path
      .split('?')[0]
      // A query string appended as a value of its own.
      .replace(/(\{\})+/g, '{}')
      .replace(/([^/])\{\}$/, '$1')
  );
}

/** Every REST call of the email service's client. */
export function restCalls(): DerivedOperation[] {
  const file = parse(EMAIL_CLIENT);
  const found = new Map<string, DerivedOperation>();
  for (const call of calls(file, /^(emailFetch|fetchWithToken)$/)) {
    const [url, init] = call.arguments;
    if (!url) continue;
    let scope: ts.Node = call;
    while (scope.parent && !ts.isFunctionLike(scope)) scope = scope.parent;
    // `emailFetch` itself passes its argument on: not a call of its own.
    if (ts.isFunctionDeclaration(scope) && scope.name?.text === 'emailFetch') {
      continue;
    }
    const method = property(init, 'method');
    const verb = method && ts.isStringLiteralLike(method) ? method.text : 'GET';
    const prefix = call.expression.getText() === 'emailFetch' ? '/email' : '';
    for (const path of new Set(paths(url, scope).map(template))) {
      const id = `${verb} ${prefix}${path}`;
      found.set(id, { id, kind: 'rest', file: EMAIL_CLIENT });
    }
  }
  return [...found.values()];
}

export type Registered = { key: string; file: string; line: number };

function at(file: ts.SourceFile, node: ts.Node): number {
  return file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

/**
 * Every hotkey the email code registers, which is also a command of the
 * command menu when it has a description: named by its token, or by its file
 * and description when it has none. And every email token, registered or not.
 */
export function hotkeys(): Registered[] {
  const found = new Map<string, Registered>();
  for (const name of EMAIL_SOURCE.flatMap(sourceFiles)) {
    const file = parse(name);
    for (const call of calls(file, /^registerHotkey$/)) {
      const options = call.arguments[0];
      const token = property(options, 'hotkeyToken')?.getText();
      const description = property(options, 'description');
      const key = token?.startsWith('TOKENS.')
        ? token.slice('TOKENS.'.length)
        : `${name}#${description ? text(description) : (property(options, 'hotkey')?.getText() ?? '?')}`;
      if (!found.has(key))
        found.set(key, { key, file: name, line: at(file, call) });
    }
  }

  const tokens = 'src/lib/core/hotkey/tokens.ts';
  const file = parse(tokens);
  const visit = (node: ts.Node, path: string[]) => {
    if (ts.isPropertyAssignment(node)) {
      const here = [...path, node.name.getText()];
      if (ts.isStringLiteralLike(node.initializer)) {
        const key = node.initializer.text;
        const email =
          here[0] === 'email' || EMAIL_TOKENS_ELSEWHERE.includes(key);
        if (email && !found.has(key)) {
          found.set(key, { key, file: tokens, line: at(file, node) });
        }
        return;
      }
      node.initializer.forEachChild((inner) => visit(inner, here));
      return;
    }
    node.forEachChild((inner) => visit(inner, path));
  };
  visit(file, []);
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Every toast the email code raises: named by its file and its text. */
export function toasts(): Registered[] {
  const found = new Map<string, Registered>();
  for (const name of EMAIL_SOURCE.flatMap(sourceFiles)) {
    const file = parse(name);
    for (const call of calls(file, /^(toast\.(?!dismiss)\w+|showToast)$/)) {
      const message = call.arguments[0];
      if (!message) continue;
      const key = `${name}#${text(message)}`;
      if (!found.has(key))
        found.set(key, { key, file: name, line: at(file, call) });
    }
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

if (import.meta.main) {
  const what = process.argv[2];
  const all = { graphql: graphqlOperations, rest: restCalls, hotkeys, toasts };
  const list = all[what as keyof typeof all];
  if (!list) throw new Error(`one of: ${Object.keys(all).join(', ')}`);
  for (const item of list()) console.log(JSON.stringify(item));
}
