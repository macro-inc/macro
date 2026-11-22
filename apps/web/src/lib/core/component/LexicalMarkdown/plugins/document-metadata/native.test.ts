import 'fake-indexeddb/auto';
import {
  CommandCode,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  initializeInputCommitFixture,
  mountInputCommitFixture,
} from '@macro-inc/lexical-wasm-view/view/input-commit-test-fixture';
import { selectionMessage } from '@macro-inc/lexical-wasm-view/view/session-port';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { MARKDOWN_VERSION_COUNTER } from '../../version';
import { registerNativeDocumentMetadata } from './native';

let restore: (() => void) | undefined;
beforeAll(() => {
  restore = initializeInputCommitFixture();
});
afterAll(() => restore?.());

test('matches Source plugin error-state triggers and retires its listener', async () => {
  const runtime = mountInputCommitFixture();
  const error = vi.fn();
  const release = registerNativeDocumentMetadata(runtime.view, error);
  const load = (version: number) =>
    runtime.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              $: { id: 'para0001' },
              children: [
                {
                  type: 'text',
                  version: 1,
                  text: 'Before',
                  $: { id: 'leaf0001' },
                },
              ],
            },
          ],
          $: {
            id: 'root0001',
            documentMetadata: { version, environmentTags: null },
          },
        },
      })
    );
  try {
    load(MARKDOWN_VERSION_COUNTER);
    expect(error).not.toHaveBeenCalled();
    load(MARKDOWN_VERSION_COUNTER + 1);
    expect(error).not.toHaveBeenCalled();
    const paragraph = runtime.view.mirror.node(0)?.children[0];
    if (paragraph === undefined) throw new Error('Missing paragraph');
    const text = runtime.view.mirror.node(paragraph)?.children[0];
    if (text === undefined) throw new Error('Missing text');
    runtime.port.input(
      EditorInputMsg.fromEditorSelection({
        selection: selectionMessage({
          kind: 'range',
          anchor: { key: text, type: 'text', offset: 6 },
          focus: { key: text, type: 'text', offset: 6 },
        }),
        change: {},
      })
    );
    runtime.port.command(CommandCode.InsertText, 0, 0, '!');
    expect(error).toHaveBeenCalledWith('VERSION_MISMATCH_ERROR');
    error.mockClear();
    runtime.port.command(CommandCode.InsertParagraph);
    expect(error).toHaveBeenCalledWith('VERSION_MISMATCH_ERROR');
    error.mockClear();
    release();
    runtime.port.command(CommandCode.InsertText, 0, 0, '!');
    load(MARKDOWN_VERSION_COUNTER + 2);
    expect(error).not.toHaveBeenCalled();
  } finally {
    release();
    await runtime.close();
    runtime.root.remove();
  }
});
