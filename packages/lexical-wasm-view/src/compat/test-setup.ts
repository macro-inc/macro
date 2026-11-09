import type * as Lexical from 'lexical';
import { type CompatRuntime, installCompatRuntime } from './runtime';

let selected: CompatRuntime | undefined;
/** Called synchronously by the harness's real createEditor, after spec mocks load. */
export function installUpstreamRuntime(
  model: typeof Lexical,
  internals: Pick<
    CompatRuntime,
    | 'RangeSelection'
    | 'getActiveEditor'
    | 'getActiveEditorState'
    | 'isCurrentlyReadOnlyMode'
    | 'updateEditorSync'
    | '$getCompositionKey'
    | 'createEmptyEditorState'
  >
): void {
  if (selected) return;
  selected = {
    ...model,
    ...internals,
    withReconciliation(editor, state, body) {
      return state.read(body, { editor });
    },
  };
  installCompatRuntime(selected);
}
export function getUpstreamRuntime(): CompatRuntime {
  if (!selected)
    throw new Error(
      'The real upstream createEditor must run before requesting its runtime'
    );
  return selected;
}
