import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { $getRoot } from 'lexical';
import type { LexicalSession } from '../ai-toolkit/session';
import type { AppliedChange } from './doc';

/** What an edit did to the document's top-level blocks. */
export type BlockChangeReport = {
  /** Ids of the top-level blocks applied ops touched or created, in document order. */
  changedBlockIds: string[];
  /** A short factual account, e.g. "Edited 2 blocks, inserted 1 heading." */
  summary: string;
};

const BLOCK_NOUNS: Record<string, string> = {
  paragraph: 'paragraph',
  heading: 'heading',
  quote: 'quote',
  code: 'code block',
  'custom-code': 'code block',
  list: 'list',
  'task-list': 'checklist',
  table: 'table',
  horizontalrule: 'divider',
  image: 'image',
  video: 'video',
  equation: 'equation',
  'database-query': 'database question',
  'document-card': 'card',
  'html-render': 'HTML block',
};

/** Retyping a block mints `b3~v1` for `b3`; both name the same logical block. */
function stem(id: string): string {
  return /^(.*)~v\d+$/.exec(id)?.[1] ?? id;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Collects the top-level blocks every applied op touched, across writers. */
export class BlockChanges {
  private readonly touched = new Set<string>();
  /** Touched blocks that existed before the edit first touched them. */
  private readonly existing = new Set<string>();

  record(change: AppliedChange): void {
    for (const id of change.before) {
      if (!this.touched.has(id)) this.existing.add(id);
      this.touched.add(id);
    }
    for (const id of change.after) this.touched.add(id);
  }

  report(session: LexicalSession): BlockChangeReport {
    const present = session.editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .flatMap((node) => {
          const id = $getId(node);
          return id ? [{ id, type: node.getType() }] : [];
        })
    );
    const changed = present.filter(({ id }) => this.touched.has(id));
    const presentStems = new Set(present.map(({ id }) => stem(id)));

    let edited = 0;
    const inserted = new Map<string, number>();
    for (const { id, type } of changed) {
      if (this.existing.has(id) || this.existing.has(stem(id))) edited++;
      else {
        const noun = BLOCK_NOUNS[type] ?? 'block';
        inserted.set(noun, (inserted.get(noun) ?? 0) + 1);
      }
    }
    const removed = [...this.existing].filter(
      (id) => !presentStems.has(stem(id))
    ).length;

    const parts: string[] = [];
    if (edited) parts.push(`edited ${count(edited, 'block')}`);
    if (inserted.size)
      parts.push(
        `inserted ${[...inserted].map(([noun, n]) => count(n, noun)).join(', ')}`
      );
    if (removed) parts.push(`removed ${count(removed, 'block')}`);
    const sentence = parts.join(', ');
    return {
      changedBlockIds: changed.map(({ id }) => id),
      summary: sentence
        ? `${sentence[0]!.toUpperCase()}${sentence.slice(1)}.`
        : 'No changes.',
    };
  }
}
