/** @vitest-environment jsdom */

import {
  PasteNode,
  type PasteNodeDecoratorProps,
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
import { theme } from '../theme';
import { createNativePasteNodeContext } from './native-paste-node-host';
import { createNativePasteNodeViews } from './native-paste-node-views';
import type { PasteNodeHostProp } from './paste-node-host';

type PasteProps = PasteNodeDecoratorProps & PasteNodeHostProp;

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

/**
 * Mounts stored paste chips (blocks) above a sibling paragraph, hands the
 * result to `check`, and always closes the fixture.
 */
function withMounted(
  chips: readonly object[],
  check: (mounted: { root: HTMLElement; received: PasteProps[] }) => void
) {
  const received: PasteProps[] = [];
  setDecorator<PasteProps>(PasteNode, (props) => {
    received.push(props);
    return <span data-recorded-paste="true" />;
  });
  const fixture = nativeSurface();
  const context = createNativePasteNodeContext(theme);
  try {
    registerMacroDecoratorViews(
      fixture.view.registry,
      createNativePasteNodeViews(context)
    );
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            ...chips.map((chip) => ({ type: 'paste', version: 1, ...chip })),
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'sibling stays' }],
            },
          ],
        },
      })
    );
    check({ root: fixture.root, received });
  } finally {
    context.dispose();
    fixture.close();
  }
}

test('stored text content reaches the component beside a rendering sibling', () => {
  withMounted([{ content: 'kept', origin: 'pasted' }], ({ root, received }) => {
    expect(
      received.map(({ content, origin }) => ({ content, origin }))
    ).toEqual([{ content: 'kept', origin: 'pasted' }]);
    expect(root.textContent).toContain('sibling stays');
  });
});

// Source throws in getTextContentSize for these, so the whole state fails there too.
test('null or missing content is refused like Source', () => {
  for (const content of [null, undefined]) {
    for (const origin of ['pasted', 'referenced']) {
      expect(() => withMounted([{ content, origin }], () => {})).toThrow(
        'Invalid paste payload'
      );
    }
  }
});
