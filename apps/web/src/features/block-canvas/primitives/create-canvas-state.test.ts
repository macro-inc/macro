import {
  type Appearance,
  createGraphicsEditor,
  IDENTITY,
} from '@macro-inc/graphics';
import { createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import { initialAppearance } from '../core/seed-scene';
import { createCanvasState } from './create-canvas-state';

it.each(['arrow', 'pencil', 'line', 'connector'] as const)(
  '%s restores visible drawing defaults without changing the selected shape',
  (tool) => {
    createRoot((dispose) => {
      const editor = createGraphicsEditor([
        {
          id: 'rect',
          type: 'rectangle',
          placement: { parentId: 'scene-root', sortKey: 'a0' },
          transform: IDENTITY,
          geometry: { width: 160, height: 100 },
          appearance: { fill: 'red', stroke: 'black' },
        },
      ]);
      try {
        const state = createCanvasState(editor, (geometry) => ({
          width: geometry.width,
          height: geometry.height,
        }));
        editor.select('rect');
        for (const stroke of [
          'transparent',
          'none',
          '#1230',
          '#12345600',
          'rgba(1, 2, 3, 0)',
        ]) {
          state.chooseTool('select');
          state.style({ stroke, strokeWidth: 0, opacity: 0 });
          const before = editor.document;
          state.chooseTool(tool);
          expect(state.defaults()).toMatchObject({
            stroke: initialAppearance.stroke,
            strokeWidth: initialAppearance.strokeWidth,
            opacity: initialAppearance.opacity,
          });
          expect(editor.document).toBe(before);
        }
      } finally {
        dispose();
        editor.dispose();
      }
    });
  }
);

it('preserves visible stroke choices and lets filled shapes keep no-stroke defaults', () => {
  createRoot((dispose) => {
    const editor = createGraphicsEditor([]);
    try {
      const state = createCanvasState(editor, (geometry) => ({
        width: geometry.width,
        height: geometry.height,
      }));
      const visible: Partial<Appearance> = {
        stroke: '#12345680',
        strokeWidth: 8,
        opacity: 0.4,
        strokeStyle: 'dashed',
      };
      state.style(visible);
      for (const tool of ['arrow', 'pencil', 'line', 'connector'] as const) {
        state.chooseTool(tool);
        expect(state.defaults()).toMatchObject(visible);
      }
      state.style({ stroke: 'transparent' });
      state.chooseTool('rectangle');
      expect(state.defaults().stroke).toBe('transparent');
      state.chooseTool('pencil');
      expect(state.defaults()).toMatchObject({
        ...visible,
        stroke: initialAppearance.stroke,
      });
      expect(editor.getSession().canUndo).toBe(false);
    } finally {
      dispose();
      editor.dispose();
    }
  });
});

it('shows a canvas radius drag in the inspector before committing and restores it on cancel', () => {
  createRoot((dispose) => {
    const editor = createGraphicsEditor([
      {
        id: 'rect',
        type: 'rectangle',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: IDENTITY,
        geometry: { width: 160, height: 100 },
        appearance: { fill: 'red', stroke: 'black', cornerRadius: 8 },
      },
    ]);
    try {
      const state = createCanvasState(editor, (geometry) => ({
        width: geometry.width,
        height: geometry.height,
      }));
      editor.select('rect');
      editor.beginTransform('rect', { x: 16, y: 16 }, 'radius-nw');
      editor.updateTransform({ x: 40, y: 40 });
      expect(state.appearanceValue('cornerRadius')).toBe(32);
      expect(editor.document.items.rect).toMatchObject({
        appearance: { cornerRadius: 8 },
      });
      editor.cancelTransform();
      expect(state.appearanceValue('cornerRadius')).toBe(8);
      expect(editor.getSession().canUndo).toBe(false);
    } finally {
      dispose();
      editor.dispose();
    }
  });
});

it('hands a drawing tool back to Select once it has drawn, unless the tool is locked', () => {
  createRoot((dispose) => {
    const editor = createGraphicsEditor([
      {
        id: 'first',
        type: 'rectangle',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: [1, 0, 0, 1, 0, 0],
        geometry: { width: 40, height: 40 },
        appearance: initialAppearance,
      },
    ]);
    try {
      const state = createCanvasState(editor, (geometry) => ({
        width: geometry.width,
        height: 20,
      }));

      state.chooseTool('rectangle');
      state.shapeCreated('first');
      expect(state.tool()).toBe('select');
      expect(editor.getSession().selectedIds).toEqual(['first']);

      // Locked, the tool stays for the next shape and nothing is selected,
      // not even what was selected before.
      state.setToolLocked(true);
      state.chooseTool('rectangle');
      state.shapeCreated('first');
      expect(state.tool()).toBe('rectangle');
      expect(editor.getSession().selectedIds).toEqual([]);

      // The same goes for tools that report they are done, lines and text,
      // which select what they commit.
      state.chooseTool('arrow');
      editor.select('first');
      state.toolDone();
      expect(state.tool()).toBe('arrow');
      expect(editor.getSession().selectedIds).toEqual([]);
      state.setToolLocked(false);
      state.toolDone();
      expect(state.tool()).toBe('select');

      // The lock keeps a drawing tool. Under Select there is none to keep, so
      // what finishes there (a connector's end dragged, a text edited) stays
      // selected.
      state.setToolLocked(true);
      editor.select('first');
      expect(state.keepsTool()).toBe(false);
      state.toolDone();
      expect(state.tool()).toBe('select');
      expect(editor.getSession().selectedIds).toEqual(['first']);
    } finally {
      dispose();
      editor.dispose();
    }
  });
});

it('gives drawing to the pen at its first press, and leaves the choice alone after', () => {
  createRoot((dispose) => {
    const editor = createGraphicsEditor([]);
    try {
      const state = createCanvasState(editor, (geometry) => ({
        width: geometry.width,
        height: 20,
      }));

      // No pen yet: fingers draw, and there is nothing to choose.
      state.chooseTool('pencil');
      expect(state.penSeen()).toBe(false);
      expect(state.fingersPan()).toBe(false);

      state.penPressed();
      expect(state.penSeen()).toBe(true);
      expect(state.fingersPan()).toBe(true);
      // Fingers keep the tools that do not draw.
      for (const tool of ['select', 'pan', 'text'] as const) {
        state.chooseTool(tool);
        expect(state.fingersPan()).toBe(false);
      }
      for (const tool of [
        'rectangle',
        'arrow',
        'connector',
        'eraser',
      ] as const) {
        state.chooseTool(tool);
        expect(state.fingersPan()).toBe(true);
      }

      // Switched off, it stays off through the pen's later presses.
      state.setPenOnly(false);
      state.penPressed();
      expect(state.penOnly()).toBe(false);
      expect(state.fingersPan()).toBe(false);
      expect(state.penSeen()).toBe(true);
    } finally {
      dispose();
      editor.dispose();
    }
  });
});
