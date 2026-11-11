import { describe, expect, it, vi } from 'vitest';
import { registerInlineMenuTrigger } from '../shared/registerInlineMenuTrigger';
import { behaviorEditor } from './editor';

describe('desktop and Android inline menu input', () => {
  for (const symbol of ['@', '/', ';', ':', '#']) {
    it(`${symbol}: triggers once for desktop keydown plus beforeinput`, () => {
      const trigger = vi.fn();
      const { root } = behaviorEditor((editor) =>
        registerInlineMenuTrigger(editor, symbol, trigger)
      );
      root.dispatchEvent(new KeyboardEvent('keydown', { key: symbol }));
      root.dispatchEvent(
        new InputEvent('beforeinput', { inputType: 'insertText', data: symbol })
      );
      expect(trigger).toHaveBeenCalledOnce();
    });

    it(`${symbol}: handles Android Unidentified keydown through beforeinput`, () => {
      const trigger = vi.fn();
      const { root } = behaviorEditor((editor) =>
        registerInlineMenuTrigger(editor, symbol, trigger)
      );
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified' }));
      root.dispatchEvent(
        new InputEvent('beforeinput', { inputType: 'insertText', data: symbol })
      );
      expect(trigger).toHaveBeenCalledOnce();
    });

    it.each([
      { inputType: 'insertCompositionText', data: symbol },
      { inputType: 'insertText', data: symbol, isComposing: true },
      { inputType: 'insertFromPaste', data: symbol },
      { inputType: 'insertText', data: 'ordinary' },
    ])(
      `${symbol}: leaves non-trigger/composition input $inputType alone (data=$data, composing=$isComposing)`,
      (input) => {
        const trigger = vi.fn();
        const { root } = behaviorEditor((editor) =>
          registerInlineMenuTrigger(editor, symbol, trigger)
        );
        root.dispatchEvent(new InputEvent('beforeinput', input));
        expect(trigger).not.toHaveBeenCalled();
      }
    );

    it(`${symbol}: detaches listeners from a retired root`, () => {
      const trigger = vi.fn();
      const { editor, root } = behaviorEditor((editor) =>
        registerInlineMenuTrigger(editor, symbol, trigger)
      );
      const next = document.createElement('div');
      editor.setRootElement(next);
      root.dispatchEvent(new KeyboardEvent('keydown', { key: symbol }));
      expect(trigger).not.toHaveBeenCalled();
      next.dispatchEvent(
        new InputEvent('beforeinput', { inputType: 'insertText', data: symbol })
      );
      expect(trigger).toHaveBeenCalledOnce();
    });
  }
});
