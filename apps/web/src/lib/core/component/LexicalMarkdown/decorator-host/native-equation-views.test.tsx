/** @vitest-environment jsdom */

import {
  type EquationDecoratorProps,
  EquationNode,
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
import { createNativeEquationContext } from './native-equation-host';
import { createNativeEquationViews } from './native-equation-views';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

/** Mounts stored equations beside a sibling paragraph and records what the component received. */
function mount(equations: readonly object[]) {
  const received: EquationDecoratorProps[] = [];
  setDecorator<EquationDecoratorProps>(EquationNode, (props) => {
    received.push(props);
    return <span data-recorded-equation="true" />;
  });
  const fixture = nativeSurface();
  const context = createNativeEquationContext(theme);
  const close = () => {
    context.dispose();
    fixture.close();
  };
  try {
    registerMacroDecoratorViews(
      fixture.view.registry,
      createNativeEquationViews(context)
    );
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: equations.map((equation) => ({
                type: 'equation',
                version: 1,
                ...equation,
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
    close();
    throw error;
  }
  return { fixture, received, close };
}

test('the stored model applies Source import defaults to a missing equation and a null or missing inline flag', () => {
  const mounted = mount([
    { equation: 'x^2', inline: true },
    { inline: true },
    { equation: 'y', inline: null },
    { equation: 'z' },
  ]);
  try {
    expect(
      mounted.received.map(({ equation, inline }) => ({ equation, inline }))
    ).toEqual([
      { equation: 'x^2', inline: true },
      { equation: '', inline: true },
      { equation: 'y', inline: false },
      { equation: 'z', inline: false },
    ]);
    expect(
      mounted.fixture.root.querySelectorAll('[data-recorded-equation]')
    ).toHaveLength(4);
    expect(mounted.fixture.root.textContent).toContain('sibling stays');
  } finally {
    mounted.close();
  }
});

test('a stored null equation stays rejected, as Source hands it to KaTeX, which throws for a non-string', () => {
  expect(() => mount([{ equation: null, inline: false }]).close()).toThrow(
    'Invalid native equation props'
  );
});

test('wrong value types are refused by the stored model before any projection', () => {
  for (const equation of [
    { equation: 5, inline: false },
    { equation: 'x', inline: 'yes' },
  ]) {
    expect(() => mount([equation]).close()).toThrow('JSON error: invalid type');
  }
});
