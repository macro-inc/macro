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
// `package.json:5` also reads as a scheme; a line number after the colon
// makes it a file.
const BARE_LINE_SUFFIX = /^[^:/]+:\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/;

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
  } else if (SCHEME.test(text) && !BARE_LINE_SUFFIX.test(text)) {
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

// Extensions of source and docs files: a bare `README.md` or `lib.rs` is a
// file in the repository, not a host, though `.md` and `.rs` are also TLDs.
const SOURCE_EXTENSIONS = new Set([
  'md',
  'mdx',
  'txt',
  'rst',
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'rs',
  'json',
  'jsonc',
  'toml',
  'yaml',
  'yml',
  'py',
  'go',
  'java',
  'kt',
  'swift',
  'rb',
  'sh',
  'sql',
  'css',
  'scss',
  'html',
  'lock',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'vue',
  'svelte',
  'xml',
  'ini',
  'proto',
  'graphql',
  'nix',
  'zig',
  'lua',
]);

// A segment that reads as a host: labels ending in an alphabetic TLD
// (`example.com`, `docs.example.org`), not a version like `v1.2`.
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

// An IPv4 address, which reads as a file name (`192.168.1.1`).
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Whether a reference to a file outside the changes reads as a path in the
 * repository rather than a web address written without its scheme. An IPv4
 * address is a web address, with or without a port. A first segment that
 * reads as a host is a web address (`example.com`, `example.com/spec.html`,
 * `example.com:8080`, where `target`'s port parses as a line), unless it is
 * the whole reference and ends in a source or docs extension (`README.md`,
 * `package.json:5`). A `#L` line marks a file (`main.tf#L3`). Anything else
 * that names a file is a path.
 */
export function readsAsRepositoryPath(
  reference: CodeReference,
  target: string
): boolean {
  const segments = reference.path.split('/');
  const first = segments[0] ?? '';
  if (IPV4.test(first)) return false;
  if (!namesFile(reference)) return false;
  if (!HOST.test(first)) return true;
  if (segments.length > 1) return reference.lines !== undefined;
  if (reference.lines && !/:\d+$/.test(target.trim())) return true;
  const extension = first.split('.').at(-1)?.toLowerCase() ?? '';
  return SOURCE_EXTENSIONS.has(extension);
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

// Markdown link targets end at a parenthesis or space, which
// `encodeURIComponent` leaves alone or encodes respectively.
const encodeSegment = (segment: string) =>
  encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29');

/** The file on GitHub at the changeset's head commit, when both are known. */
export function headBlobUrl(
  changeset: Pick<Changeset, 'repository' | 'head'> | undefined,
  reference: CodeReference
): string | undefined {
  const repository = changeset?.repository;
  const sha = changeset?.head.sha;
  if (!repository || !sha || reference.path.startsWith('/')) return undefined;
  // A path climbing out of a subdirectory has no known place in the repository.
  if (reference.path.split('/').includes('..')) return undefined;

  const path = reference.path.split('/').map(encodeSegment).join('/');
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
  const path = file.path.split('/').map(encodeSegment).join('/');
  if (!lines) return path;
  if (lines.end === lines.start) return `${path}#L${lines.start}`;
  return `${path}#L${lines.start}-L${lines.end}`;
}

// A fence opens or closes at any indent and inside blockquotes (`> ```ts`).
const FENCE = /^(?:\s*>)*\s*(`{3,}|~{3,})/;
const CLOSING_FENCE = /^(?:\s*>)*\s*(`{3,}|~{3,})\s*$/;
// One inline code span: single backticks around text with no backtick, and
// not part of a longer backtick run.
const INLINE_CODE = /(?<!`)`([^`\n]+)`(?!`)/g;
// A link's text and its target: `[text](target)`.
const LINK = /\[([^[\]]*)\]\(([^()\s]+)\)/g;
// A link's text in any form: followed by its target (with a title, angle
// brackets or parentheses) or a reference label.
const LINK_TEXT = /\[[^[\]]*\](?=[([])/g;

function changedFileTarget(
  text: string,
  files: readonly ChangedFile[]
): string | undefined {
  const reference = parseCodeReference(text);
  if (!reference) return undefined;
  const file = findChangedFile(reference.path, files);
  if (!file) return undefined;
  // A bare word in code is more often an identifier than a file, so it
  // links only when it is a changed file's whole path (`Makefile`).
  const bare = !reference.path.includes('/') && !namesFile(reference);
  if (bare && file.path !== reference.path) return undefined;
  return codeLinkTarget(file, reference.lines);
}

type Range = { start: number; end: number };

const ranges = (text: string, pattern: RegExp): Range[] =>
  [...text.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));

const within = (list: Range[], offset: number) =>
  list.some(({ start, end }) => offset > start && offset < end);

function linkLine(line: string, files: readonly ChangedFile[]): string {
  // Links to a changed file in a form the markdown import drops
  // (`file://…`, `package.json:5`) get the `path#L…` form it keeps.
  // Code that shows a link is left alone.
  const spans = ranges(line, INLINE_CODE);
  const linked = line.replace(
    LINK,
    (link, text: string, target: string, offset: number) => {
      if (within(spans, offset)) return link;
      const canonical = changedFileTarget(target, files);
      return canonical ? `[${text}](${canonical})` : link;
    }
  );

  const links = [...ranges(linked, LINK), ...ranges(linked, LINK_TEXT)];
  return linked.replace(INLINE_CODE, (span, code: string, offset: number) => {
    // Inside a link's text, or holding brackets that would end the new one.
    if (within(links, offset)) return span;
    if (/[[\]]/.test(code)) return span;
    const target = changedFileTarget(code, files);
    return target ? `[${span}](${target})` : span;
  });
}

/**
 * Turn references to changed files in agent markdown into links the pane
 * opens: inline code that names one becomes a link with the code as its
 * text, and a link to one gets a target the markdown import keeps. Fenced
 * blocks are left as they are.
 */
export function linkCodeReferences(
  markdown: string,
  files: readonly ChangedFile[]
): string {
  if (files.length === 0) return markdown;

  let fence: string | undefined;
  return markdown
    .split('\n')
    .map((line) => {
      const opener = FENCE.exec(line)?.[1];
      if (fence) {
        // A closing fence carries no info string.
        const closes = CLOSING_FENCE.test(line);
        if (
          closes &&
          opener &&
          opener[0] === fence[0] &&
          opener.length >= fence.length
        ) {
          fence = undefined;
        }
        return line;
      }
      if (opener) {
        fence = opener;
        return line;
      }
      return linkLine(line, files);
    })
    .join('\n');
}
