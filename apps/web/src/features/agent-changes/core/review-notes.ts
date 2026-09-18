/**
 * Line-level review notes: what the reviewer wants the agent to change, tied
 * to a line of the current changeset, queued until sent as one prompt.
 *
 * Notes never go to GitHub. They are the reviewer's words for the agent, so
 * `formatNotesForAgent` turns them into the markdown the session composer
 * posts.
 */

/** Which side of the diff a line belongs to, in Pierre's vocabulary. */
export type DiffSide = 'additions' | 'deletions';

export type ReviewNote = {
  id: string;
  /** The file the note is on, by its current path. */
  path: string;
  side: DiffSide;
  /** First line of the annotated range, in that side's numbering. */
  lineNumber: number;
  /** Last line, equal to `lineNumber` for a single line. */
  endLineNumber: number;
  text: string;
  /** Set once the note has been posted to the agent. */
  sentAt?: string;
  createdAt: string;
};

/** Where a new note goes: the line the reviewer picked. */
export type NoteAnchor = {
  path: string;
  side: DiffSide;
  lineNumber: number;
  endLineNumber: number;
};

export function noteAnchorKey(anchor: NoteAnchor): string {
  return `${anchor.path}:${anchor.side}:${anchor.lineNumber}-${anchor.endLineNumber}`;
}

export function queuedNotes(notes: readonly ReviewNote[]): ReviewNote[] {
  return notes.filter((note) => note.sentAt === undefined);
}

/** Notes on one file, in line order, queued first. */
export function notesForFile(
  notes: readonly ReviewNote[],
  path: string
): ReviewNote[] {
  return notes
    .filter((note) => note.path === path)
    .sort((a, b) => a.lineNumber - b.lineNumber);
}

function describeLines(note: ReviewNote): string {
  const version = note.side === 'additions' ? 'new' : 'old';
  if (note.endLineNumber > note.lineNumber) {
    return `lines ${note.lineNumber}–${note.endLineNumber} (${version})`;
  }
  return `line ${note.lineNumber} (${version})`;
}

/**
 * The prompt that carries queued notes to the agent: one numbered item per
 * note, each naming the file and line, in file order so the agent walks the
 * diff the way the reviewer did.
 */
export function formatNotesForAgent(notes: readonly ReviewNote[]): string {
  const ordered = [...notes].sort(
    (a, b) => a.path.localeCompare(b.path) || a.lineNumber - b.lineNumber
  );
  if (ordered.length === 0) return '';
  if (ordered.length === 1) {
    const note = ordered[0]!;
    return `Review note on \`${note.path}\`, ${describeLines(note)}:\n\n${note.text.trim()}`;
  }
  const items = ordered.map(
    (note, index) =>
      `${index + 1}. \`${note.path}\`, ${describeLines(note)}: ${note.text.trim()}`
  );
  return `Please address these ${ordered.length} review notes on the current changes:\n\n${items.join('\n')}`;
}
