/** @vitest-environment jsdom */

import { PasteNode } from '@macro-inc/lexical-core';
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
import type { PasteNodeUIProps } from '../component/decorator/PasteNode';
import { theme } from '../theme';
import { createNativePasteNodeContext } from './native-paste-node-host';
import { createNativePasteNodeViews } from './native-paste-node-views';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

/**
 * Mounts stored paste chips (blocks) above a sibling paragraph, hands the
 * result to `check`, and always closes the fixture.
 */
function withMounted(
  chips: readonly object[],
  check: (mounted: { root: HTMLElement; received: PasteNodeUIProps[] }) => void
) {
  const received: PasteNodeUIProps[] = [];
  setDecorator<PasteNodeUIProps>(PasteNode, (props) => {
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

const fields = ({ content, origin }: PasteNodeUIProps) => ({ content, origin });

test('stored paste content Source renders as null or missing text reaches the component unchanged', () => {
  withMounted(
    [
      { content: 'pasted text', origin: 'pasted' },
      { content: 'quoted text', origin: 'referenced' },
      { content: null, origin: 'pasted' },
      { origin: 'pasted' },
      { content: '', origin: 'pasted' },
      { content: 'unknown origin', origin: 'elsewhere' },
      { content: null, origin: null },
    ],
    ({ received }) => {
      expect(received.map(fields)).toEqual([
        { content: 'pasted text', origin: 'pasted' },
        { content: 'quoted text', origin: 'referenced' },
        { content: null, origin: 'pasted' },
        { content: undefined, origin: 'pasted' },
        { content: '', origin: 'pasted' },
        { content: 'unknown origin', origin: 'pasted' },
        { content: null, origin: 'pasted' },
      ]);
    }
  );
});

test('a null-content paste chip leaves the rest of the document rendering', () => {
  withMounted([{ content: null, origin: null }], ({ root }) => {
    expect(root.querySelectorAll('[data-recorded-paste="true"]')).toHaveLength(
      1
    );
    expect(root.textContent).toContain('sibling stays');
  });
});

test('a referenced chip without text is rejected, as Source StaticMarkdown reads it as a string', () => {
  for (const chip of [
    { content: null, origin: 'referenced' },
    { origin: 'referenced' },
  ]) {
    expect(() => withMounted([chip], () => {})).toThrow(
      'Invalid paste payload'
    );
  }
});

test('wrong value types are refused by the stored model before any projection', () => {
  expect(() =>
    withMounted([{ content: 5, origin: 'pasted' }], () => {})
  ).toThrow('JSON error: invalid type');
});
