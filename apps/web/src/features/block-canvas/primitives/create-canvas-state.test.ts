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
