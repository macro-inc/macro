import { toXml } from '@macro-inc/lexical-core/transformers/xml';
import type { LexicalSession } from './ai-toolkit';

/** Prefix each line with a 1-indexed `N | ` gutter -- the line addressing the agents read. */
export function numberLines(text: string): string {
  return text
    .split('\n')
    .map((line, i) => `${i + 1} | ${line}`)
    .join('\n');
}

export function serializeWithXml(session: LexicalSession): string {
  return toXml(session.editor.getEditorState().toJSON());
}
