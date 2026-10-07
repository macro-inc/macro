import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import ArrowsDownUp from '@phosphor/arrows-down-up.svg';
import AsteriskSimple from '@phosphor/asterisk-simple.svg';
import ChatCircleText from '@phosphor/chat-circle-text.svg';
import Check from '@phosphor/check.svg';
import Checks from '@phosphor/checks.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import Eye from '@phosphor/eye.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import GitDiff from '@phosphor/git-diff.svg';
import Highlighter from '@phosphor/highlighter.svg';
import ListBullets from '@phosphor/list-bullets.svg';
import ListNumbers from '@phosphor/list-numbers.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import RowsPlusBottom from '@phosphor/rows-plus-bottom.svg';
import Table from '@phosphor/table.svg';
import TextAUnderline from '@phosphor/text-a-underline.svg';
import TextAlignCenter from '@phosphor/text-align-center.svg';
import TextAlignJustify from '@phosphor/text-align-justify.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import TextAlignRight from '@phosphor/text-align-right.svg';
import TextB from '@phosphor/text-b.svg';
import TextIndent from '@phosphor/text-indent.svg';
import TextItalic from '@phosphor/text-italic.svg';
import TextOutdent from '@phosphor/text-outdent.svg';
import TextStrikethrough from '@phosphor/text-strikethrough.svg';
import TextSubscript from '@phosphor/text-subscript.svg';
import TextSuperscript from '@phosphor/text-superscript.svg';
import TextTSlash from '@phosphor/text-t-slash.svg';
import TextUnderline from '@phosphor/text-underline.svg';
import X from '@phosphor/x.svg';
import XCircle from '@phosphor/x-circle.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { Toolbar } from '@ui/components/Toolbar';
import { For, type JSX, Show } from 'solid-js';

export type DocxInlineFormat =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'superscript'
  | 'subscript';
/** Table row and column commands. */
export type DocxTableOp =
  | 'rowAbove'
  | 'rowBelow'
  | 'columnLeft'
  | 'columnRight'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable';
export type DocxAlignment = 'left' | 'center' | 'right' | 'justify';
export type DocxParagraphStyle = { id: string; name: string };

/** Font sizes offered in the size picker (points). */
const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

/** Font families offered in the font picker. */
const FONT_FAMILIES = [
  'Arial',
  'Calibri',
  'Cambria',
  'Courier New',
  'Garamond',
  'Georgia',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Verdana',
];

/** Word's standard text colors (`RRGGBB`). */
const TEXT_COLORS: Array<{ name: string; hex: string }> = [
  { name: 'Black', hex: '000000' },
  { name: 'Dark red', hex: 'C00000' },
  { name: 'Red', hex: 'FF0000' },
  { name: 'Orange', hex: 'FFC000' },
  { name: 'Yellow', hex: 'FFFF00' },
  { name: 'Light green', hex: '92D050' },
  { name: 'Green', hex: '00B050' },
  { name: 'Light blue', hex: '00B0F0' },
  { name: 'Blue', hex: '0070C0' },
  { name: 'Dark blue', hex: '002060' },
  { name: 'Purple', hex: '7030A0' },
];

/** Word's highlight colors: name in the file, label, swatch. */
const HIGHLIGHTS: Array<{ value: string; name: string; hex: string }> = [
  { value: 'yellow', name: 'Yellow', hex: 'FFFF00' },
  { value: 'green', name: 'Bright green', hex: '00FF00' },
  { value: 'cyan', name: 'Turquoise', hex: '00FFFF' },
  { value: 'magenta', name: 'Pink', hex: 'FF00FF' },
  { value: 'blue', name: 'Blue', hex: '0000FF' },
  { value: 'red', name: 'Red', hex: 'FF0000' },
  { value: 'darkBlue', name: 'Dark blue', hex: '000080' },
  { value: 'darkCyan', name: 'Teal', hex: '008080' },
  { value: 'darkGreen', name: 'Green', hex: '008000' },
  { value: 'darkMagenta', name: 'Violet', hex: '800080' },
  { value: 'darkRed', name: 'Dark red', hex: '800000' },
  { value: 'darkYellow', name: 'Dark yellow', hex: '808000' },
  { value: 'darkGray', name: 'Gray 50%', hex: '808080' },
  { value: 'lightGray', name: 'Gray 25%', hex: 'C0C0C0' },
];

/** Line spacing multiples offered. */
const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];

const TABLE_OPS: Array<{ op: DocxTableOp; label: string }> = [
  { op: 'rowAbove', label: 'Insert row above' },
  { op: 'rowBelow', label: 'Insert row below' },
  { op: 'columnLeft', label: 'Insert column left' },
  { op: 'columnRight', label: 'Insert column right' },
  { op: 'deleteRow', label: 'Delete row' },
  { op: 'deleteColumn', label: 'Delete column' },
  { op: 'deleteTable', label: 'Delete table' },
];

export type DocxToolbarProps = {
  canEdit: boolean;
  canComment: boolean;
  format: Partial<Record<DocxInlineFormat, boolean>>;
  /** Font size at the selection (points). */
  fontSize: number | null;
  /** Font family at the selection. */
  fontFamily: string | null;
  /** Text color at the selection (`RRGGBB`, null for automatic). */
  color: string | null;
  /** Highlight at the selection (a Word highlight name). */
  highlight: string | null;
  /** Line spacing of the paragraph as a multiple, when it is one. */
  lineSpacing: number | null;
  /** The caret is in a table. */
  inTable: boolean;
  paragraphStyle: string | null;
  paragraphStyles: DocxParagraphStyle[];
  /** Tracked changes shown inline (else the document as if accepted). */
  showMarkup: boolean;
  /** The document records everyone's edits as tracked changes. */
  tracking: boolean;
  /** The selection (or the caret) is on a tracked change. */
  onRevision: boolean;
  onFormat: (format: DocxInlineFormat) => void;
  onFontSize: (size: number) => void;
  onFontFamily: (family: string) => void;
  /** Set the text color (`RRGGBB`), or null for automatic. */
  onColor: (color: string | null) => void;
  /** Set the highlight (a Word highlight name), or null to remove it. */
  onHighlight: (highlight: string | null) => void;
  onClearFormat: () => void;
  /** Indent (or outdent) the paragraphs. */
  onIndent: (forward: boolean) => void;
  onLineSpacing: (multiple: number) => void;
  onTable: (op: DocxTableOp) => void;
  /** Put focus back in the document (after a menu closes). */
  onRefocus?: () => void;
  onParagraphStyle: (styleId: string) => void;
  onList: (kind: 'bullet' | 'number') => void;
  onAlign: (alignment: DocxAlignment) => void;
  onUndo: () => void;
  onRedo: () => void;
  onInsertTable: () => void;
  /** Insert a footnote (or endnote) at the caret. */
  onInsertNote: (endnote: boolean) => void;
  /** The selection is in the body (notes are inserted from there). */
  inBody: boolean;
  onToggleMarkup: () => void;
  onToggleTracking: () => void;
  /** Accept the change at the selection, or every change. */
  onAccept: (all: boolean) => void;
  /** Reject the change at the selection, or every change. */
  onReject: (all: boolean) => void;
  onComment: () => void;
  /** Open find (and replace). */
  onFind: () => void;
  onDownload: () => void;
};

const INLINE: Array<{
  format: DocxInlineFormat;
  label: string;
  icon: () => JSX.Element;
  shortcut?: string;
}> = [
  { format: 'bold', label: 'Bold', icon: () => <TextB />, shortcut: 'Mod+B' },
  {
    format: 'italic',
    label: 'Italic',
    icon: () => <TextItalic />,
    shortcut: 'Mod+I',
  },
  {
    format: 'underline',
    label: 'Underline',
    icon: () => <TextUnderline />,
    shortcut: 'Mod+U',
  },
  {
    format: 'strike',
    label: 'Strikethrough',
    icon: () => <TextStrikethrough />,
  },
  {
    format: 'superscript',
    label: 'Superscript',
    icon: () => <TextSuperscript />,
    shortcut: 'Mod+Shift+=',
  },
  {
    format: 'subscript',
    label: 'Subscript',
    icon: () => <TextSubscript />,
    shortcut: 'Mod+=',
  },
];

/** A square of a document color. */
function Swatch(props: { hex: string | null }) {
  return (
    <span
      class="inline-block size-3.5 shrink-0 rounded-[3px] border border-edge-muted"
      style={{ background: props.hex ? `#${props.hex}` : 'transparent' }}
    />
  );
}

/** A toolbar button opening a menu; closing it hands focus back to the
 * document through `onClose`. */
function ToolbarMenu(props: {
  label: string;
  icon: JSX.Element;
  children: JSX.Element;
  testId?: string;
  onClose?: () => void;
}) {
  return (
    <Dropdown placement="bottom-start" modal={false}>
      <Dropdown.Trigger
        variant="ghost"
        size="icon-sm"
        label={props.label}
        data-docx-menu={props.testId}
      >
        {props.icon}
      </Dropdown.Trigger>
      <Dropdown.Content
        class="min-w-44"
        onCloseAutoFocus={(event: Event) => {
          if (!props.onClose) return;
          event.preventDefault();
          props.onClose();
        }}
      >
        {props.children}
      </Dropdown.Content>
    </Dropdown>
  );
}

const ALIGNMENTS: Array<{
  alignment: DocxAlignment;
  label: string;
  icon: () => JSX.Element;
}> = [
  { alignment: 'left', label: 'Align left', icon: () => <TextAlignLeft /> },
  {
    alignment: 'center',
    label: 'Align center',
    icon: () => <TextAlignCenter />,
  },
  { alignment: 'right', label: 'Align right', icon: () => <TextAlignRight /> },
  { alignment: 'justify', label: 'Justify', icon: () => <TextAlignJustify /> },
];

/**
 * Keep the editor's selection: controls act on the caret the user left in
 * the document, so pressing one must not move focus out of it.
 */
const keepEditorFocus = (event: PointerEvent | MouseEvent) => {
  if (!(event.target as HTMLElement).closest('select')) event.preventDefault();
};

/** Formatting and document actions for the DOCX editor. */
export function DocxToolbar(props: DocxToolbarProps) {
  return (
    <div
      class="shrink-0 border-b border-edge-muted"
      onPointerDown={keepEditorFocus}
      onMouseDown={keepEditorFocus}
    >
      {/* Docked under the header like the spreadsheet toolbar, not floating. */}
      <Toolbar
        size="icon-sm"
        aria-label="Document formatting"
        class="flex h-10 w-full min-w-0 gap-0.5 overflow-x-auto overscroll-x-contain rounded-none border-0 bg-transparent px-3 py-0 touch:h-[48px] touch:touch-pan-x touch:px-1 [&_[data-button]]:size-7 [&_[data-button]>svg]:size-[18px]! [&_select]:h-7"
      >
        <Show when={props.canEdit}>
          <Toolbar.Group>
            <Toolbar.Button
              label="Undo"
              shortcut="Mod+Z"
              onClick={() => props.onUndo()}
            >
              <ArrowCounterClockwise />
            </Toolbar.Button>
            <Toolbar.Button
              label="Redo"
              shortcut="Mod+Shift+Z"
              onClick={() => props.onRedo()}
            >
              <ArrowClockwise />
            </Toolbar.Button>
          </Toolbar.Group>
          <Toolbar.Divider class="mx-1.5 my-2.5" />
          <select
            aria-label="Paragraph style"
            class="h-6 max-w-36 rounded-md border border-edge-muted bg-input px-1.5 text-xs text-ink"
            value={props.paragraphStyle ?? ''}
            onChange={(event) =>
              props.onParagraphStyle(event.currentTarget.value)
            }
          >
            <Show
              when={
                !props.paragraphStyles.some(
                  (style) => style.id === props.paragraphStyle
                )
              }
            >
              <option value="">
                {props.paragraphStyle ? 'Custom style' : 'Style'}
              </option>
            </Show>
            <For each={props.paragraphStyles}>
              {(style) => (
                <option
                  value={style.id}
                  selected={style.id === props.paragraphStyle}
                >
                  {style.name}
                </option>
              )}
            </For>
          </select>
          <select
            aria-label="Font"
            class="h-6 max-w-32 rounded-md border border-edge-muted bg-input px-1.5 text-xs text-ink"
            value={props.fontFamily ?? ''}
            onChange={(event) => props.onFontFamily(event.currentTarget.value)}
          >
            <Show
              when={
                props.fontFamily !== null &&
                !FONT_FAMILIES.includes(props.fontFamily)
              }
            >
              <option value={props.fontFamily ?? ''}>{props.fontFamily}</option>
            </Show>
            <For each={FONT_FAMILIES}>
              {(family) => (
                <option value={family} selected={family === props.fontFamily}>
                  {family}
                </option>
              )}
            </For>
          </select>
          <select
            aria-label="Font size"
            class="h-6 w-14 rounded-md border border-edge-muted bg-input px-1 text-xs text-ink"
            value={props.fontSize ?? ''}
            onChange={(event) =>
              props.onFontSize(Number(event.currentTarget.value))
            }
          >
            <Show
              when={
                props.fontSize !== null && !FONT_SIZES.includes(props.fontSize)
              }
            >
              <option value={props.fontSize ?? ''}>{props.fontSize}</option>
            </Show>
            <For each={FONT_SIZES}>
              {(size) => (
                <option value={size} selected={size === props.fontSize}>
                  {size}
                </option>
              )}
            </For>
          </select>
          <Toolbar.Divider class="mx-1.5 my-2.5" />
          <Toolbar.Group>
            <For each={INLINE}>
              {(item) => (
                <Toolbar.Button
                  label={item.label}
                  shortcut={item.shortcut}
                  aria-pressed={!!props.format[item.format]}
                  onClick={() => props.onFormat(item.format)}
                >
                  {item.icon()}
                </Toolbar.Button>
              )}
            </For>
            <ToolbarMenu
              label="Text color"
              icon={<TextAUnderline />}
              testId="color"
              onClose={props.onRefocus}
            >
              <Dropdown.Item onSelect={() => props.onColor(null)}>
                <Swatch hex={null} />
                <span>Automatic</span>
              </Dropdown.Item>
              <For each={TEXT_COLORS}>
                {(c) => (
                  <Dropdown.Item onSelect={() => props.onColor(c.hex)}>
                    <Swatch hex={c.hex} />
                    <span>{c.name}</span>
                    <Show when={props.color === c.hex}>
                      <Check class="ml-auto size-3.5" />
                    </Show>
                  </Dropdown.Item>
                )}
              </For>
            </ToolbarMenu>
            <ToolbarMenu
              label="Highlight"
              icon={<Highlighter />}
              testId="highlight"
              onClose={props.onRefocus}
            >
              <Dropdown.Item onSelect={() => props.onHighlight(null)}>
                <Swatch hex={null} />
                <span>No highlight</span>
              </Dropdown.Item>
              <For each={HIGHLIGHTS}>
                {(h) => (
                  <Dropdown.Item onSelect={() => props.onHighlight(h.value)}>
                    <Swatch hex={h.hex} />
                    <span>{h.name}</span>
                    <Show when={props.highlight === h.value}>
                      <Check class="ml-auto size-3.5" />
                    </Show>
                  </Dropdown.Item>
                )}
              </For>
            </ToolbarMenu>
            <Toolbar.Button
              label="Clear formatting"
              onClick={() => props.onClearFormat()}
            >
              <TextTSlash />
            </Toolbar.Button>
          </Toolbar.Group>
          <Toolbar.Divider class="mx-1.5 my-2.5" />
          <Toolbar.Group>
            <Toolbar.Button
              label="Bulleted list"
              onClick={() => props.onList('bullet')}
            >
              <ListBullets />
            </Toolbar.Button>
            <Toolbar.Button
              label="Numbered list"
              onClick={() => props.onList('number')}
            >
              <ListNumbers />
            </Toolbar.Button>
          </Toolbar.Group>
          <Toolbar.Divider class="mx-1.5 my-2.5" />
          <Toolbar.Group>
            <For each={ALIGNMENTS}>
              {(item) => (
                <Toolbar.Button
                  label={item.label}
                  onClick={() => props.onAlign(item.alignment)}
                >
                  {item.icon()}
                </Toolbar.Button>
              )}
            </For>
            <Toolbar.Button
              label="Decrease indent"
              shortcut="Shift+Tab"
              onClick={() => props.onIndent(false)}
            >
              <TextOutdent />
            </Toolbar.Button>
            <Toolbar.Button
              label="Increase indent"
              onClick={() => props.onIndent(true)}
            >
              <TextIndent />
            </Toolbar.Button>
            <ToolbarMenu
              label="Line spacing"
              icon={<ArrowsDownUp />}
              testId="line-spacing"
              onClose={props.onRefocus}
            >
              <For each={LINE_SPACINGS}>
                {(m) => (
                  <Dropdown.Item onSelect={() => props.onLineSpacing(m)}>
                    <span>{m.toFixed(m === 1.15 ? 2 : 1)}</span>
                    <Show
                      when={
                        props.lineSpacing !== null &&
                        Math.abs(props.lineSpacing - m) < 0.01
                      }
                    >
                      <Check class="ml-auto size-3.5" />
                    </Show>
                  </Dropdown.Item>
                )}
              </For>
            </ToolbarMenu>
          </Toolbar.Group>
          <Toolbar.Divider class="mx-1.5 my-2.5" />
          <Toolbar.Button
            label="Insert table"
            onClick={() => props.onInsertTable()}
          >
            <Table />
          </Toolbar.Button>
          <Show when={props.inBody}>
            <ToolbarMenu
              label="Insert footnote or endnote"
              icon={<AsteriskSimple />}
              testId="notes"
              onClose={props.onRefocus}
            >
              <Dropdown.Item onSelect={() => props.onInsertNote(false)}>
                <span>Footnote</span>
              </Dropdown.Item>
              <Dropdown.Item onSelect={() => props.onInsertNote(true)}>
                <span>Endnote</span>
              </Dropdown.Item>
            </ToolbarMenu>
          </Show>
          <Show when={props.inTable}>
            <ToolbarMenu
              label="Table rows and columns"
              icon={<RowsPlusBottom />}
              testId="table"
              onClose={props.onRefocus}
            >
              <For each={TABLE_OPS}>
                {(item) => (
                  <Dropdown.Item onSelect={() => props.onTable(item.op)}>
                    <span>{item.label}</span>
                  </Dropdown.Item>
                )}
              </For>
            </ToolbarMenu>
          </Show>
          <Toolbar.Divider class="mx-1.5 my-2.5" />
          <Toolbar.Group>
            <Toolbar.Button
              label={props.tracking ? 'Stop tracking changes' : 'Track changes'}
              aria-pressed={props.tracking}
              data-docx-track-changes
              onClick={() => props.onToggleTracking()}
            >
              <GitDiff />
            </Toolbar.Button>
            <Toolbar.Button
              label={
                props.showMarkup
                  ? 'Hide tracked changes'
                  : 'Show tracked changes'
              }
              aria-pressed={props.showMarkup}
              onClick={() => props.onToggleMarkup()}
            >
              <Show when={props.showMarkup} fallback={<EyeSlash />}>
                <Eye />
              </Show>
            </Toolbar.Button>
            <Show when={props.tracking || props.onRevision}>
              <Toolbar.Button
                label="Accept change"
                disabled={!props.onRevision}
                onClick={() => props.onAccept(false)}
              >
                <Check />
              </Toolbar.Button>
              <Toolbar.Button
                label="Reject change"
                disabled={!props.onRevision}
                onClick={() => props.onReject(false)}
              >
                <X />
              </Toolbar.Button>
              <Toolbar.Button
                label="Accept all changes"
                onClick={() => props.onAccept(true)}
              >
                <Checks />
              </Toolbar.Button>
              <Toolbar.Button
                label="Reject all changes"
                onClick={() => props.onReject(true)}
              >
                <XCircle />
              </Toolbar.Button>
            </Show>
          </Toolbar.Group>
          <Toolbar.Divider class="mx-1.5 my-2.5" />
        </Show>
        <Show when={props.canComment}>
          <Toolbar.Button
            label="Comment on selection"
            shortcut="Mod+Alt+M"
            onClick={() => props.onComment()}
          >
            <ChatCircleText />
          </Toolbar.Button>
        </Show>
        <Toolbar.Button
          label="Find and replace"
          shortcut="Mod+F"
          onClick={() => props.onFind()}
        >
          <MagnifyingGlass />
        </Toolbar.Button>
        <Toolbar.Button
          label="Download .docx"
          onClick={() => props.onDownload()}
        >
          <DownloadSimple />
        </Toolbar.Button>
      </Toolbar>
    </div>
  );
}
