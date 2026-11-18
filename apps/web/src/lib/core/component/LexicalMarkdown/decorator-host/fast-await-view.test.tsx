/** @vitest-environment jsdom */

import {
  AccountManagerRequestNode,
  AgentContextNode,
  AwaitNode,
  CursorSystemNotificationNode,
  ReplyTargetNode,
  WatermarkNode,
} from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test } from 'vitest';
import type { AwaitUIProps } from '../component/decorator/Await';
import { theme } from '../theme';
import { createNativeFastStaticDecoratorViews } from './fast-static-views';
import { createNativeContactContext } from './native-contact-host';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

/**
 * Mounts stored await nodes beside a sibling paragraph through the real
 * registry, with a recording component in place of Await: this guards the
 * projector and registry mount, not the component's own rendering.
 */
function mount(awaits: readonly object[]) {
  const received: AwaitUIProps[] = [];
  // The static views bind all six rows; the others are not mounted here.
  for (const klass of [
    ReplyTargetNode,
    AccountManagerRequestNode,
    CursorSystemNotificationNode,
    WatermarkNode,
    AgentContextNode,
  ])
    setDecorator(klass, () => null);
  setDecorator<AwaitUIProps>(AwaitNode, (props) => {
    received.push(props);
    return <span data-recorded-await="true" />;
  });
  const fixture = nativeSurface();
  const context = createNativeContactContext(theme);
  registerMacroDecoratorViews(
    fixture.view.registry,
    createNativeFastStaticDecoratorViews(context)
  );
  const close = () => {
    context.dispose();
    fixture.close();
  };
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: awaits.map((node) => ({
                type: 'await',
                version: 1,
                ...node,
              })),
            },
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'sibling stays' }],
            },
          ],
        },
      })
    );
  } catch (error) {
    // An expected refusal must not leak the constructed session and root.
    close();
    throw error;
  }
  return { fixture, received, close };
}

test('projector hands a stored null or missing await text to the registered component unchanged', () => {
  const mounted = mount([
    { awaitId: 'valid', text: 'Creating task', inline: true },
    { awaitId: 'null-text', text: null, inline: true },
    { awaitId: 'missing-text', inline: true },
    { awaitId: 'empty-text', text: '', inline: true },
  ]);
  try {
    expect(
      mounted.received.map(({ awaitId, text, inline }) => ({
        awaitId,
        text,
        inline,
      }))
    ).toEqual([
      { awaitId: 'valid', text: 'Creating task', inline: true },
      { awaitId: 'null-text', text: null, inline: true },
      { awaitId: 'missing-text', text: undefined, inline: true },
      { awaitId: 'empty-text', text: '', inline: true },
    ]);
    expect(
      mounted.fixture.root.querySelectorAll('[data-recorded-await]')
    ).toHaveLength(4);
    expect(mounted.fixture.root.textContent).toContain('sibling stays');
  } finally {
    mounted.close();
  }
});

test('stored model refuses a wrong text type before any projection', () => {
  expect(() =>
    mount([{ awaitId: 'number-text', text: 5, inline: true }]).close()
  ).toThrow('JSON error: invalid type');
});
