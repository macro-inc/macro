/** @vitest-environment jsdom */
import { Access } from '@macro-inc/collaboration/session/abi.generated';
import { decodeOutput, Flag } from '@macro-inc/collaboration/session/output';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { beforeAll, expect, test } from 'vitest';
import { createNativeDocumentMentionContext } from './native-document-mention-host';

beforeAll(initializeNativeSurfaceTests);

function mountedMention() {
  const fixture = nativeSurface();
  const context = createNativeDocumentMentionContext(
    {},
    {
      isInteractable: () => true,
      skipPreviewFetch: true,
    }
  );
  registerMacroDecoratorViews(fixture.view.registry, {
    'document-mention': () => document.createTextNode('Mention'),
  });
  fixture.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [
              {
                type: 'document-mention',
                version: 1,
                documentId: 'fixture-document',
                documentName: 'Fixture Document',
                blockName: 'md',
                mentionUuid: 'fixture-mention',
              },
            ],
          },
        ],
      },
    })
  );
  context.bindView(fixture.view);
  const mention = [...fixture.view.mirror.values()].find(
    (node) => node.type === 'document-mention'
  );
  if (!mention) throw new Error('Missing actual native document mention');
  return {
    ...fixture,
    context,
    mention: String(mention.key),
    authorize(write: boolean, comment: boolean) {
      const flags = fixture.session.authorization(true, write, comment, 3, 3);
      if (flags & (Flag.View | Flag.Io | Flag.NeedPeerIds | Flag.Error)) {
        const output = decodeOutput(fixture.session.takeOutput());
        fixture.view.apply(output.view, output.strings, output.viewEffects);
      }
    },
    close() {
      try {
        context.dispose();
      } finally {
        fixture.close();
      }
    },
  };
}

for (const access of [Access.Read, Access.CommentOnly]) {
  test(`collapsing a mention preview under access ${access} keeps the editor and writes nothing`, () => {
    const fixture = mountedMention();
    try {
      fixture.authorize(false, access === Access.CommentOnly);
      expect(fixture.session.effectiveAccess()).toBe(access);
      const before = fixture.view.query.serializedState();
      // The surface fixture's onError throws, as RustMarkdownEditor tears down.
      fixture.context.host.setCollapsed(fixture.mention, true);
      expect(fixture.view.query.serializedState()).toBe(before);
    } finally {
      fixture.close();
    }
  });
}

test('an editor collapsing a mention preview writes it', () => {
  const fixture = mountedMention();
  try {
    const before = fixture.view.query.serializedState();
    fixture.context.host.setCollapsed(fixture.mention, true);
    expect(fixture.view.query.serializedState()).not.toBe(before);
    expect(fixture.view.query.serializedState()).toContain('"collapsed":true');
  } finally {
    fixture.close();
  }
});
