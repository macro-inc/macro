import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
import { EditorView } from 'codemirror';

const mono = [
  '"Forma DJR Mono"',
  'ui-monospace',
  'SFMono-Regular',
  'Menlo',
  'Monaco',
  'Consolas',
  'Liberation Mono',
  'Courier New',
  'monospace',
].join(', ');

const base = {
  bg: 'var(--color-page)',
  fg: 'var(--color-ink)',
  panel: 'var(--color-panel)',

  fg70: 'color-mix(in oklch, var(--color-ink), var(--color-page) 30%)',
  fg50: 'color-mix(in oklch, var(--color-ink), var(--color-page) 50%)',
  fg30: 'color-mix(in oklch, var(--color-ink), var(--color-page) 70%)',
  fg10: 'color-mix(in oklch, var(--color-ink), var(--color-page) 90%)',

  success50: 'rgb(from var(--color-success) r g b / 0.5)',
  failure50: 'rgb(from var(--color-failure) r g b / 0.5)',

  activeLine: 'rgb(from var(--color-edge) r g b / 0.3)',
  selection: 'rgb(from var(--color-edge) r g b / 0.6)',
  menuSelected: 'var(--color-hover)',

  alt: 'var(--color-ink-extra-muted)',
  edge: 'var(--color-edge)',
  edge50: 'color-mix(in oklch, var(--color-edge), var(--color-page) 50%)',
  accent: 'var(--color-accent)',
  error: 'var(--color-failure)',
  link: 'var(--color-accent)',

  c0: 'var(--color-accent)',
  c1: 'var(--color-accent-30)',
  c2: 'var(--color-accent-60)',
  c3: 'var(--color-accent-90)',
  c4: 'var(--color-accent-120)',
  c5: 'var(--color-accent-150)',
  c6: 'var(--color-accent-180)',
  c7: 'var(--color-accent-210)',
  c8: 'var(--color-accent-240)',
  c9: 'var(--color-accent-270)',
  c10: 'var(--color-accent-300)',
  c11: 'var(--color-accent-330)',
};

const theme = EditorView.theme({
  '&': {
    color: base.fg,
    fontSize: '0.95rem',
    fontFamily: mono,
    minHeight: '100%',
    height: '100%',
  },
  '.cm-content': {
    caretColor: base.accent,
    padding: '0.5rem 0',
    minHeight: '100%',
  },
  '.cm-line': {
    paddingLeft: '0.5rem',
    paddingRight: '0.5rem',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: base.fg,
    borderLeftWidth: '2px',
  },
  '.cm-fat-cursor': {
    backgroundColor: base.accent,
    color: base.bg,
  },
  '.cm-scroller': {
    fontFamily: mono,
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: base.fg50,
    borderRight: 'none',
  },
  '.cm-lineNumbers > .cm-gutterElement': {
    paddingLeft: '1rem',
    paddingRight: '0.5rem',
  },
  '.cm-foldGutter > .cm-gutterElement': {
    paddingRight: '1rem',
  },
  '.cm-activeLineGutter': {
    backgroundColor: base.activeLine,
  },
  '.cm-activeLine': {
    backgroundColor: base.activeLine,
  },
  // Selection
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: base.selection,
    },
  // Make sure selection appears above active line
  '.cm-selectionLayer': {
    zIndex: 100,
  },
  '.cm-selectionMatch': {
    backgroundColor: base.selection,
  },
  '.cm-tooltip': {
    backgroundColor: base.panel,
    color: base.fg70,
    border: `1px solid ${base.edge}`,
    padding: '0.5rem',
    borderRadius: '0.25rem',
    fontSize: '0.875rem',
  },
  '.cm-tooltip-autocomplete ul li': {
    padding: '5rem',
  },
  '.cm-completionIcon': {
    display: 'none',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: base.menuSelected,
    color: base.fg70,
  },
});

/**
 * Enhanced syntax highlighting for Monokai theme
 */
const highlights = HighlightStyle.define([
  // Keywords and control flow
  { tag: t.keyword, color: base.c5 },
  { tag: t.controlKeyword, color: base.c5 },
  { tag: t.moduleKeyword, color: base.c5 },

  // Names and variables
  { tag: [t.name, t.deleted, t.character, t.macroName], color: base.fg },
  { tag: [t.variableName], color: base.fg },
  { tag: [t.propertyName], color: base.c2 },

  // Classes and types
  { tag: [t.typeName], color: base.fg, fontStyle: 'italic' },
  { tag: [t.className], color: base.fg, fontStyle: 'italic' },
  { tag: [t.namespace], color: base.fg, fontStyle: 'italic' },

  // Operators and punctuation
  { tag: [t.operator, t.operatorKeyword], color: base.c10 },
  { tag: [t.bracket], color: base.fg50 },
  { tag: [t.brace], color: base.fg50 },
  { tag: [t.punctuation], color: base.fg },

  // Functions and parameters
  { tag: [t.function(t.variableName), t.labelName], color: base.c6 },
  { tag: [t.definition(t.function(t.variableName))], color: base.c7 },
  { tag: [t.definition(t.variableName)], color: base.c6 },

  // Constants and literals
  { tag: t.number, color: base.c5 },
  { tag: t.changed, color: base.c4 },
  { tag: t.annotation, color: base.fg50 },
  { tag: t.modifier, color: base.fg },
  { tag: t.self, color: base.c3 },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: base.c2 },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: base.c3 },

  // Strings and regex
  { tag: [t.processingInstruction, t.inserted], color: base.c1 },
  { tag: [t.special(t.string), t.regexp], color: base.c2 },
  { tag: t.string, color: base.c1 },

  // Punctuation and structure
  { tag: t.definition(t.typeName), color: base.fg },

  // Comments and documentation
  { tag: t.meta, color: base.fg70 },
  { tag: t.comment, color: base.fg70 },
  { tag: t.docComment, color: base.fg70 },

  // HTML/XML elements
  { tag: [t.tagName], color: base.fg },
  { tag: [t.attributeName], color: base.fg },

  // Markdown and text formatting
  { tag: [t.heading], color: base.fg },
  { tag: [t.strong], color: base.fg },
  { tag: [t.emphasis], color: base.fg },

  // Links and URLs
  {
    tag: [t.link],
    color: base.fg,
    fontWeight: '500',
    textDecoration: 'underline',
    textUnderlinePosition: 'under',
  },
  {
    tag: [t.url],
    color: base.fg,
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },

  // Special states
  {
    tag: [t.invalid],
    color: base.fg,
    textDecoration: 'underline wavy',
    borderBottom: `1px wavy var(--color-failure)`,
  },
  { tag: [t.strikethrough], color: base.fg, textDecoration: 'line-through' },

  // Enhanced syntax highlighting
  { tag: t.constant(t.name), color: base.fg },
  { tag: t.deleted, color: base.fg },
  { tag: t.squareBracket, color: base.fg },
  { tag: t.angleBracket, color: base.fg },

  // Additional specific styles
  { tag: t.monospace, color: base.fg },
  { tag: [t.contentSeparator], color: base.fg },
  { tag: t.quote, color: base.fg },
]);

/**
 */
export const macroThemeExtension: Extension = [
  theme,
  syntaxHighlighting(highlights),
];
