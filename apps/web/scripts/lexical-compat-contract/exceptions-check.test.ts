import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'vitest';
import { verifyExceptions } from './exceptions-check';
import { wildcardAliases } from './wildcard-types';

function fixture(body: (root: string, manifest: unknown) => void) {
  const root = mkdtempSync(join(tmpdir(), 'compat-exception-guard-'));
  const central =
    Object.values(wildcardAliases).join('\n') +
    '\n' +
    'export function assumeNodeType<T>(node:unknown):T{return node as T;}\nexport function nodeConfigRecord<T>(record:unknown):T{return record as T;}\nexport function createPointWithUpstreamType<T>(point:unknown):T{return point as T;}\nexport function applyValueOrUpdater<T>(value:unknown):T{return value as T;}\nexport function nodeStateToJSON<T>(value:unknown):T{return value as T;}\nexport function commandBucket<T>(value:unknown):T{return value as T;}\nexport function invokeDOMConversionWithNode<R>(conversion:(node:HTMLElement)=>R,node:Node):R{return conversion(node as HTMLElement); }\nexport function compareNumberWithUpstreamType(a:number,b:number):-1|0|1{return Math.sign(a-b) as -1|0|1;}\nexport function widenTagConversionMap<T>(value:unknown):T{return value as T;}\nexport function isInstanceOfKlass<T extends abstract new (...args:never[])=>unknown>(value:unknown,klass:T):value is InstanceType<T>{return value instanceof klass;}\n';
  const manifest = JSON.parse(
    readFileSync(new URL('./exceptions.json', import.meta.url), 'utf8')
  );
  const hash = createHash('sha256').update(central).digest('hex');
  const files: { [key: string]: string } = {
    'compatibility-exceptions.ts': central,
    'nodes/build-import-map.ts': `import {widenTagConversionMap} from '../compatibility-exceptions';export function buildImportMap(value:unknown){return widenTagConversionMap(value);}`,
    'nodes/runtime.ts': `export {assumeNodeType,nodeConfigRecord} from '../compatibility-exceptions';`,
    'nodes/base.ts': `import {assumeNodeType as narrow,nodeConfigRecord} from './runtime';export class Node {getParent(){return narrow(1);}getPreviousSibling(){return narrow(1);}getNextSibling(){return narrow(1);}getCommonAncestor(){return narrow(1);}config(){return nodeConfigRecord(1);}}`,
    'nodes/runtime-primitives.ts': `import {assumeNodeType} from '../compatibility-exceptions';export function nodeByKey(){return assumeNodeType(1);}export function nodeWritable(){return assumeNodeType(1);}`,
    'selection/point.ts': `import * as exceptions from '../compatibility-exceptions';export function $createPoint(){return exceptions.createPointWithUpstreamType(1);}`,
    'nodes/state/helpers.ts': `import {applyValueOrUpdater} from '../../compatibility-exceptions';export function $setState(){return applyValueOrUpdater(1);}`,
    'nodes/state/record.ts': `import {nodeStateToJSON} from '../../compatibility-exceptions';export class Record {toJSON(){return nodeStateToJSON(1);}}`,
    'command/registry.ts': `import {commandBucket} from '../compatibility-exceptions';function lookup(){return commandBucket(1);}`,
    'nodes/replacement/helpers.ts': `import {assumeNodeType} from '../../compatibility-exceptions';export function $applyNodeReplacement(){return assumeNodeType(1);}export function $create(){return assumeNodeType(1);}`,
    'configuration/html-conversions.ts': `import {invokeDOMConversionWithNode} from '../compatibility-exceptions';export function getDOMNodeConversionFunction(domNode:Node){const convert=(node:HTMLElement)=>(node:HTMLElement)=>1;const conversion=invokeDOMConversionWithNode(convert,domNode);return (node:Node)=>invokeDOMConversionWithNode(conversion,node);}`,
    'caret/ancestry.ts': `import {compareNumberWithUpstreamType} from '../compatibility-exceptions';export function $comparePointCaretNext(a:number,b:number){return compareNumberWithUpstreamType(a,b);}`,
    'nodes/replacement/bind.ts': `import {isInstanceOfKlass} from '../../compatibility-exceptions';export function bindReplacement(){return (value:unknown,klass:abstract new (...args:never[])=>unknown)=>isInstanceOfKlass(value,klass);}`,
  };
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, 'src', path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source);
  }
  try {
    body(root, {
      ...manifest,
      implementationSha256: hash,
      typeOnlyException: {
        ...manifest.typeOnlyException,
        references: [
          ...Object.keys(wildcardAliases).map(
            (alias) =>
              'compatibility-exceptions.ts:' + alias + ':TypeAliasDeclaration'
          ),
          'compatibility-exceptions.ts:AnyLexicalExtension:TypeReference',
          'compatibility-exceptions.ts:AnyNormalizedLexicalExtensionArgument:TypeReference',
        ],
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('central hash, nine assertions, exact witness and aliased/namespace callsites match', () =>
  fixture((root, manifest) => {
    const result = verifyExceptions(root, manifest);
    assert.equal(
      Object.values(result.assertions).reduce((a, b) => a + b, 0),
      9
    );
    assert.equal(result.calls.assumeNodeType.length, 8);
    assert.equal(result.calls.commandBucket.length, 1);
    assert.deepEqual(result.calls.compareNumberWithUpstreamType, [
      'caret/ancestry.ts:$comparePointCaretNext',
    ]);
    assert.equal(result.calls.invokeDOMConversionWithNode.length, 2);
    assert.deepEqual(result.domInvocationCallForms, [
      'returned-arrow-body',
      'variable-initializer',
    ]);
    assert.deepEqual(result.runtimeGuards, [
      {
        helper: 'isInstanceOfKlass',
        kind: 'runtime-witness guard (sound)',
        body: 'return value instanceof klass;',
      },
    ]);
  }));

test('changed helper bytes or an inline tenth assertion fail closed', () => {
  fixture((root, manifest) => {
    const path = join(root, 'src/compatibility-exceptions.ts');
    writeFileSync(path, readFileSync(path, 'utf8') + '\n');
    assert.throws(() => verifyExceptions(root, manifest), /hash differs/);
  });
  fixture((root, manifest) => {
    writeFileSync(
      join(root, 'src/extra.ts'),
      'export function unchecked(value:unknown){return value as string;}'
    );
    assert.throws(() => verifyExceptions(root, manifest), /outside central/);
  });
});

test('the nine-assertion list and one sound witness cannot be omitted or expanded', () =>
  fixture((root, manifest) => {
    if (manifest === null || typeof manifest !== 'object')
      throw new Error('Invalid fixture manifest');
    assert.throws(() =>
      verifyExceptions(root, { ...manifest, runtimeGuards: [] })
    );
    assert.throws(
      () => verifyExceptions(root, { ...manifest, exceptions: [] }),
      /Exactly the nine/
    );
    const helpers = [
      'applyValueOrUpdater',
      'assumeNodeType',
      'commandBucket',
      'compareNumberWithUpstreamType',
      'createPointWithUpstreamType',
      'invokeDOMConversionWithNode',
      'nodeConfigRecord',
      'nodeStateToJSON',
      'widenTagConversionMap',
      'unapproved',
    ];
    assert.throws(
      () =>
        verifyExceptions(root, {
          ...manifest,
          exceptions: helpers.map((helper) => ({ helper, calls: [] })),
        }),
      /Exactly the nine/
    );
  }));

test('runtime witness body and generic signature remain exact even with an updated source hash', () => {
  for (const [before, after, expected] of [
    ['return value instanceof klass;', 'return true;', /witness body/],
    [
      'return value instanceof klass;',
      'return klass instanceof value;',
      /witness body/,
    ],
    [
      'return value instanceof klass;',
      'if(value===null)return false;return value instanceof klass;',
      /witness body/,
    ],
    ['klass:T', 'klass:unknown', /witness.*signature/],
    ['...args:never[]', '...args:unknown[]', /witness.*signature/],
    ['value:unknown,klass:T', 'value:unknown,klass?:T', /witness.*signature/],
    [
      'export function isInstanceOfKlass',
      'type InstanceType<T>=number;export function isInstanceOfKlass',
      /witness signature/,
    ],
  ] satisfies readonly (readonly [string, string, RegExp])[])
    fixture((root, manifest) => {
      const path = join(root, 'src/compatibility-exceptions.ts');
      const changed = readFileSync(path, 'utf8').replace(before, after);
      writeFileSync(path, changed);
      if (manifest === null || typeof manifest !== 'object')
        throw new Error('Invalid fixture manifest');
      const next = {
        ...manifest,
        implementationSha256: createHash('sha256')
          .update(changed)
          .digest('hex'),
      };
      assert.throws(() => verifyExceptions(root, next), expected);
    });
}, 30000);

test('extra, removed, duplicate or indirect helper use cannot evade callsite manifest', () => {
  for (const change of [
    'extra',
    'removed',
    'duplicate',
    'indirect',
    'namespace-alias',
  ])
    fixture((root, manifest) => {
      const path = join(root, 'src/nodes/base.ts');
      let source = readFileSync(path, 'utf8');
      if (change === 'extra')
        source += 'export function extra(){return narrow(2);}';
      if (change === 'removed')
        source = source.replace('return narrow(1);', 'return 1;');
      if (change === 'duplicate')
        source = source.replace(
          'return narrow(1);',
          'narrow(1);return narrow(1);'
        );
      if (change === 'indirect')
        source = source.replace(
          'return narrow(1);',
          'const alias=narrow;return alias(1);'
        );
      if (change === 'namespace-alias') {
        source +=
          "import * as E from '../compatibility-exceptions';const {assumeNodeType:hidden}=E;export function extra(){return hidden(1);}";
      }
      writeFileSync(path, source);
      assert.throws(
        () => verifyExceptions(root, manifest),
        /callsites differ|only be directly invoked|namespace may only/
      );
    });
}, 30000);

test('reachable test-named files and newly named generated files cannot hide assertions', () => {
  for (const name of [
    'hidden.test.ts',
    'hidden.generated.ts',
    '__tests__/hidden.ts',
  ])
    fixture((root, manifest) => {
      const path = join(root, 'src', name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        'export function unsafe<T>(value:unknown):T{return value as T;}'
      );
      writeFileSync(
        join(root, 'src/index.ts'),
        `export {unsafe} from './${name.replace(/\.ts$/, '')}';`
      );
      assert.throws(() => verifyExceptions(root, manifest), /outside central/);
    });
});

test('a namespace imported through an approved barrel cannot escape', () =>
  fixture((root, manifest) => {
    writeFileSync(
      join(root, 'src/extra.ts'),
      "import * as E from './nodes/runtime';export const leaked=E;"
    );
    assert.throws(() => verifyExceptions(root, manifest), /namespace may only/);
  }));

test('both DOM invocation sites are mandatory and cannot be replaced by an indirect helper', () => {
  for (const change of [
    'factory',
    'converter',
    'extra',
    'indirect',
    'duplicate-factory',
  ])
    fixture((root, manifest) => {
      const path = join(root, 'src/configuration/html-conversions.ts');
      let source = readFileSync(path, 'utf8');
      if (change === 'factory')
        source = source.replace(
          'invokeDOMConversionWithNode(convert,domNode)',
          'convert(domNode)'
        );
      if (change === 'converter')
        source = source.replace(
          'invokeDOMConversionWithNode(conversion,node)',
          'conversion(node)'
        );
      if (change === 'extra')
        source +=
          'export function extra(node:Node){return invokeDOMConversionWithNode(()=>1,node);}';
      if (change === 'duplicate-factory')
        source = source.replace(
          'return (node:Node)=>invokeDOMConversionWithNode(conversion,node);',
          'const duplicate=invokeDOMConversionWithNode(convert,domNode);return conversion;'
        );
      if (change === 'indirect')
        source += 'export const escaped=invokeDOMConversionWithNode;';
      writeFileSync(path, source);
      assert.throws(
        () => verifyExceptions(root, manifest),
        /callsites differ|only be directly invoked|call forms differ/
      );
    });
});

test('the caret comparison has exactly its approved direct consumer and no reexports', () => {
  for (const change of ['removed', 'extra', 'indirect', 'reexport'])
    fixture((root, manifest) => {
      const path = join(root, 'src/caret/ancestry.ts');
      let source = readFileSync(path, 'utf8');
      if (change === 'removed')
        source = source.replace('compareNumberWithUpstreamType(a,b)', 'a-b');
      if (change === 'extra')
        source +=
          'export function extra(){return compareNumberWithUpstreamType(1,2);}';
      if (change === 'indirect')
        source += 'export const escaped=compareNumberWithUpstreamType;';
      if (change === 'reexport')
        source +=
          "export {compareNumberWithUpstreamType} from '../compatibility-exceptions';";
      writeFileSync(path, source);
      assert.throws(
        () => verifyExceptions(root, manifest),
        /callsites differ|only be directly invoked|reexports differ/
      );
    });
});

test('public wildcard aliases retain exactly their sanctioned any positions', () => {
  for (const [before, after] of [
    [
      'LexicalExtension<any, string, any, any>',
      'LexicalExtension<any, any, any, any>',
    ],
    ['OutputExtension<Output>', 'OutputExtension<Output = any>'],
    ['export type OutputExtension', 'type OutputExtension'],
  ])
    fixture((root, manifest) => {
      const path = join(root, 'src/compatibility-exceptions.ts');
      const changed = readFileSync(path, 'utf8').replace(before, after);
      writeFileSync(path, changed);
      if (manifest === null || typeof manifest !== 'object')
        throw new Error('Invalid fixture manifest');
      assert.throws(
        () =>
          verifyExceptions(root, {
            ...manifest,
            implementationSha256: createHash('sha256')
              .update(changed)
              .digest('hex'),
          }),
        /wildcard alias definitions/
      );
    });
});

test('wildcard permission cannot expand to other aliases or source positions', () => {
  for (const extra of [
    'export type Hidden = any;',
    "import type {AnyLexicalExtension} from './compatibility-exceptions';export type Extra = AnyLexicalExtension;",
    "export {AnyLexicalExtension} from './compatibility-exceptions';",
  ])
    fixture((root, manifest) => {
      writeFileSync(join(root, 'src/extra.ts'), extra);
      assert.throws(
        () => verifyExceptions(root, manifest),
        /Unapproved type-level any|reference inventory|type-only exports/
      );
    });
});
