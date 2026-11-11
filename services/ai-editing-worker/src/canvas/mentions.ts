import {
  plainRichText,
  richTextPlainText,
  validCanvasText,
} from '@macro-inc/lexical-core/canvas-text';
import type {
  SerializedUserMentionNode,
  UserMentionInfo,
} from '@macro-inc/lexical-core/nodes/UserMentionNode';
import { canvasUserMentionSchema } from './schema';

export type CanvasUserMention = Pick<
  UserMentionInfo,
  'userId' | 'email' | 'displayName'
>;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Offsets match ReadCanvas.text: UTF-16, newlines and one U+FFFC per chip. */
export function canvasUserMentions(content: string) {
  const mentions: (CanvasUserMention & { at: number })[] = [];
  let incomplete = false,
    characters = 0;
  let at = 0;
  const visit = (node: unknown) => {
    if (!record(node)) return;
    if (node.type === 'user-mention') {
      const person = canvasUserMentionSchema.safeParse({
        userId: node.userId,
        email: node.email,
        ...(node.displayName !== undefined
          ? { displayName: node.displayName }
          : {}),
      });
      if (!person.success) incomplete = true;
      else {
        const entry = { ...person.data, at };
        const length = JSON.stringify(entry).length;
        if (mentions.length >= 100 || characters + length > 4000)
          incomplete = true;
        else {
          mentions.push(entry);
          characters += length;
        }
      }
    }
    if (Array.isArray(node.children)) {
      const separated = node.type === 'root' || node.type === 'list';
      node.children.forEach((child, index) => {
        if (separated && index) at++;
        visit(child);
      });
    } else at += typeof node.text === 'string' ? node.text.length : 1;
  };
  const state: unknown = JSON.parse(content);
  if (record(state)) visit(state.root);
  return { mentions, incomplete };
}

/** Insert the shared UserMentionNode wire shape without flattening rich text. */
export function insertCanvasUserMention(
  content: string,
  at: number,
  person: CanvasUserMention
): string {
  if (!validCanvasText(content))
    throw new Error('Cannot mention a person in unsupported Canvas text.');
  if (!Number.isInteger(at) || at < 0 || at > richTextPlainText(content).length)
    throw new Error(
      'Mention offset must be within ReadCanvas.text. Chips count as one character.'
    );
  const state: unknown = JSON.parse(content);
  if (!record(state) || !record(state.root))
    throw new Error('Invalid Canvas text root.');
  if (Array.isArray(state.root.children) && !state.root.children.length) {
    const empty: unknown = JSON.parse(plainRichText());
    if (record(empty) && record(empty.root))
      state.root.children = empty.root.children;
  }
  const mention: SerializedUserMentionNode = {
    type: 'user-mention',
    version: 1,
    ...person,
  };
  let position = 0;
  const insert = (node: Record<string, unknown>): boolean => {
    if (!Array.isArray(node.children)) return false;
    if (!node.children.length && position === at) {
      node.children.push(mention);
      return true;
    }
    const separated = node.type === 'root' || node.type === 'list';
    for (let index = 0; index < node.children.length; index++) {
      if (separated && index) position++;
      const child: unknown = node.children[index];
      if (!record(child)) throw new Error('Invalid Canvas text child.');
      if (Array.isArray(child.children)) {
        if (insert(child)) return true;
        continue;
      }
      const length = typeof child.text === 'string' ? child.text.length : 1;
      if (at >= position && at <= position + length) {
        const offset = at - position;
        if (typeof child.text === 'string') {
          if (
            offset > 0 &&
            offset < length &&
            /[\uD800-\uDBFF]/.test(child.text[offset - 1]) &&
            /[\uDC00-\uDFFF]/.test(child.text[offset])
          )
            throw new Error('Mention offset splits a Unicode character.');
          node.children.splice(
            index,
            1,
            ...(offset
              ? [{ ...child, text: child.text.slice(0, offset) }]
              : []),
            mention,
            ...(offset < length
              ? [{ ...child, text: child.text.slice(offset) }]
              : [])
          );
        } else node.children.splice(index + offset, 0, mention);
        return true;
      }
      position += length;
    }
    return false;
  };
  if (!insert(state.root))
    throw new Error('Mention offset is not an inline text position.');
  const result = JSON.stringify(state);
  if (!validCanvasText(result))
    throw new Error('Mention exceeds Canvas text limits.');
  return result;
}
