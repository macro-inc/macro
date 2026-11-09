// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { expect, test } from 'vitest';
import { lexicalEngineSwitch } from '../../../../scripts/lexical-engine-switch';

async function evaluateSwitch(enabled: boolean, complete = true) {
  const fixture: Plugin = {
    name: 'lexical-binding-fixture',
    resolveId(id) {
      if (id.endsWith('/fixture:entry')) return '\0fixture:entry';
      if (id.startsWith('fixture:')) return '\0' + id;
    },
    load(id) {
      if (id === '\0fixture:selection')
        return `export let RUST_EDITOR_ENGINE = ${enabled}; export function changeFlag() { RUST_EDITOR_ENGINE = !RUST_EDITOR_ENGINE; }`;
      if (id === '\0fixture:compat' && !complete)
        return 'export const placeholder = true;';
      if (id === '\0fixture:compat')
        return `
          import { TextNode as BaseText, ElementNode as BaseElement, createCommand } from 'lexical-upstream:lexical';
          export * from 'lexical-upstream:lexical';
          export class TextNode extends BaseText {}
          export class ElementNode extends BaseElement {}
          export const FORMAT_TEXT_COMMAND = createCommand();
          export function createEditor() { throw new Error('fixture engine not initialized'); }
        `;
      if (id === '\0fixture:compat/internal/devInvariant')
        return "export { default } from 'lexical-upstream:@lexical/internal/devInvariant';";
      if (id.startsWith('\0fixture:compat/'))
        return `export * from 'lexical-upstream:@lexical/${id.slice('\0fixture:compat/'.length)}';`;
      if (id === '\0fixture:entry')
        return `
          import { TextNode, ElementNode, FORMAT_TEXT_COMMAND, createEditor } from 'lexical';
          import * as upstream from 'lexical-upstream:lexical';
          import * as compat from 'fixture:compat';
          import { HeadingNode } from '@lexical/rich-text';
          import invariant from '@lexical/internal/devInvariant';
          import originalInvariant from 'lexical-upstream:@lexical/internal/devInvariant';
          import * as selected from 'lexical';
          import { changeFlag } from 'fixture:selection';
          class CustomText extends TextNode {}
          export const originalClass = TextNode === upstream.TextNode;
          export const compatClass = TextNode === compat.TextNode;
          export const originalCommand = FORMAT_TEXT_COMMAND === upstream.FORMAT_TEXT_COMMAND;
          export const compatCommand = FORMAT_TEXT_COMMAND === compat.FORMAT_TEXT_COMMAND;
          export const originalFactory = createEditor === upstream.createEditor;
          export const compatFactory = createEditor === compat.createEditor;
          export const classBeforeInitialization = Object.getPrototypeOf(CustomText) === TextNode;
          export const richClassUsesSelectedCore = Object.getPrototypeOf(HeadingNode) === ElementNode;
          export const sameDefaultExport = invariant === originalInvariant;
          export const sameExports = Object.keys(selected).sort().join(',') === Object.keys(upstream).sort().join(',');
          const captured = TextNode;
          changeFlag();
          export const unchangedAfterFlagRefresh = TextNode === captured;
        `;
    },
  };
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    plugins: [
      fixture,
      lexicalEngineSwitch({
        selectionModule: 'fixture:selection',
        compatPackage: 'fixture:compat',
      }),
    ],
    build: {
      write: false,
      minify: false,
      target: 'esnext',
      lib: { entry: 'fixture:entry', formats: ['es'] },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(
    (build) => {
      if (!('output' in build))
        throw new Error('Unexpected switch build watcher');
      return build.output;
    }
  );
  const entry = outputs.find(
    (chunk) => chunk.type === 'chunk' && chunk.isEntry
  );
  if (!entry || entry.type !== 'chunk') throw new Error('Missing switch entry');
  const module: Record<string, boolean> = await import(
    `data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`
  );
  return module;
}

test('OFF retains exact upstream classes, commands and factories across packages', async () => {
  const bindings = await evaluateSwitch(false);
  expect(bindings.originalClass).toBe(true);
  expect(bindings.originalCommand).toBe(true);
  expect(bindings.originalFactory).toBe(true);
  expect(bindings.richClassUsesSelectedCore).toBe(true);
  expect(bindings.sameDefaultExport).toBe(true);
  expect(bindings.sameExports).toBe(true);
  expect(bindings.classBeforeInitialization).toBe(true);
  expect(bindings.unchangedAfterFlagRefresh).toBe(true);
});

test('ON binds compat classes and commands before initialization without caller changes', async () => {
  const bindings = await evaluateSwitch(true);
  expect(bindings.compatClass).toBe(true);
  expect(bindings.compatCommand).toBe(true);
  expect(bindings.compatFactory).toBe(true);
  expect(bindings.originalClass).toBe(false);
  expect(bindings.originalCommand).toBe(false);
  expect(bindings.originalFactory).toBe(false);
  expect(bindings.richClassUsesSelectedCore).toBe(true);
  expect(bindings.sameDefaultExport).toBe(true);
  expect(bindings.sameExports).toBe(true);
  expect(bindings.classBeforeInitialization).toBe(true);
  expect(bindings.unchangedAfterFlagRefresh).toBe(true);
});

test('an incomplete selected engine fails instead of exporting missing API values', async () => {
  await expect(evaluateSwitch(true, false)).rejects.toThrow(
    'Missing selected engine export in lexical:'
  );
});

test('the cached boot selector has no editor dependency before engine binding', async () => {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    plugins: [
      tsconfigPaths(),
      {
        name: 'boot-selector-dependency-boundary',
        moduleParsed(module) {
          if (
            /[/]node_modules[/](lexical|@lexical)[/]|[/]lexical-core[/]|[/]LexicalMarkdown[/]/.test(
              module.id
            )
          )
            throw new Error(`Editor dependency in boot selector: ${module.id}`);
        },
      },
    ],
    build: {
      write: false,
      target: 'esnext',
      lib: {
        entry: fileURLToPath(new URL('./engine-selection.ts', import.meta.url)),
        formats: ['es'],
      },
    },
  });
});
