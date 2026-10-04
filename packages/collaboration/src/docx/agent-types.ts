import type { RunFormat } from './paragraph';

/** One change an agent asks for. Ids are the engine's paragraph and block ids. */
export type DocxAgentOperation =
  | {
      type: 'replaceText';
      paragraph: string;
      find: string;
      replace: string;
      occurrence?: number;
    }
  | { type: 'setText'; paragraph: string; text: string }
  | ({
      type: 'formatText';
      paragraph: string;
      find?: string;
      occurrence?: number;
    } & RunFormat)
  | {
      type: 'insertParagraph';
      after?: string;
      before?: string;
      text: string;
      style?: string;
    }
  | { type: 'delete'; id: string }
  | { type: 'setStyle'; paragraph: string; style: string };

export type DocxAgentRequest =
  | { action: 'read'; start?: number; count?: number }
  | { action: 'edit'; operations: DocxAgentOperation[] };

export type DocxAgentResult = { content: string };

/** A request the document cannot satisfy; the message is for the agent. */
export class DocxAgentError extends Error {}

/** Most operations one edit may apply. */
export const MAX_DOCX_OPERATIONS = 50;
/** Characters a read returns before it asks to be continued. */
export const READ_BUDGET = 60_000;

export const preview = (text: string, limit = 200) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;

/** Where `find` occurs in `text`. */
export function occurrences(text: string, find: string): number[] {
  const found: number[] = [];
  if (!find) return found;
  let index = text.indexOf(find);
  while (index >= 0) {
    found.push(index);
    index = text.indexOf(find, index + find.length);
  }
  return found;
}
