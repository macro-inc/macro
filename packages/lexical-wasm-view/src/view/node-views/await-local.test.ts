/** @vitest-environment jsdom */
import { beforeAll, expect, test } from 'vitest';
import { Mirror, NO_KEY } from '../mirror';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../test/native-surface';
import { registerMacroDecoratorViews } from './macro';

beforeAll(initializeNativeSurfaceTests);

test('Await DOM follows Source local-state parsing and retains its mounted wrapper on state-only updates', () => {
  const fixture = nativeSurface();
  try {
    registerMacroDecoratorViews(fixture.view.registry, {
      await: () => document.createTextNode('waiting'),
    });
    // Explicit flat-Diff inputs exercise the renderer, independently of native state admission.
    const mirror = new Mirror([
      { index: 0, name: 'root', kind: 'element' },
      { index: 1, name: 'await', kind: 'decorator' },
    ]);
    const properties = new TextEncoder().encode(
      '{"awaitId":"literal-await","inline":true}'
    );
    mirror.initialize(
      new Uint32Array([
        1,
        7,
        1,
        NO_KEY,
        2,
        4,
        1,
        1,
        0,
        properties.length,
        6,
        0,
        1,
        1,
      ]),
      properties
    );
    const initial = mirror.node(1);
    if (!initial) throw new Error('Missing Await Diff record');
    const renderer = fixture.view.registry.get('await');
    const element = renderer.createDOM(initial, fixture.view.context);
    const host = renderer.createDecoratorHost?.(element, fixture.view.context);
    if (!host) throw new Error('Missing Source mount wrapper');
    element.appendChild(host);
    expect(element.className).toBe(
      'macro-await-node local __decorator-mount-ref'
    );

    for (const [state, expected] of [
      ['{"local":false}', false],
      ['{"local":true}', true],
      ['{"local":null}', true],
      ['{"local":0}', true],
      ['{"local":"false"}', true],
      ['{"local":[]}', true],
      ['{"local":{}}', true],
      ['{}', true],
      ['', true],
    ] as const) {
      const previous = mirror.node(1);
      if (!previous) throw new Error('Missing previous Await');
      const encoded = new TextEncoder().encode(state);
      const diff = mirror.apply(
        new Uint32Array([1, 7, 0, NO_KEY, 1, 11, 1, 0, encoded.length]),
        encoded
      );
      const next = mirror.node(1);
      if (!next) throw new Error('Missing current Await');
      expect(diff.properties.has(1)).toBe(true);
      expect(
        renderer.updateDOM(previous, next, element, fixture.view.context)
      ).toBe(false);
      expect(element.classList.contains('local')).toBe(expected);
      expect(element.classList.contains('macro-await-node')).toBe(true);
      expect(element.classList.contains('__decorator-mount-ref')).toBe(true);
      expect(element.firstElementChild).toBe(host);
    }
  } finally {
    fixture.close();
  }
});
