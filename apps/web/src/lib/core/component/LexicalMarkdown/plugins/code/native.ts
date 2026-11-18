import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { dispatchApplicationCommand } from '../group-b/command';

export function insertNativeCode(
  view: EditorView,
  language: string,
  code: string
) {
  return dispatchApplicationCommand(view, 'group-b.code', {
    action: 'insert',
    language,
    code,
  });
}
export function setNativeCodeLanguage(
  view: EditorView,
  key: number,
  language: string
) {
  return dispatchApplicationCommand(view, 'group-b.code', {
    action: 'language',
    key,
    language,
  });
}
export function setNativeCodePreview(
  view: EditorView,
  key: number,
  enabled: boolean
) {
  return dispatchApplicationCommand(view, 'group-b.code', {
    action: 'preview',
    key,
    enabled,
  });
}
export function deleteNativeCode(view: EditorView, key: number) {
  return dispatchApplicationCommand(view, 'group-b.code', {
    action: 'delete',
    key,
  });
}
