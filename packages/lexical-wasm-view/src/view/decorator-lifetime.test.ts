/** @vitest-environment jsdom */
import { EditorInputMsg } from '@macro-inc/collaboration/session/abi.generated';
import { createEffect, onCleanup } from 'solid-js';
import { beforeAll, expect, test } from 'vitest';
import { registerMacroDecoratorViews } from './node-views/macro';
import { selectionMessage } from './session-port';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test('real native media revisions preserve false-setter captures and remount equal true setters', () => {
  const fixture = nativeSurface();
  let mounts = 0;
  let unmounts = 0;
  registerMacroDecoratorViews(fixture.view.registry, {
    image(props) {
      mounts++;
      const element = document.createElement('span');
      createEffect(() => {
        element.textContent = String(props.node().props().url);
      });
      onCleanup(() => unmounts++);
      return element;
    },
  });
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'image',
              version: 1,
              srcType: 'url',
              id: 'fixture-image',
              url: 'https://example.com/first',
              alt: '',
              width: 320,
              height: 160,
              scale: 1,
            },
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'target' }],
            },
          ],
        },
      })
    );
    const image = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'image'
    );
    const target = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'text' && node.text === 'target'
    );
    const generation = fixture.view.mirror.keyGeneration;
    if (!image || !target || generation === null)
      throw new Error('Missing actual native media fixture');
    const element = fixture.view.getElementByKey(image.key);
    const firstHost = element?.firstElementChild;
    if (!element || !firstHost) throw new Error('Missing mounted component');
    expect(image.decoratorRevision).toBe(0n);
    expect(element.textContent).toBe('https://example.com/first');
    expect(mounts).toBe(1);

    fixture.port.input(
      EditorInputMsg.fromEditorApplication({
        name: 'group-b.media-set-property',
        json: JSON.stringify({
          key: image.key,
          kind: 'image',
          property: 'url',
          value: 'https://example.com/second',
          rerender: false,
        }),
        generation,
        selection: selectionMessage({ kind: 'keep' }),
        keyboard: false,
        key: '',
        mods: 0,
        code: 0,
      })
    );
    expect(fixture.view.node(image.key)?.props().url).toBe(
      'https://example.com/second'
    );
    expect(fixture.view.node(image.key)?.decoratorRevision).toBe(0n);
    expect(element.firstElementChild).toBe(firstHost);
    expect(element.textContent).toBe('https://example.com/first');
    expect(mounts).toBe(1);
    const beforeTrueSetter = fixture.session.serializedState();

    fixture.port.input(
      EditorInputMsg.fromEditorApplication({
        name: 'group-b.media-set-property',
        json: JSON.stringify({
          key: image.key,
          kind: 'image',
          property: 'url',
          value: 'https://example.com/second',
        }),
        generation,
        selection: selectionMessage({ kind: 'keep' }),
        keyboard: false,
        key: '',
        mods: 0,
        code: 0,
      })
    );
    expect(fixture.session.serializedState()).toBe(beforeTrueSetter);
    expect(fixture.view.node(image.key)?.decoratorRevision).toBe(1n);
    expect(element.firstElementChild).not.toBe(firstHost);
    expect(element.textContent).toBe('https://example.com/second');
    expect(mounts).toBe(2);
    expect(unmounts).toBe(1);
    const secondHost = element.firstElementChild;

    fixture.port.input(
      EditorInputMsg.fromEditorApplication({
        name: 'group-b.move',
        json: JSON.stringify({
          action: 'move',
          source: image.key,
          target: target.key,
          before: true,
        }),
        generation,
        selection: selectionMessage({ kind: 'keep' }),
        keyboard: false,
        key: '',
        mods: 0,
        code: 0,
      })
    );
    expect(fixture.view.node(image.key)?.parent).toBe(target.parent);
    expect(element.parentElement).toBe(
      target.parent === null
        ? null
        : fixture.view.getElementByKey(target.parent)
    );
    expect(fixture.view.node(image.key)?.decoratorRevision).toBe(1n);
    expect(element.firstElementChild).toBe(secondHost);
    expect(mounts).toBe(2);
    expect(unmounts).toBe(1);
  } finally {
    fixture.close();
  }
  expect(unmounts).toBe(2);
});
