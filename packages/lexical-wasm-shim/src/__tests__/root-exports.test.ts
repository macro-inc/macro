import { spawnSync } from 'node:child_process';
import { URL as NodeURL } from 'node:url';
import { expect, test } from 'vitest';
import * as environment from '../../../lexical-wasm-view/src/compat/environment';
import * as caret from '../caret';
import * as commands from '../commands';
import * as constants from '../constants';
import * as defaultDOM from '../editor-dom-config';
import * as extensionCore from '../extension-core';
import * as root from '../index';
import * as artificial from '../nodes/artificial';
import * as importMap from '../nodes/build-import-map';
import * as css from '../nodes/dom-style';
import * as replacement from '../nodes/replacement';
import * as state from '../nodes/state';
import * as staticConfig from '../nodes/static-config';
import * as selectionHelpers from '../selection/helpers';
import * as serialization from '../serialization';
import * as utilities from '../utilities';
import manifest from './root-exports.manifest.json';

const producers: Record<string, object> = {
  './caret': caret,
  './extension-core': extensionCore,
  './utilities': utilities,
  './selection/helpers': selectionHelpers,
  './editor-dom-config': defaultDOM,
  './nodes/artificial': artificial,
  './nodes/build-import-map': importMap,
  './nodes/dom-style': css,
  './nodes/replacement': replacement,
  './nodes/state': state,
  './nodes/static-config': staticConfig,
  './serialization': serialization,
  '../../lexical-wasm-view/src/compat/environment': environment,
};

test('new pinned root values retain the exact actual producer bindings and types remain erased', () => {
  const actual = new Map<string, unknown>(Object.entries(root));
  for (const entry of manifest.added) {
    if (entry.typeOnly) {
      expect(actual.has(entry.name), entry.name).toBe(false);
      continue;
    }
    const producer = producers[entry.source];
    expect(producer, entry.source).toBeDefined();
    const bindings = new Map<string, unknown>(Object.entries(producer));
    expect(bindings.has(entry.name), entry.name).toBe(true);
    expect(actual.get(entry.name), entry.name).toBe(bindings.get(entry.name));
  }
  for (const name of manifest.unforwardedInternalRuntime)
    expect(actual.has(name), name).toBe(false);
});

test('existing pinned command, formatting and tag exports retain their producer objects', () => {
  const actual = new Map<string, unknown>(Object.entries(root));
  for (const group of manifest.existingSingletons) {
    const source = group.source === './commands' ? commands : constants;
    const bindings = new Map<string, unknown>(Object.entries(source));
    for (const name of group.names)
      expect(actual.get(name), name).toBe(bindings.get(name));
  }
  for (const name of manifest.internalConstants)
    expect(actual.has(name), name).toBe(false);
});

test('root forwarded factories use the actual active registry and serializer', () => {
  const editor = root.createEditor();
  try {
    editor.update(
      () => {
        const created = root.$create(root.TextNode);
        expect(root.$applyNodeReplacement(created)).toBe(created);
        expect(root.getRegisteredNode(editor, 'text')).toBe(
          editor._nodes.get('text')
        );
        expect(root.getRegisteredNodeOrThrow(editor, 'text')).toBe(
          editor._nodes.get('text')
        );
        const serialized = {
          type: 'text',
          version: 1,
          text: 'root parse',
          format: 0,
          detail: 0,
          mode: 'normal',
          style: '',
        };
        const parsed = root.$parseSerializedNode(serialized);
        expect(parsed).toBeInstanceOf(root.TextNode);
        expect(parsed.getTextContent()).toBe('root parse');
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('forwarded root modules remain cold and pure metadata works without an engine', () => {
  const entry = new NodeURL('../index.ts', import.meta.url).href;
  const result = spawnSync(
    'bun',
    [
      '-e',
      `
  for(const name of ['compile','compileStreaming','instantiate','instantiateStreaming']) {
   WebAssembly[name]=()=>{throw new Error('unexpected engine initialization');};
  }
  const root=await import(${JSON.stringify(entry)});
  const config=root.createState('cold-state',{parse:()=>3});
  if(config.defaultValue!==3) throw new Error('incorrect actual state config');
  if(root.ArtificialNode__DO_NOT_USE.getType()!=='artificial') throw new Error('incorrect actual ArtificialNode');
  if(root.getStaticNodeConfig(root.TextNode).ownNodeType!=='text') throw new Error('incorrect actual preparation');
  if('StateConfig' in root || 'bindStateRuntime' in root) throw new Error('internal value export');
  process.stdout.write('cold exports ready');
 `,
    ],
    { encoding: 'utf8' }
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe('cold exports ready');
});
