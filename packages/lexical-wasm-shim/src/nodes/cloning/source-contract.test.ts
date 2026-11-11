import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import ts from 'typescript';
import { expect, test } from 'vitest';

function portFieldWrite(
  node: ts.CallExpression,
  target: string,
  previous: string,
  sameKey: boolean
) {
  const [receiver, source, field, value] = node.arguments;
  if (
    receiver?.getText() !== target ||
    source?.getText() !== previous ||
    !field ||
    !ts.isStringLiteral(field) ||
    !value ||
    !ts.isPropertyAccessExpression(value) ||
    value.expression.getText() !== previous
  )
    throw new Error(
      'clone field writes must read and apply each raw value directly'
    );
  return { field: field.text, value: value.name.text, sameKey };
}

function fieldWrites(body: ts.Node, target: string, previous: string) {
  const writes: { field: string; value: string; sameKey: boolean }[] = [];
  function visit(node: ts.Node, sameKey: boolean): void {
    if (ts.isIfStatement(node)) {
      const condition = node.expression.getText().replace(/\s/g, '');
      visit(
        node.thenStatement,
        sameKey || condition === `${target}.__key===${previous}.__key`
      );
      if (node.elseStatement) visit(node.elseStatement, sameKey);
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.getText() === target &&
      node.left.name.text !== '__state'
    ) {
      if (
        !ts.isPropertyAccessExpression(node.right) ||
        node.right.expression.getText() !== previous
      )
        throw new Error('source field read must use the actual previous node');
      writes.push({
        field: node.left.name.text,
        value: node.right.name.text,
        sameKey,
      });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['writeBaseField', 'writeElementField', 'writeTextField'].includes(
        node.expression.name.text
      )
    ) {
      writes.push(portFieldWrite(node, target, previous, sameKey));
    }
    node.forEachChild((child) => visit(child, sameKey));
  }
  visit(body, false);
  return writes;
}

function stateOperations(body: ts.Node) {
  const operations = { reads: 0, writes: 0, writable: 0, reset: 0 };
  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && node.name.text === '__state') {
      const parent = node.parent;
      if (
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        parent.left === node
      )
        operations.writes++;
      else operations.reads++;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      switch (node.expression.name.text) {
        case 'getRawState':
          operations.reads++;
          break;
        case 'setRawState':
          operations.writes++;
          break;
        case 'getWritable':
          operations.writable++;
          break;
        case 'resetOnCopyNode':
          operations.reset++;
          break;
      }
    }
    node.forEachChild(visit);
  }
  visit(body);
  return operations;
}

test('field algorithms retain pinned raw reads, conditional tree copies and write order', () => {
  const evidence: unknown = JSON.parse(
    readFileSync(new NodeURL('./upstream-source.json', import.meta.url), 'utf8')
  );
  if (
    !evidence ||
    typeof evidence !== 'object' ||
    !('methods' in evidence) ||
    !Array.isArray(evidence.methods)
  )
    throw new Error('missing pinned source evidence');
  const methods: unknown[] = evidence.methods;
  for (const [klass, file, name, originalName] of [
    ['LexicalNode', './base.ts', 'afterCloneBase', 'afterCloneFrom'],
    ['LexicalNode', './base.ts', 'resetStateOnCopy', 'resetOnCopyNodeFrom'],
    [
      'ElementNode',
      './element.ts',
      'afterCloneElementFields',
      'afterCloneFrom',
    ],
    ['TextNode', './text.ts', 'afterCloneTextFields', 'afterCloneFrom'],
  ]) {
    const entry = methods.find(
      (value) =>
        value !== null &&
        typeof value === 'object' &&
        'klass' in value &&
        value.klass === klass &&
        'name' in value &&
        value.name === originalName
    );
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('method' in entry) ||
      typeof entry.method !== 'string'
    )
      throw new Error('missing pinned clone method');
    const original = ts.createSourceFile(
      'original.ts',
      `class Original {${entry.method}}`,
      ts.ScriptTarget.Latest,
      true
    );
    const originalClass = original.statements.find(ts.isClassDeclaration);
    const originalMethod = originalClass?.members.find(ts.isMethodDeclaration);
    const actual = ts.createSourceFile(
      file,
      readFileSync(new NodeURL(file, import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const actualMethod = actual.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === name
    );
    if (
      !originalMethod?.body ||
      !actualMethod ||
      !ts.isFunctionDeclaration(actualMethod) ||
      !actualMethod.body
    )
      throw new Error('missing actual clone algorithm');
    expect(fieldWrites(actualMethod.body, 'target', 'previous')).toEqual(
      fieldWrites(originalMethod.body, 'this', 'prevNode')
    );
    expect(stateOperations(actualMethod.body)).toEqual(
      stateOperations(originalMethod.body)
    );
  }
});
