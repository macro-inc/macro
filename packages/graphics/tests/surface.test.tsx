import { createRoot, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import { attachCameraControls } from '../src/browser';
import { createGraphicsEditor, screenToWorld } from '../src/core';
import { drawableIds, worldBounds } from '../src/core/scene';
import { createGraphicsProjection, GraphicsSurface } from '../src/solid';

it('updates the camera without remounting rectangle components', () => {
  const editor = createGraphicsEditor([
    {
      id: 'one',
      type: 'rectangle',
      geometry: { x: 10, y: 20, width: 30, height: 40 },
      appearance: { fill: 'transparent', stroke: 'currentColor' },
    },
  ]);
  const host = document.createElement('div');
  const mount = vi.fn();
  const unmount = vi.fn();
  const dispose = render(
    () => (
      <GraphicsSurface
        editor={editor}
        renderers={{
          rectangle: () => {
            mount();
            onCleanup(unmount);
            return <span>Rectangle</span>;
          },
        }}
      />
    ),
    host
  );
  const rectangle = host.querySelector('[data-graphics-item]');
  editor.panBy({ x: 50, y: 70 });
  editor.zoomAt({ x: 100, y: 100 }, 2);
  expect(host.querySelector('[data-graphics-item]')).toBe(rectangle);
  expect(mount).toHaveBeenCalledTimes(1);
  expect(rectangle?.parentElement?.style.transform).toContain('scale(2)');
  dispose();
  expect(unmount).toHaveBeenCalledTimes(1);
  editor.dispose();
});

it('unsubscribes the Solid projection when its owner is disposed', () => {
  const editor = createGraphicsEditor();
  const owned = createRoot((dispose) => ({
    ...createGraphicsProjection(editor),
    dispose,
  }));
  editor.panBy({ x: 10, y: 0 });
  expect(owned.camera().x).toBe(10);
  owned.dispose();
  editor.panBy({ x: 10, y: 0 });
  expect(owned.camera().x).toBe(10);
});

it('projects committed annotations and clears them while retaining the image', () => {
  const editor = createGraphicsEditor();
  editor.setImageSurface({ id: 'image', width: 640, height: 480 });
  const host = document.createElement('div');
  const dispose = render(
    () => (
      <GraphicsSurface
        editor={editor}
        image={{ src: 'blob:test', alt: 'Test image' }}
      />
    ),
    host
  );
  const image = host.querySelector('img');
  editor.beginRectangle({ x: 20, y: 30 });
  editor.updateRectangle({ x: 100, y: 90 });
  expect(host.querySelector('[data-graphics-preview]')).not.toBeNull();
  editor.commitRectangle('one', { fill: 'transparent', stroke: 'red' });
  expect(host.querySelector('[data-graphics-preview]')).toBeNull();
  expect(host.querySelectorAll('[data-graphics-item]')).toHaveLength(1);
  editor.clearRectangles();
  expect(host.querySelectorAll('[data-graphics-item]')).toHaveLength(0);
  expect(host.querySelector('img')).toBe(image);
  dispose();
});

it('creates on pointer release and cancels drawing on Escape without leaking previews', () => {
  const editor = createGraphicsEditor();
  editor.setImageSurface({ id: 'image', width: 800, height: 600 });
  editor.zoomAt({ x: 0, y: 0 }, 2);
  const viewport = document.createElement('div');
  let captured = false;
  viewport.setPointerCapture = () => {
    captured = true;
  };
  viewport.hasPointerCapture = () => captured;
  viewport.releasePointerCapture = () => {
    captured = false;
  };
  const detach = attachCameraControls(viewport, editor, {
    tool: () => 'rectangle',
    createId: () => 'rectangle',
  });
  function pointer(type: string, x: number, y: number) {
    const event = new MouseEvent(type, {
      button: 0,
      clientX: x,
      clientY: y,
      cancelable: true,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    viewport.dispatchEvent(event);
  }
  pointer('pointerdown', 100, 100);
  pointer('pointermove', 200, 180);
  expect(drawableIds(editor.document)).toHaveLength(0);
  pointer('pointerup', 240, 200);
  expect(worldBounds(editor.document, 'rectangle')).toEqual({
    x: 50,
    y: 50,
    width: 70,
    height: 50,
  });
  pointer('pointerdown', 100, 100);
  pointer('pointermove', 200, 180);
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  pointer('pointerup', 240, 200);
  expect(drawableIds(editor.document)).toHaveLength(1);
  expect(editor.getPreview()).toBeUndefined();
  detach();
});

it('normalizes wheel units, anchors zoom and removes handlers on cleanup', () => {
  const editor = createGraphicsEditor();
  const viewport = document.createElement('div');
  const detach = attachCameraControls(viewport, editor);
  viewport.dispatchEvent(
    new WheelEvent('wheel', { deltaY: 2, deltaMode: 1, cancelable: true })
  );
  expect(editor.getCamera().y).toBe(-32);
  const anchor = { x: 150, y: 90 };
  const before = screenToWorld(editor.getCamera(), anchor);
  viewport.dispatchEvent(
    new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: -25,
      clientX: anchor.x,
      clientY: anchor.y,
      cancelable: true,
    })
  );
  const after = screenToWorld(editor.getCamera(), anchor);
  expect(after.x).toBeCloseTo(before.x);
  expect(after.y).toBeCloseTo(before.y);
  detach();
  const camera = editor.getCamera();
  viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
  expect(editor.getCamera()).toBe(camera);
});

it('captures a middle-button pan and stops it on cancellation', () => {
  const editor = createGraphicsEditor();
  const viewport = document.createElement('div');
  let captured = false;
  viewport.setPointerCapture = () => {
    captured = true;
  };
  viewport.hasPointerCapture = () => captured;
  viewport.releasePointerCapture = () => {
    captured = false;
  };
  const detach = attachCameraControls(viewport, editor);
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, {
      button: 1,
      clientX: x,
      clientY: y,
      cancelable: true,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    viewport.dispatchEvent(event);
  };
  pointer('pointerdown', 10, 20);
  expect(captured).toBe(true);
  pointer('pointermove', 60, 80);
  expect(editor.getCamera()).toEqual({ x: 50, y: 60, scale: 1 });
  pointer('pointercancel', 60, 80);
  pointer('pointermove', 120, 160);
  expect(editor.getCamera().x).toBe(50);
  expect(captured).toBe(false);
  detach();
});

it('scopes Space-drag to the viewport and cancels on window blur', () => {
  const editor = createGraphicsEditor();
  const viewport = document.createElement('div');
  viewport.tabIndex = 0;
  document.body.append(viewport);
  let captured = false;
  viewport.setPointerCapture = () => {
    captured = true;
  };
  viewport.hasPointerCapture = () => captured;
  viewport.releasePointerCapture = () => {
    captured = false;
  };
  const input = document.createElement('input');
  viewport.append(input);
  const detach = attachCameraControls(viewport, editor);
  const pointer = (type: string, x: number) => {
    const event = new MouseEvent(type, {
      button: 0,
      clientX: x,
      bubbles: true,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    viewport.dispatchEvent(event);
  };
  input.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'Space', bubbles: true })
  );
  pointer('pointerdown', 10);
  expect(captured).toBe(false);
  viewport.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'Space', cancelable: true })
  );
  pointer('pointerdown', 10);
  pointer('pointermove', 30);
  expect(editor.getCamera().x).toBe(20);
  window.dispatchEvent(new Event('blur'));
  pointer('pointermove', 60);
  expect(editor.getCamera().x).toBe(20);
  expect(captured).toBe(false);
  detach();
  viewport.remove();
});

it('keeps image navigation centered and disables pan gestures', () => {
  const editor = createGraphicsEditor();
  editor.setImageSurface({ id: 'image', width: 400, height: 200 });
  const viewport = document.createElement('div');
  Object.defineProperties(viewport, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  });
  editor.centerImage({ width: 800, height: 600 });
  const detach = attachCameraControls(viewport, editor, {
    navigation: 'centered-image',
  });
  viewport.setPointerCapture = vi.fn();
  for (const button of [0, 1]) {
    viewport.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    viewport.dispatchEvent(new MouseEvent('pointerdown', { button }));
    viewport.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 }));
  }
  expect(viewport.setPointerCapture).not.toHaveBeenCalled();
  expect(editor.getCamera()).toEqual({ x: 200, y: 200, scale: 1 });
  viewport.dispatchEvent(
    new WheelEvent('wheel', {
      deltaY: -25,
      clientX: 10,
      clientY: 20,
      cancelable: true,
    })
  );
  const camera = editor.getCamera();
  expect(camera.scale).toBeGreaterThan(1);
  expect(camera.x + 200 * camera.scale).toBeCloseTo(400);
  expect(camera.y + 100 * camera.scale).toBeCloseTo(300);
  editor.centerImage({ width: 500, height: 400 });
  expect(editor.getCamera().scale).toBe(camera.scale);
  expect(editor.getCamera().x + 200 * camera.scale).toBeCloseTo(250);
  expect(editor.getCamera().y + 100 * camera.scale).toBeCloseTo(200);
  detach();
});

it('renders transforms and history without remounting existing rectangle nodes', () => {
  const editor = createGraphicsEditor([
    {
      id: 'one',
      type: 'rectangle',
      geometry: { x: 10, y: 20, width: 100, height: 80 },
      appearance: { fill: 'white', stroke: 'black' },
    },
  ]);
  const host = document.createElement('div');
  const dispose = render(
    () => (
      <GraphicsSurface
        editor={editor}
        input={{ tool: () => 'select', editing: true }}
      />
    ),
    host
  );
  const node = host.querySelector<HTMLElement>('[data-graphics-item="one"]');
  editor.beginTransform('one', { x: 10, y: 20 });
  editor.updateTransform({ x: 40, y: 50 });
  expect(node?.style.transform).toBe('matrix(1,0,0,1,40,50)');
  expect(worldBounds(editor.document, 'one').x).toBe(10);
  editor.cancelTransform();
  expect(node?.style.transform).toBe('matrix(1,0,0,1,10,20)');
  editor.beginTransform('one', { x: 10, y: 20 });
  editor.updateTransform({ x: 40, y: 50 });
  editor.commitTransform();
  editor.undo();
  expect(node?.style.transform).toBe('matrix(1,0,0,1,10,20)');
  editor.redo();
  expect(node?.style.transform).toBe('matrix(1,0,0,1,40,50)');
  expect(host.querySelector('[data-graphics-item="one"]')).toBe(node);
  editor.deleteSelection();
  expect(host.querySelector('[data-graphics-item="one"]')).toBeNull();
  editor.undo();
  expect(host.querySelector('[data-graphics-item="one"]')).not.toBeNull();
  dispose();
});

it('keeps rectangle components mounted when grouping and reparenting changes their ancestry', () => {
  const editor = createGraphicsEditor([
    {
      id: 'a',
      type: 'rectangle',
      geometry: { x: 10, y: 20, width: 30, height: 40 },
      appearance: { fill: 'red', stroke: 'black' },
    },
    {
      id: 'b',
      type: 'rectangle',
      geometry: { x: 60, y: 20, width: 30, height: 40 },
      appearance: { fill: 'blue', stroke: 'black' },
    },
  ]);
  const host = document.createElement('div');
  const dispose = render(() => <GraphicsSurface editor={editor} />, host);
  const node = host.querySelector<HTMLElement>('[data-graphics-item="a"]');
  const transform = node?.style.transform;
  editor.select('a');
  editor.toggleSelection('b');
  editor.groupSelection('g');
  expect(host.querySelector('[data-graphics-item="a"]')).toBe(node);
  expect(node?.style.transform).toBe(transform);
  editor.reparent('a', editor.document.rootId, 5);
  expect(host.querySelector('[data-graphics-item="a"]')).toBe(node);
  expect(node?.style.transform).toBe(transform);
  editor.undo();
  expect(host.querySelector('[data-graphics-item="a"]')).toBe(node);
  dispose();
});

it('draws collective bounds and hides the rotation handle until rotation ends', () => {
  const editor = createGraphicsEditor([
    {
      id: 'a',
      type: 'rectangle',
      geometry: { x: 10, y: 20, width: 30, height: 40 },
      appearance: { fill: 'red', stroke: 'black' },
    },
    {
      id: 'b',
      type: 'rectangle',
      geometry: { x: 80, y: 40, width: 20, height: 30 },
      appearance: { fill: 'blue', stroke: 'black' },
    },
  ]);
  editor.zoomAt({ x: 0, y: 0 }, 2);
  const host = document.createElement('div');
  const dispose = render(
    () => <GraphicsSurface editor={editor} input={{ tool: () => 'select' }} />,
    host
  );
  editor.select('a');
  editor.toggleSelection('b');
  const bounds = () => host.querySelector('[data-graphics-selection-bounds]');
  const handle = () => host.querySelector('[data-graphics-handle="rotate"]');
  expect(bounds()?.getAttribute('x')).toBe('20');
  expect(bounds()?.getAttribute('y')).toBe('40');
  expect(bounds()?.getAttribute('width')).toBe('180');
  expect(bounds()?.getAttribute('height')).toBe('100');
  expect(handle()).not.toBeNull();
  editor.beginTransform('a', { x: 55, y: -5 }, 'rotate');
  expect(handle()).toBeNull();
  editor.updateTransform({ x: 105, y: 45 });
  expect(bounds()).toBeNull();
  expect(host.querySelector('[data-graphics-handle]')).toBeNull();
  editor.cancelTransform();
  expect(handle()).not.toBeNull();
  expect(bounds()?.getAttribute('width')).toBe('180');
  editor.beginTransform('a', { x: 55, y: -5 }, 'rotate');
  editor.updateTransform({ x: 105, y: 45 });
  editor.commitTransform();
  expect(handle()).not.toBeNull();
  editor.select();
  expect(bounds()).toBeNull();
  dispose();
});

it('shows multi-selection scale handles only while idle, including after move and scale cancellation', () => {
  const editor = createGraphicsEditor([
    {
      id: 'a',
      type: 'rectangle',
      geometry: { x: 10, y: 20, width: 30, height: 40 },
      appearance: { fill: 'red', stroke: 'black' },
    },
    {
      id: 'b',
      type: 'rectangle',
      geometry: { x: 80, y: 40, width: 20, height: 30 },
      appearance: { fill: 'blue', stroke: 'black' },
    },
  ]);
  const host = document.createElement('div');
  const dispose = render(
    () => <GraphicsSurface editor={editor} input={{ tool: () => 'select' }} />,
    host
  );
  editor.select('a');
  editor.toggleSelection('b');
  expect(host.querySelectorAll('[data-graphics-handle]')).toHaveLength(5);
  expect(
    host
      .querySelector('[data-graphics-selection-bounds]')
      ?.getAttribute('stroke-dasharray')
  ).toBe('3 3');
  for (const handle of [undefined, 'se'] as const) {
    editor.beginTransform('a', { x: 100, y: 70 }, handle);
    editor.updateTransform({ x: 130, y: 100 });
    expect(host.querySelector('[data-graphics-selection-bounds]')).toBeNull();
    expect(host.querySelectorAll('[data-graphics-handle]')).toHaveLength(0);
    editor.cancelTransform();
    expect(host.querySelectorAll('[data-graphics-handle]')).toHaveLength(5);
  }
  dispose();
});
