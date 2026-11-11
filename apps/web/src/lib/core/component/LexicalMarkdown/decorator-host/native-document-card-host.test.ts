/** @vitest-environment jsdom */
import { Access } from '@macro-inc/collaboration/session/abi.generated';
import { decodeOutput, Flag } from '@macro-inc/collaboration/session/output';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { createRoot } from 'solid-js';
import { beforeAll, expect, test } from 'vitest';
import { createNativeDocumentCardContext } from './native-document-card-host';

beforeAll(initializeNativeSurfaceTests);

function mountedCard() {
  const fixture = nativeSurface();
  let notifications = 0;
  const context = createRoot((dispose) => ({
    ...createNativeDocumentCardContext(
      {},
      {
        isInteractable: () => true,
        // This test observes the real optional capability invocation boundary.
        layoutChanged: () => notifications++,
      }
    ),
    disposeOwner: dispose,
  }));
  registerMacroDecoratorViews(fixture.view.registry, {
    'document-card': () => document.createTextNode('Card'),
  });
  fixture.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          { type: 'paragraph', version: 1, children: [] },
          {
            type: 'document-card',
            version: 1,
            documentId: 'fixture-document',
            documentName: 'Fixture Document',
            blockName: 'md',
            blockParams: {},
            previewBox: ['100%', '400px'],
          },
        ],
      },
    })
  );
  context.bindView(fixture.view);
  const card = [...fixture.view.mirror.values()].find(
    (node) => node.type === 'document-card'
  );
  const paragraph = [...fixture.view.mirror.values()].find(
    (node) => node.type === 'paragraph'
  );
  if (!card || !paragraph)
    throw new Error('Missing actual native card fixture');
  return {
    ...fixture,
    context,
    card: String(card.key),
    paragraph: String(paragraph.key),
    notifications: () => notifications,
    authorize(write: boolean, comment: boolean) {
      const flags = fixture.session.authorization(true, write, comment, 3, 3);
      if (flags & (Flag.View | Flag.Io | Flag.NeedPeerIds | Flag.Error)) {
        const output = decodeOutput(fixture.session.takeOutput());
        expect(output.effects).toEqual([]);
        fixture.view.apply(output.view, output.strings, output.viewEffects);
      }
      expect(flags & Flag.NeedPeerIds).toBe(0);
    },
    close() {
      try {
        context.dispose();
      } finally {
        try {
          context.disposeOwner();
        } finally {
          fixture.close();
        }
      }
    },
  };
}

for (const access of [Access.Read, Access.CommentOnly]) {
  test(`refused preview height under access ${access} does not notify layout`, () => {
    const fixture = mountedCard();
    try {
      fixture.authorize(false, access === Access.CommentOnly);
      expect(fixture.session.effectiveAccess()).toBe(access);
      const before = fixture.view.query.serializedState();
      fixture.context.host.setPreviewHeight(fixture.card, '450px');
      expect(fixture.view.query.serializedState()).toBe(before);
      expect(fixture.notifications()).toBe(0);
    } finally {
      fixture.close();
    }
  });
}

test('a wrong-type card action does not notify layout', () => {
  const fixture = mountedCard();
  try {
    const before = fixture.view.query.serializedState();
    fixture.context.host.setPreviewHeight(fixture.paragraph, '450px');
    expect(fixture.view.query.serializedState()).toBe(before);
    expect(fixture.notifications()).toBe(0);
  } finally {
    fixture.close();
  }
});

test('admitted equal-height card updates still notify and disposed contexts do not', () => {
  const fixture = mountedCard();
  try {
    fixture.context.host.setPreviewHeight(fixture.card, '450px');
    expect(fixture.notifications()).toBe(1);
    const changed = fixture.view.query.serializedState();
    expect(JSON.parse(changed).root.children[1].previewBox).toEqual([
      '100%',
      '450px',
    ]);
    fixture.context.host.setPreviewHeight(fixture.card, '450px');
    expect(fixture.view.query.serializedState()).toBe(changed);
    expect(fixture.notifications()).toBe(2);
    fixture.context.dispose();
    fixture.context.host.setPreviewHeight(fixture.card, '500px');
    expect(fixture.view.query.serializedState()).toBe(changed);
    expect(fixture.notifications()).toBe(2);
  } finally {
    fixture.close();
  }
});
