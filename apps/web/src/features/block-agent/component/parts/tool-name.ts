/**
 * A tool's name as a row should read it.
 *
 * The kinds the fold recognizes get their verb from `tool-appearance`; what is
 * left are the tools only their name identifies — Macro's own, an MCP
 * server's, a harness tool this block does not model — and those names are
 * written for a model, not a reader: `get_mcp_tools`, `ReadContent`,
 * `BashCodeExecution`. So the name is broken into words, its acronyms are
 * restored, and a leading verb becomes the same past/present pair every other
 * row uses: `get_mcp_tools` reads "Reading MCP tools" while it runs and "Read
 * MCP tools" once it is done.
 *
 * A name that does not start with a verb keeps its words and does not morph —
 * inventing a tense for `BashCodeExecution` would be guessing at what the tool
 * did.
 */

import { match } from 'ts-pattern';

/** Words a name spells in lowercase that a reader expects in capitals. */
const ACRONYMS = new Set([
  'ai',
  'api',
  'csv',
  'db',
  'html',
  'http',
  'id',
  'json',
  'mcp',
  'ocr',
  'pdf',
  'sdk',
  'sql',
  'ui',
  'url',
  'xml',
]);

/**
 * The present and past forms of a leading verb, or `undefined` for a first
 * word that is not one.
 */
function verbForms(word: string): { active: string; done: string } | undefined {
  return match(word)
    .with('get', 'fetch', 'read', 'load', () => ({
      active: 'Reading',
      done: 'Read',
    }))
    .with('list', 'browse', () => ({ active: 'Listing', done: 'Listed' }))
    .with('search', 'find', 'query', 'lookup', () => ({
      active: 'Searching',
      done: 'Searched',
    }))
    .with('create', 'add', 'make', 'new', () => ({
      active: 'Creating',
      done: 'Created',
    }))
    .with('update', 'edit', 'patch', 'set', 'configure', () => ({
      active: 'Updating',
      done: 'Updated',
    }))
    .with('delete', 'remove', 'drop', () => ({
      active: 'Deleting',
      done: 'Deleted',
    }))
    .with('send', 'post', 'publish', () => ({
      active: 'Sending',
      done: 'Sent',
    }))
    .with('ask', () => ({ active: 'Asking', done: 'Asked' }))
    .with('run', 'exec', 'execute', 'invoke', 'calculate', () => ({
      active: 'Running',
      done: 'Ran',
    }))
    .with('write', 'save', 'store', () => ({
      active: 'Writing',
      done: 'Wrote',
    }))
    .with('move', 'rename', () => ({ active: 'Moving', done: 'Moved' }))
    .with('open', () => ({ active: 'Opening', done: 'Opened' }))
    .with('check', 'verify', 'validate', () => ({
      active: 'Checking',
      done: 'Checked',
    }))
    .with('import', () => ({ active: 'Importing', done: 'Imported' }))
    .with('export', () => ({ active: 'Exporting', done: 'Exported' }))
    .with('mark', () => ({ active: 'Marking', done: 'Marked' }))
    .with('manage', () => ({ active: 'Managing', done: 'Managed' }))
    .with('issue', () => ({ active: 'Issuing', done: 'Issued' }))
    .otherwise(() => undefined);
}

/** A name's words, from `snake_case`, `kebab-case`, dots, or `camelCase`. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-./]+/)
    .filter((word) => word.length > 0);
}

/** A word as it reads mid-sentence: an acronym in capitals, else lowercase. */
function spell(word: string): string {
  const lower = word.toLowerCase();
  return ACRONYMS.has(lower) ? lower.toUpperCase() : lower;
}

export interface ToolTitle {
  /** What the row reads once the call is over. */
  title: string;
  /** What it reads while the call runs, for a name that starts with a verb. */
  activeTitle: string | undefined;
}

/** How a row should say a tool's name. */
export function toolTitle(name: string): ToolTitle {
  const parts = words(name);
  const first = parts[0];
  if (first === undefined) return { title: name, activeTitle: undefined };

  const rest = parts.slice(1).map(spell).join(' ');
  const verb = verbForms(first.toLowerCase());
  if (verb === undefined) {
    const head = spell(first);
    const shown = [
      ACRONYMS.has(first.toLowerCase())
        ? head
        : head.charAt(0).toUpperCase() + head.slice(1),
      rest,
    ]
      .filter(Boolean)
      .join(' ');
    return { title: shown, activeTitle: undefined };
  }

  return {
    title: [verb.done, rest].filter(Boolean).join(' '),
    activeTitle: [verb.active, rest].filter(Boolean).join(' '),
  };
}
