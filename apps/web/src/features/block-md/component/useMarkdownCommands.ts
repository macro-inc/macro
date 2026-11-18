import type { NativeActionCommands } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-actions';
import { ACTIONS } from '@core/component/LexicalMarkdown/plugins/actions/actions';
import type { Action } from '@core/component/LexicalMarkdown/plugins/actions/types';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import BugIcon from '@icon/system/regular/bug.svg';
import TextCode from '@icon/system/regular/code.svg';
import TextHighlight from '@icon/system/regular/paint-roller.svg';
import TextBold from '@icon/system/regular/text-b.svg';
import TextItalic from '@icon/system/regular/text-italic.svg';
import TextStrikethrough from '@icon/system/regular/text-strikethrough.svg';
import TextSub from '@icon/system/regular/text-subscript.svg';
import TextSuper from '@icon/system/regular/text-superscript.svg';
import TextUnderline from '@icon/system/regular/text-underline.svg';
import {
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import type { Component, JSX } from 'solid-js';

type InlineFormatDef = {
  token: HotkeyToken;
  format: TextFormatType;
  description: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  hotkey?: ValidHotkey;
};

const INLINE_FORMATS: InlineFormatDef[] = [
  {
    token: TOKENS.md.bold,
    format: 'bold',
    description: 'Bold',
    icon: TextBold,
    hotkey: 'cmd+b',
  },
  {
    token: TOKENS.md.italic,
    format: 'italic',
    description: 'Italic',
    icon: TextItalic,
    hotkey: 'cmd+i',
  },
  {
    token: TOKENS.md.underline,
    format: 'underline',
    description: 'Underline',
    icon: TextUnderline,
    hotkey: 'cmd+u',
  },
  {
    token: TOKENS.md.strikethrough,
    format: 'strikethrough',
    description: 'Strikethrough',
    icon: TextStrikethrough,
    hotkey: 'shift+cmd+x',
  },
  {
    token: TOKENS.md.highlight,
    format: 'highlight',
    description: 'Highlight',
    icon: TextHighlight,
    hotkey: 'shift+cmd+h',
  },
  {
    token: TOKENS.md.inlineCode,
    format: 'code',
    description: 'Inline code',
    icon: TextCode,
    hotkey: 'cmd+e',
  },
  {
    token: TOKENS.md.superscript,
    format: 'superscript',
    description: 'Superscript',
    icon: TextSuper,
  },
  {
    token: TOKENS.md.subscript,
    format: 'subscript',
    description: 'Subscript',
    icon: TextSub,
  },
];

// -- Map ACTIONS ids to hotkey tokens ---------------------------------------

const ACTION_ID_TO_TOKEN: Record<string, HotkeyToken> = {
  paragraph: TOKENS.md.paragraph,
  heading1: TOKENS.md.heading1,
  heading2: TOKENS.md.heading2,
  heading3: TOKENS.md.heading3,
  quote: TOKENS.md.quote,
  code: TOKENS.md.codeBlock,
  'list-bullet': TOKENS.md.bulletList,
  'list-number': TOKENS.md.numberedList,
  'list-check': TOKENS.md.checklist,
  image: TOKENS.md.image,
  video: TOKENS.md.video,
  link: TOKENS.md.link,
  latex: TOKENS.md.math,
  table: TOKENS.md.table,
  hr: TOKENS.md.divider,
};

/** What the command menu's markdown commands act on: the Source editor or the native body. */
export interface MarkdownCommandTarget {
  formatText(format: TextFormatType): void;
  /** The action is installed and its node dependencies are registered. */
  available(action: Action): boolean;
  run(action: Action): void;
  focus(): void;
}

/** Source: FORMAT_TEXT_COMMAND, the ACTIONS handler and editor.hasNodes. */
export function lexicalCommandTarget(
  editor: LexicalEditor
): MarkdownCommandTarget {
  return {
    formatText: (format) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format),
    available: (action) => editor.hasNodes(action.dependencies ?? []),
    run: (action) => action.action(editor),
    focus: () => editor.focus(),
  };
}

/** Native body: the formatting host's text formats and the slash-action host. */
export function nativeCommandTarget(native: {
  formatting(): { formatText(format: TextFormatType): void } | undefined;
  actions(): NativeActionCommands | undefined;
  focus(): void;
}): MarkdownCommandTarget {
  return {
    formatText: (format) => native.formatting()?.formatText(format),
    available: (action) => native.actions()?.available(action) ?? false,
    run: (action) => native.actions()?.perform(action),
    focus: native.focus,
  };
}

/** The document body the command menu acts on. */
export function markdownCommandTarget(md: {
  editor?: LexicalEditor;
  nativeCommands?: MarkdownCommandTarget;
}): MarkdownCommandTarget | undefined {
  return md.editor ? lexicalCommandTarget(md.editor) : md.nativeCommands;
}

type LexicalStateDebuggerCommandOptions = {
  canUseStateDebugger?: () => boolean;
  toggleStateDebugger: () => void;
};

function registerLexicalStateDebuggerHotkey(
  scopeId: string,
  options: LexicalStateDebuggerCommandOptions,
  group: ReturnType<typeof createHotkeyGroup>
) {
  registerHotkey({
    scopeId,
    runWithInputFocused: true,
    hotkeyToken: TOKENS.md.toggleStateDebugger,
    description: 'Toggle lexical state debugger',
    icon: BugIcon,
    hide: () => options.canUseStateDebugger?.() === false,
    condition: () => options.canUseStateDebugger?.() !== false,
    keyDownHandler: () => {
      if (options.canUseStateDebugger?.() === false) return false;
      options.toggleStateDebugger();
      return true;
    },
  }).withGroup(group);
}

/**
 * Registers markdown formatting commands on the block hotkey scope so they
 * appear in the command menu (Cmd+K). Inline formats that already have
 * Lexical-owned keyboard shortcuts use `proxiedHotkey` -- the hotkey system
 * displays them but lets Lexical handle the actual keystroke; only command-menu
 * invocation runs the handler.
 *
 * Block-level and insertion commands reuse the ACTIONS definitions from the
 * slash-command system.
 */
export function registerMarkdownCommands(
  scopeId: string,
  getTarget: () => MarkdownCommandTarget | undefined,
  condition?: () => boolean,
  options?: {
    canUseStateDebugger?: () => boolean;
    toggleStateDebugger?: () => void;
  }
) {
  const group = createHotkeyGroup();
  const hide = condition ? () => !condition() : undefined;
  const shared = { scopeId, hide, runWithInputFocused: true } as const;

  // Inline text formats (bold, italic, etc.)
  for (const def of INLINE_FORMATS) {
    registerHotkey({
      ...shared,
      hotkeyToken: def.token,
      hotkey: def.hotkey,
      description: def.description,
      icon: def.icon,
      proxiedHotkey: !!def.hotkey,
      keyDownHandler: () => {
        const target = getTarget();
        if (!target) return false;
        target.formatText(def.format);
        target.focus();
        return true;
      },
    }).withGroup(group);
  }

  // Block-level transforms & insertions (from slash-command ACTIONS)
  for (const action of ACTIONS) {
    const token = ACTION_ID_TO_TOKEN[action.id];
    if (!token) continue;

    registerHotkey({
      ...shared,
      hotkeyToken: token,
      description: action.name,
      icon: action.icon,
      keyDownHandler: () => {
        const target = getTarget();
        if (!target) return false;
        target.run(action);
        target.focus();
        return true;
      },
      hide: () => {
        const target = getTarget();
        if (!target) return true;
        return !target.available(action);
      },
      condition: () => getTarget()?.available(action) ?? false,
    }).withGroup(group);
  }

  if (options?.toggleStateDebugger) {
    registerLexicalStateDebuggerHotkey(
      scopeId,
      {
        canUseStateDebugger: options.canUseStateDebugger,
        toggleStateDebugger: options.toggleStateDebugger,
      },
      group
    );
  }

  return group;
}
