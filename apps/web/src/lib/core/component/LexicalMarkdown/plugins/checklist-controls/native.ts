import type { EditorView, JsonValue } from '@macro-inc/lexical-wasm-view';
import { dispatchApplicationCommand } from '../group-b/command';

/** Persist the complete settings object, retaining unknown fields across clients. */
export function setNativeTaskListSettings(
  view: EditorView,
  key: number,
  settings: JsonValue
) {
  return dispatchApplicationCommand(view, 'group-b.checklist', {
    action: 'settings',
    key,
    settings,
  });
}
