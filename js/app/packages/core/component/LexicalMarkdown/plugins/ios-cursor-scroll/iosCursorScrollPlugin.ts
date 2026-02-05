/**
 * @file A plugin to ensure the cursor is visible above the iOS virtual keyboard.
 * When the keyboard appears, this scrolls the cursor into view if it would be
 * obscured by the keyboard.
 */
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import type { Accessor } from 'solid-js';
import type { LexicalEditor } from 'lexical';
import { createEffect, createRoot, on } from 'solid-js';
import { $getCaretRect } from '../../utils';

const CURSOR_PADDING = 50; // ~2 lines above keyboard

interface IosCursorScrollPluginOptions {
  scrollContainer: Accessor<HTMLElement | undefined>;
}

export function iosCursorScrollPlugin(options: IosCursorScrollPluginOptions) {
  return (editor: LexicalEditor) => {
    if (!isNativeMobilePlatform()) return () => {};

    let disposeRoot!: () => void;

    createRoot((dispose) => {
      disposeRoot = dispose;

      createEffect(
        on(virtualKeyboardVisible, (visible) => {
          if (!visible) return;

          const scrollEl = options.scrollContainer();
          if (!scrollEl) return;

          setTimeout(() => {
            editor.read(() => {
              const caretRect = $getCaretRect();
              if (!caretRect) return;

              const scrollRect = scrollEl.getBoundingClientRect();

              const safeZoneBottom = scrollRect.bottom - CURSOR_PADDING;

              if (caretRect.bottom > safeZoneBottom) {
                const scrollAmount = caretRect.bottom - safeZoneBottom;
                // For some reason, setting this to 'instant' makes it scroll to the wrong location???
                scrollEl.scrollBy({ top: scrollAmount, behavior: 'smooth' });
              }
            });
          }, 0);
        })
      );
    });

    return () => {
      disposeRoot();
    };
  };
}
