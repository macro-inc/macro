import {
  canLabel,
  type GraphicsDocument,
  type RichText,
} from '@macro-inc/graphics';
import type { SerializedEditorState } from 'lexical';

export {
  plainRichText,
  richTextPlainText,
  type TextAlign,
  validCanvasText,
} from '@macro-inc/lexical-core/canvas-text';

import { validCanvasText } from '@macro-inc/lexical-core/canvas-text';

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

/** Graphics validates geometry; this host validates its editor payloads on import. */
export function validCanvasTextDocument(document: GraphicsDocument): boolean {
  return Object.values(document.items).every((item) => {
    if (item.type === 'text') return validCanvasText(item.geometry.content);
    return (
      !canLabel(item) ||
      !item.geometry.label ||
      validCanvasText(item.geometry.label.content)
    );
  });
}
