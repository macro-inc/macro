import type { RichText } from '@macro-inc/graphics';
import type { SerializedEditorState } from 'lexical';

/** A pending picker query is ordinary text outside the active editor. */
export function serializeCanvasTextState(
  state: SerializedEditorState
): RichText {
  return JSON.stringify(state, (_key, value: unknown) =>
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'inline-search'
      ? { ...value, type: 'text' }
      : value
  );
}
