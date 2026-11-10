import type { PopoverSplitOptions } from '@components/app/split-layout/layoutManager';
import { AwaitNode, DocumentMentionNode } from '@macro-inc/lexical-core';
import { $createParagraphNode, $getRoot, $nodesOfType } from 'lexical';
import { afterEach, expect, test, vi } from 'vitest';
import { ACTIONS } from '../plugins/actions/actions';
import { awaitPlugin } from '../plugins/await/awaitPlugin';
import { mentionsPlugin } from '../plugins/mentions/mentionsPlugin';
import { behaviorEditor } from './editor';

const REQUEST = vi.hoisted(() =>
  vi.fn<(options: PopoverSplitOptions) => void>()
);
vi.mock('@app/signal/splitLayout', async (original) => ({
  ...(await original<typeof import('@app/signal/splitLayout')>()),
  globalSplitManager: () => ({ createPopoverSplit: REQUEST }),
}));
afterEach(() => REQUEST.mockClear());

test.each(['task', 'document'])(
  'slash %s preserves actual creation start, failure and completion policy',
  async (kind) => {
    const { editor } = behaviorEditor(awaitPlugin(), mentionsPlugin({}));
    editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), {
      discrete: true,
    });
    const action = ACTIONS.find((action) => action.id === kind);
    if (!action) throw new Error('Missing actual Source creation action');
    action.action(editor);
    expect(REQUEST).toHaveBeenCalledTimes(1);
    const request = REQUEST.mock.calls[0][0];
    expect(request.content.type).toBe('component');
    expect(request.content.id).toBe(
      kind === 'task' ? 'task-compose' : 'document-compose'
    );
    if (request.content.type !== 'component')
      throw new Error('Missing creation component');
    const start = request.content.params?.onCreateStart;
    const failure = request.content.params?.onCreateFailure;
    const success = request.content.params?.onSuccess;
    if (
      typeof start !== 'function' ||
      typeof failure !== 'function' ||
      typeof success !== 'function'
    )
      throw new Error('Missing actual creation callbacks');
    editor.read(() => expect($nodesOfType(AwaitNode)).toHaveLength(0));
    start({ title: 'Created item', content: '' });
    editor.read(() => expect($nodesOfType(AwaitNode)).toHaveLength(1));
    failure();
    editor.read(() => expect($nodesOfType(AwaitNode)).toHaveLength(0));

    start({ title: 'Created item', content: '' });
    await success({
      documentId: 'created-fixture',
      title: 'Created item',
      content: '',
    });
    editor.read(() => {
      expect($nodesOfType(AwaitNode)).toHaveLength(0);
      const mentions = $nodesOfType(DocumentMentionNode);
      expect(mentions).toHaveLength(1);
      expect(mentions[0].exportJSON()).toMatchObject({
        documentId: 'created-fixture',
        documentName: 'Created item',
        blockName: kind === 'task' ? 'task' : 'md',
      });
    });
  }
);
