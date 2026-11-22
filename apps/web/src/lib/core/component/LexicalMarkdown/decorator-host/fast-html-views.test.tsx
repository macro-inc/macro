/** @vitest-environment jsdom */

import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import { HtmlRenderNode } from '@macro-inc/lexical-core/nodes/HtmlRenderNode';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test } from 'vitest';
import type { HtmlRenderUIProps } from '../component/decorator/HtmlRender';
import { theme } from '../theme';
import { createNativeFastHTMLDecoratorViews } from './fast-html-views';
import { createNativeContactContext } from './native-contact-host';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

/**
 * Mounts stored HTML renders beside a sibling paragraph through the real
 * registry, with a recording component in place of HtmlRender: this guards
 * the projector and registry mount, not the component's own rendering.
 */
function mount(nodes: readonly object[]) {
  const received: HtmlRenderUIProps[] = [];
  setDecorator<HtmlRenderUIProps>(HtmlRenderNode, (props) => {
    received.push(props);
    return <span data-recorded-html="true" />;
  });
  const fixture = nativeSurface();
  const context = createNativeContactContext(theme);
  registerMacroDecoratorViews(
    fixture.view.registry,
    createNativeFastHTMLDecoratorViews(context)
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
            ...nodes.map((node) => ({
              type: 'html-render',
              version: 1,
              ...node,
            })),
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

test('projector hands a stored null or missing adaptColors to the registered component unchanged', () => {
  const mounted = mount([
    { html: '<b>adapt</b>', adaptColors: true },
    { html: '<b>keep</b>', adaptColors: false },
    { html: '<b>null</b>', adaptColors: null },
    { html: '<b>missing</b>' },
  ]);
  try {
    expect(
      mounted.received.map(({ html, adaptColors }) => ({ html, adaptColors }))
    ).toEqual([
      { html: '<b>adapt</b>', adaptColors: true },
      { html: '<b>keep</b>', adaptColors: false },
      { html: '<b>null</b>', adaptColors: null },
      { html: '<b>missing</b>', adaptColors: undefined },
    ]);
    expect(
      mounted.fixture.root.querySelectorAll('[data-recorded-html]')
    ).toHaveLength(4);
    expect(mounted.fixture.root.textContent).toContain('sibling stays');
  } finally {
    mounted.close();
  }
});

test('stored model refuses a wrong adaptColors type before any projection', () => {
  expect(() =>
    mount([{ html: '<b>text</b>', adaptColors: 'yes' }]).close()
  ).toThrow('JSON error: invalid type');
});
