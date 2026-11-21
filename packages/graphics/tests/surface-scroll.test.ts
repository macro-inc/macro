import { afterEach, expect, it } from 'vitest';
import { attachCameraControls } from '../src/browser';
import { createGraphicsEditor } from '../src/core';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function setup() {
  const editor = createGraphicsEditor();
  const surface = document.createElement('div');
  document.body.append(surface);
  const detach = attachCameraControls(surface, editor, {
    tool: () => 'select',
  });
  cleanups.push(() => {
    detach();
    editor.dispose();
    surface.remove();
  });
  return { editor, surface };
}

it('takes a scroll the browser gave the surface as a pan and undoes the scroll', () => {
  const { editor, surface } = setup();
  editor.panBy({ x: 40, y: 10 });

  // The browser reveals a caret that was typed past the right edge.
  surface.scrollLeft = 208;
  surface.scrollTop = 30;
  surface.dispatchEvent(new Event('scroll'));

  // What was 208px to the right is now where it scrolled to, by the camera.
  expect(editor.getCamera()).toMatchObject({ x: 40 - 208, y: 10 - 30 });
  expect([surface.scrollLeft, surface.scrollTop]).toEqual([0, 0]);
});

it('leaves the camera alone when the surface is not scrolled', () => {
  const { editor, surface } = setup();
  const camera = editor.getCamera();

  surface.dispatchEvent(new Event('scroll'));

  expect(editor.getCamera()).toEqual(camera);
});
