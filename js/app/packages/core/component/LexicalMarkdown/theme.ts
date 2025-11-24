import './styles.css';
import type { EditorThemeClasses } from 'lexical';

const vertical = 'my-1.5';

// SCUFFED THEMING: we have to figure out what to do about code highlighting.
const codeHighlight: Record<string, string> = {
  atrule: 'text-accent-30',
  attr: 'text-accent-60',
  boolean: 'text-accent-90',
  builtin: 'text-accent-120',
  cdata: 'text-ink-muted',
  char: 'text-accent-150',
  class: 'text-accent-180',
  'class-name': 'text-accent-180',
  comment: 'text-ink-muted',
  constant: 'text-accent-270',
  deleted: 'text-accent-300',
  doctype: 'text-accent-330',
  entity: 'text-accent-30',
  function: 'text-accent-60',
  important: 'text-accent-90',
  inserted: 'text-accent-120',
  keyword: 'text-accent-150',
  namespace: 'text-accent-180',
  number: 'text-accent-120',
  operator: 'text-accent-300',
  prolog: 'text-ink-muted',
  property: 'text-accent-270',
  punctuation: 'text-ink',
  regex: 'text-accent-60',
  selector: 'text-accent-90',
  string: 'text-accent-30',
  symbol: 'text-accent-60',
  tag: 'text-accent-90',
  url: 'text-accent-120',
  variable: 'text-accent-150',
};

export const theme: EditorThemeClasses = {
  root: 'md',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    code: 'bg-edge/20 font-mono rounded-xs md-inline-code p-0.5',
    strikethrough: 'md-strike',
    underline: 'md-underline',
    highlight: 'text-accent font-semibold',
  },
  paragraph: `${vertical} md-p text-[1em]`,
  heading: {
    h1: 'text-3xl text-[1.875em] font-semibold mb-4',
    h2: 'text-2xl text-[1.5em] font-semibold mb-3',
    h3: 'text-xl text-[1.25em] font-semibold mb-2',
    h4: 'text-xl text-[1.25em] font-medium mb-2',
    h5: 'text-lg text-[1.125em] font-medium mb-1',
    h6: 'text-base text-[1em] font-medium mb-1',
  },
  list: {
    ul: 'list-none md-list md-bullet',
    ol: 'list-decimal md-list md-number',
    listitem: `${vertical}`,
    nested: {
      listitem: 'list-none nested',
    },
    checklist: 'md-list md-check',
    listitemChecked: 'checked md-strike text-ink-extra-muted',
  },
  link: 'text-accent-ink underline hover:underline cursor-default underline-offset-[0.15em]',
  quote: 'md-quote border-l-2 border-edge pl-4 py-2 italic text-ink-muted my-4',
  code: 'bg-edge/20 font-mono p-3 rounded block md-code-box before:text-ink-extra-muted/70 whitespace-pre mb-4',
  static: {
    'code-container': 'bg-edge/20 rounded',
  },
  codeHighlight,
  'inline-search':
    'md-inline-search bg-edge/20 text-ink-muted rounded-sm p-0.5',

  table: 'md-table',
  tableAddColumns: 'md-table-add-columns',
  tableAddRows: 'md-table-add-rows',
  tableAlignment: {
    center: 'md-table-alignment-center',
    right: 'md-table-alignment-right',
  },
  tableCell: 'md-table-cell',
  tableCellActionButton: 'md-table-cell-action-button',
  tableCellActionButtonContainer: 'md-table-cell-action-button-container',
  tableCellHeader: 'md-table-cell-header',
  tableCellResizer: 'md-table-cell-resizer',
  tableCellSelected: 'md-table-cell-selected',
  tableFrozenColumn: 'md-table-frozen-column',
  tableFrozenRow: 'md-table-frozen-row',
  tableRowStriping: 'md-table-row-striping',
  tableScrollableWrapper: 'md-table-scrollable-wrapper',
  tableSelected: 'md-table-selected',
  tableSelection: 'md-table-selection',
  mark: 'md-mark',
  markOverlap: 'md-mark-overlap',
  searchMatch: 'search-match',

  // Note: In an active editor, HRs are rendered as decorators by HoritzontalRule
  // component so this class only applies to static md
  hr: 'my-7 h-px bg-edge',
};

/**
 * Deep merges two themes.
 * @param overrideTheme The new styles.
 * @param baseTheme The optional base theme, falls back to the default theme.
 * @param options.join If true, concatenates the new styles with the base styles for the same key
 *     instead of overriding. @returns The merged theme.
 */
export function createTheme(
  overrideTheme: EditorThemeClasses,
  baseTheme: EditorThemeClasses = theme,
  options?: { join?: true }
): EditorThemeClasses {
  const mergedTheme = structuredClone(baseTheme);

  const deepMerge = (
    target: EditorThemeClasses,
    source: EditorThemeClasses
  ) => {
    Object.entries(source).forEach(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!target[key] || typeof target[key] !== 'object') {
          target[key] = {};
        }
        deepMerge(target[key], value);
      } else {
        if (options?.join && target[key]) {
          if (!target[key].includes(value)) {
            target[key] = `${target[key]} ${value}`.trim();
          }
        } else {
          target[key] = value;
        }
      }
    });
    return target;
  };

  return deepMerge(mergedTheme, overrideTheme);
}

export const aiChatTheme = createTheme(
  {
    heading: {
      h1: 'text-2xl font-bold mt-5',
      h2: 'text-xl font-bold mt-4',
      h3: 'text-l font-bold mt-3',
      h4: 'text-base font-medium',
      h5: 'text-base font-medium',
      h6: 'text-base font-medium',
    },
    code: 'w-full bg-transparent',
    static: {
      'code-container': 'bg-edge/20 m-2',
    },
  },
  theme,
  { join: true }
);

export const channelTheme = createTheme(
  {
    root: 'channel-markdown max-w-full min-w-0',
    code: 'rounded w-full bg-transparent',
    static: {
      'code-container': 'bg-edge/20 rounded m-2',
    },
  },
  theme,
  { join: true }
);

export const channelThemeSender = createTheme(
  {
    text: {
      base: 'text-current',
      code: 'chat-blue font-mono rounded md-inline-code border-1 pt-0.5 bg-[navy]/20 border-1 border-[navy]/23',
    },
    quote: 'border-l-2 border-current/20 pl-4 py-2 italic text-current/80 my-4',
    list: {
      listitemChecked: 'checked chat-blue md-strike text-current/50',
    },
    link: 'text-current underline hover:opacity-50',
    code: `chat-blue font-mono p-3 rounded block md-code-box before:text-current/50`,
    static: {
      'code-container': `bg-[navy]/20 rounded m-2`,
    },
    'user-mention': 'chat-blue',
    'document-mention': 'chat-blue',
  },
  channelTheme
);

export const embeddedCodeBlock = createTheme({
  code: 'font-mono p-3 rounded block md-code-box before:text-ink-extra-muted/70 whitespace-pre overflow-y-scroll h-full',
});

export const unifiedListMarkdownTheme = createTheme({
  code: 'font-mono overflow-hidden px-1.5 py-0.5 rounded bg-edge/20 inline-block',
  static: {
    'code-container':
      'font-mono md-code-box no-accessory overflow-hidden flex items-center',
  },
  paragraph: `${theme.paragraph} inline`,
  heading: {
    h1: 'text-[1em] font-semibold',
    h2: 'text-[1em] font-semibold',
    h3: 'text-[1em] font-semibold',
    h4: 'text-[1em] font-medium',
    h5: 'text-[1em] font-medium',
    h6: 'text-[1em] font-medium',
  },
  // padding right to prevent italics being clipped by overflow properties such as truncation
  root: `${theme.root} inline pr-[2px] cursor-default`,
});
