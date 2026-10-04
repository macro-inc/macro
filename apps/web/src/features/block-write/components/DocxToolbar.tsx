import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import ChatCircleText from '@phosphor/chat-circle-text.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import ListBullets from '@phosphor/list-bullets.svg';
import ListNumbers from '@phosphor/list-numbers.svg';
import PencilSimpleLine from '@phosphor/pencil-simple-line.svg';
import Table from '@phosphor/table.svg';
import TextAlignCenter from '@phosphor/text-align-center.svg';
import TextAlignJustify from '@phosphor/text-align-justify.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import TextAlignRight from '@phosphor/text-align-right.svg';
import TextB from '@phosphor/text-b.svg';
import TextItalic from '@phosphor/text-italic.svg';
import TextStrikethrough from '@phosphor/text-strikethrough.svg';
import TextUnderline from '@phosphor/text-underline.svg';
import { Toolbar } from '@ui/components/Toolbar';
import { For, type JSX, Show } from 'solid-js';

export type DocxInlineFormat = 'bold' | 'italic' | 'underline' | 'strike';
export type DocxAlignment = 'left' | 'center' | 'right' | 'justify';
export type DocxParagraphStyle = { id: string; name: string };

/** Font sizes offered in the size picker (points). */
const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

export type DocxToolbarProps = {
  canEdit: boolean;
  canComment: boolean;
  format: Partial<Record<DocxInlineFormat, boolean>>;
  /** Font size at the selection (points). */
  fontSize: number | null;
  paragraphStyle: string | null;
  paragraphStyles: DocxParagraphStyle[];
  /** Tracked changes shown inline (else the document as if accepted). */
  showMarkup: boolean;
  onFormat: (format: DocxInlineFormat) => void;
  onFontSize: (size: number) => void;
  onParagraphStyle: (styleId: string) => void;
  onList: (kind: 'bullet' | 'number') => void;
  onAlign: (alignment: DocxAlignment) => void;
  onUndo: () => void;
  onRedo: () => void;
  onInsertTable: () => void;
  onToggleMarkup: () => void;
  onComment: () => void;
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
];

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
      class="flex w-full shrink-0 justify-center overflow-x-auto px-3 py-2"
      onPointerDown={keepEditorFocus}
      onMouseDown={keepEditorFocus}
    >
      <Toolbar
        size="icon-sm"
        aria-label="Document formatting"
        class="max-w-full"
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
          <Toolbar.Divider />
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
          <Toolbar.Divider />
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
          </Toolbar.Group>
          <Toolbar.Divider />
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
          <Toolbar.Divider />
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
          </Toolbar.Group>
          <Toolbar.Divider />
          <Toolbar.Button
            label="Insert table"
            onClick={() => props.onInsertTable()}
          >
            <Table />
          </Toolbar.Button>
          <Toolbar.Button
            label={
              props.showMarkup ? 'Hide tracked changes' : 'Show tracked changes'
            }
            aria-pressed={props.showMarkup}
            onClick={() => props.onToggleMarkup()}
          >
            <PencilSimpleLine />
          </Toolbar.Button>
          <Toolbar.Divider />
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
          label="Download .docx"
          onClick={() => props.onDownload()}
        >
          <DownloadSimple />
        </Toolbar.Button>
      </Toolbar>
    </div>
  );
}
