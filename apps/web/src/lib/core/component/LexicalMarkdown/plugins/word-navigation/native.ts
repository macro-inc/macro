import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { wordKeyCommand } from '@macro-inc/lexical-wasm-view/view/word-key-command';

/** Share command classification with root listener dispatch; Rust owns node policy. */
export function registerNativeWordNavigation(view: EditorView): () => void {
  return view.registerKeyRoute((event) => {
    const command = wordKeyCommand(event);
    if (!command) return null;
    return {
      name:
        command === 'Key(MoveToStart)'
          ? 'group-b.move-to-start'
          : 'group-b.move-to-end',
      json: 'null',
      preventDefault: false,
    };
  });
}
