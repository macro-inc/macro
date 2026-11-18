/// <reference types="node" />
import { writeFileSync } from 'node:fs';
import { AwaitNode } from '@macro-inc/lexical-core/nodes/AwaitNode';
import { CommentNode } from '@macro-inc/lexical-core/nodes/CommentNode';
import { InlineSearchNode } from '@macro-inc/lexical-core/nodes/InlineSearchNode';
import {
  $getLocal,
  $getPeerId,
  INITIALIZE_LOCAL_STATUS,
  peerIdPlugin,
} from '@macro-inc/lexical-core/plugins/peerIdPlugin';
import {
  $getRoot,
  COMMAND_PRIORITY_CRITICAL,
  createEditor,
  type Klass,
  type LexicalNode,
} from 'lexical';
import { afterAll, expect, test } from 'vitest';
import { theme } from '../theme';

const classes: Klass<LexicalNode>[] = [
  InlineSearchNode,
  CommentNode,
  AwaitNode,
];
const observations: unknown[] = [];

afterAll(() => {
  const output = process.env.PEER_SOURCE_TRACE;
  if (output)
    writeFileSync(output, `${JSON.stringify(observations, null, 2)}\n`);
});

for (const family of ['await']) {
  for (const local of [undefined, true, false]) {
    for (const owner of [undefined, '', '7', '8']) {
      for (const current of [undefined, '7', '8']) {
        test(`${family}: local=${local}, owner=${owner}, current=${current}`, () => {
          const root = document.createElement('div');
          root.contentEditable = 'true';
          document.body.append(root);
          const editor = createEditor({
            namespace: 'peer-source-control',
            nodes: classes,
            theme,
            onError(error) {
              throw error;
            },
          });
          const trace: unknown[] = [];
          let peer = current;
          const capture = (phase: string) => {
            editor.getEditorState().read(() => {
              const node = $getRoot().getFirstDescendant();
              trace.push({
                phase,
                currentPeer: peer,
                rootState: $getRoot().exportJSON().$,
                node: node && {
                  type: node.getType(),
                  peer: $getPeerId(node),
                  local: $getLocal(node),
                  state: node.exportJSON().$,
                  dom: editor.getElementByKey(node.getKey())?.outerHTML,
                },
                json: editor.getEditorState().toJSON(),
              });
            });
          };
          const cleanups: (() => void)[] = [];
          try {
            editor.setRootElement(root);
            for (const nodeClass of classes) {
              cleanups.push(
                editor.registerMutationListener(
                  nodeClass,
                  (mutations) => {
                    capture(
                      `before-listener:${[...mutations.values()].join(',')}`
                    );
                  },
                  { skipInitialization: true }
                )
              );
            }
            cleanups.push(
              editor.registerCommand(
                INITIALIZE_LOCAL_STATUS,
                () => {
                  capture('before-initialize-command');
                  return false;
                },
                COMMAND_PRIORITY_CRITICAL
              )
            );
            // This is the actual production plugin and its exact configured classes.
            cleanups.push(
              peerIdPlugin({ peerId: () => peer, nodes: classes })(editor)
            );
            for (const nodeClass of classes) {
              cleanups.push(
                editor.registerMutationListener(
                  nodeClass,
                  (mutations) => {
                    capture(
                      `after-listener:${[...mutations.values()].join(',')}`
                    );
                  },
                  { skipInitialization: true }
                )
              );
            }

            const state = {
              id: 'node0001',
              ...(owner === undefined ? {} : { peerId: owner }),
              ...(local === undefined ? {} : { local }),
            };
            const text = {
              type: 'text',
              version: 1,
              text: 'marked',
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
            };
            const node =
              family === 'await'
                ? {
                    type: family,
                    version: 1,
                    awaitId: 'source-await',
                    inline: true,
                    $: state,
                  }
                : family === 'comment-mark'
                  ? {
                      type: family,
                      version: 1,
                      ids: ['mark-one'],
                      threadId: 1,
                      isDraft: false,
                      children: [text],
                      direction: null,
                      format: '',
                      indent: 0,
                      $: state,
                    }
                  : { ...text, type: family, text: '@a', $: state };
            const input = {
              root: {
                type: 'root',
                version: 1,
                direction: null,
                format: '',
                indent: 0,
                $: { id: 'root0001' },
                children: [
                  {
                    type: 'paragraph',
                    version: 1,
                    direction: null,
                    format: '',
                    indent: 0,
                    textFormat: 0,
                    textStyle: '',
                    $: { id: 'para0001' },
                    children: [node],
                  },
                ],
              },
            };
            const parsed = editor.parseEditorState(JSON.stringify(input));
            trace.push({ phase: 'parsed-before-mount', json: parsed.toJSON() });
            editor.setEditorState(parsed);
            editor.read(() => {});
            capture('published');
            const expectedLocal = owner ? owner === current : null;
            editor.getEditorState().read(() => {
              const actual = $getRoot().getFirstDescendant();
              if (!actual) throw new Error('Missing actual Await');
              expect($getPeerId($getRoot())).toBeNull();
              expect($getLocal(actual)).toBe(expectedLocal);
              expect(
                editor
                  .getElementByKey(actual.getKey())
                  ?.classList.contains('local')
              ).toBe(expectedLocal !== false);
            });
            editor.dispatchCommand(INITIALIZE_LOCAL_STATUS, () => peer);
            editor.read(() => {});
            capture('after-initialize');
            editor.getEditorState().read(() => {
              const actual = $getRoot().getFirstDescendant();
              if (!actual) throw new Error('Missing actual Await after INIT');
              expect($getLocal(actual)).toBe(expectedLocal);
            });
            editor.update(
              () => {
                $getRoot().getFirstDescendant()?.markDirty();
              },
              { discrete: true }
            );
            capture('after-dirty');
            peer = current === '7' ? '8' : '7';
            editor.update(
              () => {
                $getRoot().getFirstDescendant()?.markDirty();
              },
              { discrete: true }
            );
            capture('after-peer-change-dirty');
            expect(
              editor
                .getEditorState()
                .read(() => $getRoot().getFirstDescendant()?.getType())
            ).toBe(family);
            observations.push({ family, local, owner, current, input, trace });
          } finally {
            for (const cleanup of cleanups.reverse()) cleanup();
            editor.setRootElement(null);
            root.remove();
          }
        });
      }
    }
  }
}
