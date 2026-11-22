import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { Accessor } from 'solid-js';
import type { NativeMarkdownOverlayInstallation } from '../nativeOverlayPorts';
import type { NativeFocusTarget } from './focus';

interface NativeFocusRuntime {
  readonly view: EditorView;
  readonly overlays?: Pick<NativeMarkdownOverlayInstallation, 'focusAtEnd'>;
}

/** Retain the document host's focused-range guard over its current runtime. */
export function createNativeFocusTarget(
  runtime: Accessor<NativeFocusRuntime | undefined>,
  editable: Accessor<boolean>
): NativeFocusTarget {
  return {
    editable,
    hasSelection() {
      const selection = runtime()?.view.selection().selection;
      return (
        selection?.kind === 'range' &&
        (selection.anchor.key !== selection.focus.key ||
          selection.anchor.offset !== selection.focus.offset)
      );
    },
    focusAtEnd() {
      const current = runtime();
      const focusAtEnd = current?.overlays?.focusAtEnd;
      if (!current || !focusAtEnd) return;
      if (
        current.view.root.contains(document.activeElement) &&
        current.view.selection().selection.kind === 'range'
      )
        return;
      focusAtEnd();
    },
  };
}
