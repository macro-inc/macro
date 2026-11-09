import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { checkDeclarations } from './oracle';
import { wildcardAliases } from './wildcard-types';

test('ordinary declaration any permission is confined to the four exact emitted aliases', () => {
  const root = mkdtempSync(join(tmpdir(), 'extension-wildcard-declarations-'));
  const source = join(root, 'compatibility-exceptions.ts');
  const declaration = join(root, 'compatibility-exceptions.d.ts');
  const definitions =
    'interface LexicalExtension<C,N,O,I>{readonly config:C;readonly name:N;readonly output:O;readonly init:I;}\ninterface NormalizedLexicalExtensionArgument<C,N,O,I>{readonly extension:LexicalExtension<C,N,O,I>;}\n';
  const exact = definitions + Object.values(wildcardAliases).join('\n');
  const check = (text: string, approved = source) => {
    writeFileSync(source, text);
    writeFileSync(declaration, text);
    return checkDeclarations({
      roots: [declaration],
      projected: (path) => path === declaration,
      rejectAny: (path) => path === declaration,
      declarations: new Map([[source, declaration]]),
      wildcardSource: approved,
    });
  };
  try {
    assert.deepEqual(check(exact).diagnostics, []);
    assert.throws(
      () => check(exact, join(root, 'other.ts')),
      /Untyped public declaration/
    );
    assert.throws(
      () => check(exact + '\nexport type Extra = any;'),
      /Untyped public declaration/
    );
    assert.throws(
      () => check(exact.replace('any, string, any, any', 'any, any, any, any')),
      /Untyped public declaration/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
