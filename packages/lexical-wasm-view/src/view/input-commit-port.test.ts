/** @vitest-environment jsdom */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import {
  ABI_MAJOR,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { afterAll, beforeAll, expect, test } from 'vitest';
import * as native from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../local-session-view';
import { createInputCommitObservation } from './input-commit-observation';
import { createBuiltinRegistry } from './node-views/builtins';
import { registerMacroElementViews } from './node-views/macro';
import { selectionMessage } from './session-port';

const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
const evidence: unknown[] = [];
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (locksDescriptor)
    Object.defineProperty(navigator, 'locks', locksDescriptor);
  else Reflect.deleteProperty(navigator, 'locks');
  if (process.env.INPUT_COMMIT_PROOF)
    writeFileSync(
      process.env.INPUT_COMMIT_PROOF,
      JSON.stringify(
        evidence,
        (_, value) => (typeof value === 'bigint' ? value.toString() : value),
        2
      )
    );
});

for (const error of [undefined, null, { kind: 'post-commit consumer error' }]) {
  test(`real main commit remains observable before onCommit throws ${String(error)}`, async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const runtime = mountLocalSessionView(
      root,
      registerMacroElementViews(createBuiltinRegistry()),
      {
        namespace: 'main-commit-port',
        theme: {},
        editable: true,
        preset: 'rich',
        onError(error) {
          throw error;
        },
      },
      {
        viewEngine: 1,
        viewOs: 0,
        nativeCommands: native,
        create: (config, now, wall) =>
          native.EditorSession.createMacroWithNamespace(
            ABI_MAJOR,
            config,
            now,
            wall,
            'main-commit-port'
          ),
      }
    );
    let release: (() => void) | undefined;
    try {
      runtime.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [{ type: 'text', version: 1, text: 'commit' }],
              },
            ],
          },
        })
      );
      const paragraph = runtime.view.mirror.node(0)?.children[0];
      const text =
        paragraph === undefined
          ? undefined
          : runtime.view.mirror.node(paragraph)?.children[0];
      if (text === undefined) throw new Error('Missing actual imported text');
      const selected = await runtime.port.inputSettled(
        EditorInputMsg.fromEditorSelection({
          selection: selectionMessage({
            kind: 'range',
            anchor: { key: text, type: 'text', offset: 0 },
            focus: { key: text, type: 'text', offset: 6 },
          }),
          change: {},
        })
      );
      expect(selected.status).toBe('success');
      const observed = createInputCommitObservation();
      let duringConsume: unknown;
      release = runtime.view.onCommit(() => {
        duringConsume = observed.read();
        throw error;
      });
      const after: boolean[] = [];
      const options = {
        mainCommit: observed,
        after: (handled: boolean) => {
          after.push(handled);
        },
      };
      let caught: { error: unknown } | undefined;
      try {
        await runtime.port.inputSettled(() => {
          const generation = runtime.view.mirror.keyGeneration;
          if (generation === null) throw new Error('Missing actual generation');
          return {
            name: 'group-b.format-text',
            json: '"bold"',
            generation,
            selection: selectionMessage({ kind: 'keep' }),
          };
        }, options);
      } catch (error) {
        caught = { error };
      }
      const model = runtime.executor.session.serializedState();
      evidence.push({
        cause: String(error),
        caughtPresent: caught !== undefined,
        sameError: caught?.error === error,
        model,
        duringConsume,
        observed: observed.read(),
        after,
      });
      expect(caught).toBeDefined();
      expect(caught?.error).toBe(error);
      expect(model).toContain('"format":1');
      // This profile reports view callback errors at afterDrain; keep its
      // existing per-entry after behavior independent of receipt observation.
      expect(after).toEqual([true]);
      expect(duringConsume).toMatchObject({
        status: 'published',
        mainHandled: true,
      });
      expect(observed.read()).toBe(duringConsume);
    } finally {
      release?.();
      await runtime.close();
      root.remove();
    }
  });
}
