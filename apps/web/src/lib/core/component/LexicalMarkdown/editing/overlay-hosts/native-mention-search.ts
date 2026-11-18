import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { MenuOperations } from '../../shared/inlineMenu';
import { registerNativeInlineSearch } from './native-inline-search';

export function registerNativeMentionSearch(
  view: EditorView,
  menu: MenuOperations,
  onUnavailable?: (error: unknown) => void
): () => void {
  return registerNativeInlineSearch(view, menu, 'mentions', '@', onUnavailable);
}
