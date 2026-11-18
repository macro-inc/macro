/** @vitest-environment jsdom */
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { $isDocumentCardNode, DocumentCardNode } from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { $getRoot, createEditor } from 'lexical';
import { createRoot } from 'solid-js';
import { afterEach, beforeAll, expect, test } from 'vitest';
import type { DocumentCardProps } from '../component/decorator/DocumentCard';
import { createNativeDocumentCardContext } from './native-document-card-host';
import { createNativeDocumentCardViews } from './native-document-card-views';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

function card(blockParams: Record<string, string>) {
  return {
    type: 'document-card',
    version: 1,
    documentId: 'fixture-channel',
    documentName: 'Fixture Channel',
    blockName: 'channel',
    blockParams,
    previewBox: ['100%', '400px'],
  };
}

function stored(node: object) {
  return JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [{ type: 'paragraph', version: 1, children: [] }, node],
    },
  });
}

/** The card inputs Source hands DocumentCard for a stored card. */
function source(node: object) {
  const editor = createEditor({
    nodes: [DocumentCardNode],
    onError(error) {
      throw error;
    },
  });
  const state = editor.parseEditorState(stored(node));
  return state.read(() => {
    const found = $getRoot().getChildren().find($isDocumentCardNode);
    if (!found) throw new Error('Missing actual Source card');
    return found.exportComponentProps();
  });
}

/** The card inputs native hands DocumentCard for the same stored card. */
function native(node: object) {
  const received: DocumentCardProps[] = [];
  setDecorator<DocumentCardProps>(DocumentCardNode, (props) => {
    received.push(props);
    return null;
  });
  const fixture = nativeSurface();
  const context = createRoot((dispose) => ({
    ...createNativeDocumentCardContext({}, { isInteractable: () => true }),
    disposeOwner: dispose,
  }));
  registerMacroDecoratorViews(
    fixture.view.registry,
    createNativeDocumentCardViews(context)
  );
  try {
    context.bindView(fixture.view);
    fixture.port.setState(stored(node));
    const props = received.at(-1);
    if (!props) throw new Error('Missing projected native card');
    return {
      documentId: props.documentId,
      documentName: props.documentName,
      blockName: props.blockName,
      blockParams: props.blockParams,
      previewBox: props.previewBox,
      previewData: props.previewData,
      mentionUuid: props.mentionUuid,
    };
  } finally {
    context.dispose();
    context.disposeOwner();
    fixture.close();
  }
}

// DocumentCard mounts ChannelMessageThreadCard from documentId and the
// message or thread param; its onClickMessage navigates from those props alone.
test.each([
  { [CHANNEL_PARAMS.message]: 'fixture-message' },
  {
    [CHANNEL_PARAMS.message]: 'fixture-reply',
    [CHANNEL_PARAMS.thread]: 'fixture-thread',
  },
])('a channel message card reaches DocumentCard as in Source: %o', (params) => {
  const node = card(params);
  expect(native(node)).toStrictEqual(source(node));
});

// Control: the comparison tells a card for another message apart.
test('the comparison rejects a card for another message', () => {
  expect(
    native(card({ [CHANNEL_PARAMS.message]: 'fixture-message' }))
  ).not.toStrictEqual(source(card({ [CHANNEL_PARAMS.message]: 'other' })));
});
