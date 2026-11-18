/** @vitest-environment jsdom */
import { DiffOpcode } from '@macro-inc/collaboration/session/abi.generated';
import { beforeAll, expect, test } from 'vitest';
import { NO_KEY } from './mirror';
import { registerMacroDecoratorViews } from './node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test('selected State replaces Await local and clearing restores the Source fallback', () => {
  const fixture = nativeSurface();
  try {
    registerMacroDecoratorViews(fixture.view.registry, {
      await: () => document.createTextNode('waiting'),
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
                  type: 'await',
                  version: 1,
                  awaitId: 'selected-await',
                  inline: true,
                },
              ],
            },
          ],
        },
      })
    );
    const node = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'await'
    );
    if (!node) throw new Error('Missing actual Await');
    const generation = fixture.view.mirror.keyGeneration;
    if (generation === null) throw new Error('Missing actual generation');
    const element = fixture.view.getElementByKey(node.key);
    if (!element) throw new Error('Missing mounted Await');
    // Consumer-only control: these literal State packets exercise the real
    // applier/renderer; the existing artifact does not produce selected state.
    for (const state of [
      '{"local":false}',
      '{"local":true}',
      '{"local":false}',
      '',
    ]) {
      const strings = new TextEncoder().encode(state);
      fixture.view.apply(
        new Uint32Array([
          1,
          generation,
          0,
          NO_KEY,
          1,
          DiffOpcode.State,
          node.key,
          0,
          strings.length,
        ]),
        strings
      );
      expect(fixture.view.mirror.node(node.key)?.stateJSON).toBe(state);
      expect(fixture.view.getElementByKey(node.key)).toBe(element);
      expect(element.classList.contains('local')).toBe(
        state !== '{"local":false}'
      );
      expect(element.classList.contains('__decorator-mount-ref')).toBe(true);
    }
  } finally {
    fixture.close();
  }
});
