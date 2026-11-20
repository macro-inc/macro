/**
 * References to code that agents write in their replies: a file path with an
 * optional line or range, as a markdown link target (`src/a.ts#L12-L20`) or as
 * inline code (`src/a.ts:12`). Pure functions: parsing a reference, finding the
 * changed file it names, and turning inline code that names one into a link.
 */

import type { ChangedFile, Changeset } from './changeset';

export type CodeReference = {
  /** The path as written, without its line suffix or `file://` prefix. */
  path: string;
  /** First and last line, both 1-based; equal for a single line. */
  lines?: { start: number; end: number };
};

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// `path#L12`, `path#L12-L20`, `path#L12C3-L20C1`, `path:12`, `path:12-20`,
// `path:12:5`. The path is lazy so the suffix, when there is one, is not
// swallowed into it.
const LINE_SUFFIX =
  /^(?<path>.+?)(?:#L(?<hashStart>\d+)(?:C\d+)?(?:-L?(?<hashEnd>\d+)(?:C\d+)?)?|:(?<colonStart>\d+)(?::\d+)?(?:-(?<colonEnd>\d+)(?::\d+)?)?)?$/;

// A last segment that reads as a file name: `pane.tsx`, `.gitignore`.
const FILE_NAME = /^[\w.-]*\.[\w-]+$/;

/** The code reference `target` writes, or undefined when it is not one. */
export function parseCodeReference(target: string): CodeReference | undefined {
  let text = target.trim();
  if (text.startsWith('file://')) {
    text = text.slice('file://'.length);
  } else if (SCHEME.test(text)) {
    return undefined;
  }
  if (text === '' || text.startsWith('//') || /\s/.test(text)) return undefined;

  const match = LINE_SUFFIX.exec(text);
  const groups = match?.groups;
  if (!groups) return undefined;

  let path: string;
  try {
    path = decodeURIComponent(groups.path);
  } catch {
    return undefined;
  }
  path = path.replace(/^\.\//, '');
  if (path === '' || /[#?]/.test(path) || path.endsWith('/')) return undefined;

  const start = Number(groups.hashStart ?? groups.colonStart);
  if (!Number.isInteger(start) || start < 1) return { path };
  const end = Number(groups.hashEnd ?? groups.colonEnd ?? start);
  return { path, lines: { start, end: Math.max(start, end) } };
}

/** Whether the reference's last segment reads as a file name. */
export function namesFile(reference: CodeReference): boolean {
  const name = reference.path.split('/').at(-1) ?? '';
  return FILE_NAME.test(name);
}

/**
 * The changed file `path` names. An exact match wins. Otherwise an absolute
 * path matches a file it ends in (the agent's checkout), preferring the
 * longest, and a relative one matches the only file it ends in (a path written
 * from a subdirectory).
 */
export function findChangedFile(
  path: string,
  files: readonly ChangedFile[]
): ChangedFile | undefined {
  const exact = files.find((file) => file.path === path);
  if (exact) return exact;

  if (path.startsWith('/')) {
    let longest: ChangedFile | undefined;
    for (const file of files) {
      if (!path.endsWith(`/${file.path}`)) continue;
      if (!longest || file.path.length > longest.path.length) longest = file;
    }
    return longest;
  }

  const ending = files.filter((file) => file.path.endsWith(`/${path}`));
  return ending.length === 1 ? ending[0] : undefined;
}

/** The file on GitHub at the changeset's head commit, when both are known. */
export function headBlobUrl(
  changeset: Pick<Changeset, 'repository' | 'head'> | undefined,
  reference: CodeReference
): string | undefined {
  const repository = changeset?.repository;
  const sha = changeset?.head.sha;
  if (!repository || !sha || reference.path.startsWith('/')) return undefined;

  const path = reference.path.split('/').map(encodeURIComponent).join('/');
  const lines = reference.lines;
  let anchor = '';
  if (lines) {
    anchor =
      lines.end === lines.start
        ? `#L${lines.start}`
        : `#L${lines.start}-L${lines.end}`;
  }
  return `${repository}/blob/${sha}/${path}${anchor}`;
}

/** The link target for a reference to `file`, in the form `parseCodeReference` reads. */
export function codeLinkTarget(
  file: ChangedFile,
  lines: CodeReference['lines']
): string {
  const path = file.path.split('/').map(encodeURIComponent).join('/');
  if (!lines) return path;
  if (lines.end === lines.start) return `${path}#L${lines.start}`;
  return `${path}#L${lines.start}-L${lines.end}`;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
// One inline code span: single backticks around text with no backtick, and
// not part of a longer backtick run.
const INLINE_CODE = /(?<!`)`([^`\n]+)`(?!`)/g;

/**
 * Turn inline code that names a changed file into a link to it, keeping the
 * code formatting as the link text. Fenced blocks, spans already inside a
 * link's text, and spans holding brackets (which would end the link text) are
 * left as they are.
 */
export function linkCodeSpans(
  markdown: string,
  files: readonly ChangedFile[]
): string {
  if (files.length === 0 || !markdown.includes('`')) return markdown;

  let fence: string | undefined;
  return markdown
    .split('\n')
    .map((line) => {
      const opener = FENCE.exec(line)?.[1];
      if (fence) {
        if (opener && opener[0] === fence[0] && opener.length >= fence.length) {
          fence = undefined;
        }
        return line;
      }
      if (opener) {
        fence = opener;
        return line;
      }

      return line.replace(INLINE_CODE, (span, code: string, offset: number) => {
        const before = line[offset - 1];
        const after = line.slice(
          offset + span.length,
          offset + span.length + 2
        );
        if (before === '[' && after === '](') return span;
        if (/[[\]]/.test(code)) return span;

        const reference = parseCodeReference(code);
        if (!reference) return span;
        const file = findChangedFile(reference.path, files);
        if (!file) return span;
        // A bare word in code is more often an identifier than a file, so it
        // links only when it is a changed file's whole path (`Makefile`).
        const bare = !reference.path.includes('/') && !namesFile(reference);
        if (bare && file.path !== reference.path) return span;
        return `[${span}](${codeLinkTarget(file, reference.lines)})`;
      });
    })
    .join('\n');
}
