import ArrowBendDownRight from '@phosphor/arrow-bend-down-right.svg';
import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import CommentIcon from '@phosphor/chat-circle.svg';
import Check from '@phosphor/check.svg';
import CurrencyDollar from '@phosphor/currency-dollar.svg';
import FunctionIcon from '@phosphor/function.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import Minus from '@phosphor/minus.svg';
import Percent from '@phosphor/percent.svg';
import Plus from '@phosphor/plus.svg';
import TextB from '@phosphor/text-b.svg';
import TextItalic from '@phosphor/text-italic.svg';
import TextStrikethrough from '@phosphor/text-strikethrough.svg';
import TextUnderline from '@phosphor/text-underline.svg';
import X from '@phosphor/x.svg';
import { Button, type ButtonProps } from '@ui/components/Button';
import { Show } from 'solid-js';
import type { SpreadsheetMentions } from '../context/spreadsheet-mentions';
import type { FormulaTextSelection } from '../core/formula-reference';
import type { SpreadsheetToolbarProps } from '../core/toolbar-types';
import type { CompleteFormula } from '../primitives/create-formula-assistance';
import { createTouchPress } from '../primitives/create-touch-press';
import { FormulaInput } from './FormulaInput';
import { DataFormatMenu, PasteMenu, ViewMenu } from './SpreadsheetActionMenus';
import {
  AlignmentMenu,
  BorderMenu,
  CellColorMenu,
  FontFamilyMenu,
  FunctionMenu,
  NumberFormatMenu,
  VerticalAlignmentMenu,
  ZoomMenu,
} from './SpreadsheetToolbarMenus';

function ToolbarButton(props: ButtonProps) {
  return (
    <Button
      {...props}
      size="icon-sm"
      class="h-7 w-7 min-h-7 min-w-7 rounded-[3px] p-1 font-normal touch:h-[44px] touch:w-[44px] touch:min-h-[44px] touch:min-w-[44px]"
    />
  );
}

function Divider() {
  return (
    <div aria-hidden="true" class="mx-1.5 h-5 w-px shrink-0 bg-edge-muted" />
  );
}

function FontSizeControl(props: SpreadsheetToolbarProps) {
  const size = () => props.cell?.fontSize ?? 10;
  const setSize = (value: number) => {
    if (Number.isFinite(value))
      props.onStyle({ fontSize: Math.max(8, Math.min(36, Math.round(value))) });
  };
  return (
    <div class="flex shrink-0 items-center gap-0.5">
      <ToolbarButton
        size="icon-sm"
        label="Decrease font size"
        disabled={props.readonly || size() <= 8}
        onClick={() => setSize(size() - 1)}
      >
        <Minus class="size-[18px]" />
      </ToolbarButton>
      <input
        aria-label="Font size"
        title="Font size"
        inputmode="numeric"
        type="number"
        min={8}
        max={36}
        value={size()}
        disabled={props.readonly}
        class="h-7 w-9 touch:h-[44px] touch:w-[44px] touch:text-[max(16px,1rem)] appearance-none rounded-[3px] border border-edge-muted bg-transparent text-center text-[13px] text-ink outline-none focus:border-accent disabled:opacity-40 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onChange={(event) => {
          setSize(Number(event.currentTarget.value));
          event.currentTarget.value = String(size());
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
            props.onRestoreFocus?.();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.value = String(size());
            event.currentTarget.blur();
            props.onRestoreFocus?.();
          }
        }}
      />
      <ToolbarButton
        size="icon-sm"
        label="Increase font size"
        disabled={props.readonly || size() >= 36}
        onClick={() => setSize(size() + 1)}
      >
        <Plus class="size-[18px]" />
      </ToolbarButton>
    </div>
  );
}

function TextStyleControls(props: SpreadsheetToolbarProps) {
  return (
    <>
      <ToolbarButton
        size="icon-sm"
        label="Bold"
        tooltip="Bold (⌘/Ctrl B)"
        aria-pressed={!!props.cell?.bold}
        variant={props.cell?.bold ? 'accent' : 'ghost'}
        disabled={props.readonly}
        onClick={() => props.onStyle({ bold: !props.cell?.bold })}
      >
        <TextB class="size-[18px]" />
      </ToolbarButton>
      <ToolbarButton
        size="icon-sm"
        label="Italic"
        tooltip="Italic (⌘/Ctrl I)"
        aria-pressed={!!props.cell?.italic}
        variant={props.cell?.italic ? 'accent' : 'ghost'}
        disabled={props.readonly}
        onClick={() => props.onStyle({ italic: !props.cell?.italic })}
      >
        <TextItalic class="size-[18px]" />
      </ToolbarButton>
      <ToolbarButton
        size="icon-sm"
        label="Strikethrough"
        aria-pressed={!!props.cell?.strikethrough}
        variant={props.cell?.strikethrough ? 'accent' : 'ghost'}
        disabled={props.readonly}
        onClick={() =>
          props.onStyle({ strikethrough: !props.cell?.strikethrough })
        }
      >
        <TextStrikethrough class="size-[18px]" />
      </ToolbarButton>
      <ToolbarButton
        size="icon-sm"
        label="Underline"
        tooltip="Underline (⌘/Ctrl U)"
        aria-pressed={!!props.cell?.underline}
        variant={props.cell?.underline ? 'accent' : 'ghost'}
        disabled={props.readonly}
        onClick={() => props.onStyle({ underline: !props.cell?.underline })}
      >
        <TextUnderline class="size-[18px]" />
      </ToolbarButton>
    </>
  );
}

export function SpreadsheetToolbar(props: SpreadsheetToolbarProps) {
  const decimals = () =>
    props.cell?.decimals != null && props.cell.decimals >= 0
      ? props.cell.decimals
      : 2;
  return (
    <div class="shrink-0 border-b border-edge-muted">
      <div
        role="toolbar"
        aria-label="Spreadsheet formatting"
        class="flex h-10 min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain px-3 touch:h-[48px] touch:touch-pan-x touch:px-1"
      >
        <ToolbarButton
          size="icon-sm"
          label="Undo"
          tooltip="Undo (⌘/Ctrl Z)"
          disabled={props.readonly || !props.canUndo}
          onClick={() => props.onCommand('undo')}
        >
          <ArrowCounterClockwise class="size-[18px]" />
        </ToolbarButton>
        <ToolbarButton
          size="icon-sm"
          label="Redo"
          tooltip="Redo (⌘/Ctrl Shift Z)"
          disabled={props.readonly || !props.canRedo}
          onClick={() => props.onCommand('redo')}
        >
          <ArrowClockwise class="size-[18px]" />
        </ToolbarButton>
        <PasteMenu {...props} />
        <Divider />
        <ZoomMenu {...props} />
        <ViewMenu {...props} />
        <Divider />
        <ToolbarButton
          size="icon-sm"
          label="Format as currency"
          disabled={props.readonly}
          onClick={() => props.onStyle({ format: 'currency' })}
        >
          <CurrencyDollar class="size-[18px]" />
        </ToolbarButton>
        <ToolbarButton
          size="icon-sm"
          label="Format as percent"
          disabled={props.readonly}
          onClick={() => props.onStyle({ format: 'percent' })}
        >
          <Percent class="size-[18px]" />
        </ToolbarButton>
        <ToolbarButton
          size="icon-sm"
          label="Decrease decimal places"
          disabled={props.readonly || decimals() === 0}
          onClick={() => props.onStyle({ decimals: decimals() - 1 })}
        >
          <span class="font-sans text-[11px] font-normal tracking-tight">
            .0←
          </span>
        </ToolbarButton>
        <ToolbarButton
          size="icon-sm"
          label="Increase decimal places"
          disabled={props.readonly || decimals() === 10}
          onClick={() => props.onStyle({ decimals: decimals() + 1 })}
        >
          <span class="font-sans text-[11px] font-normal tracking-tight">
            .00→
          </span>
        </ToolbarButton>
        <NumberFormatMenu {...props} />
        <Divider />
        <FontFamilyMenu {...props} />
        <FontSizeControl {...props} />
        <Divider />
        <TextStyleControls {...props} />
        <CellColorMenu {...props} kind="textColor" />
        <CellColorMenu {...props} kind="fillColor" />
        <Divider />
        <BorderMenu {...props} />
        <AlignmentMenu {...props} />
        <VerticalAlignmentMenu {...props} />
        <ToolbarButton
          size="icon-sm"
          label="Wrap text"
          aria-pressed={!!props.cell?.wrap}
          variant={props.cell?.wrap ? 'accent' : 'ghost'}
          disabled={props.readonly}
          onClick={() => props.onStyle({ wrap: !props.cell?.wrap })}
        >
          <ArrowBendDownRight class="size-[18px]" />
        </ToolbarButton>
        <Divider />
        <FunctionMenu {...props} />
        <DataFormatMenu {...props} />
        <ToolbarButton
          size="icon-sm"
          label="Find and replace"
          tooltip="Find and replace (⌘/Ctrl F)"
          onClick={() => props.onCommand('find')}
        >
          <MagnifyingGlass class="size-[18px]" />
        </ToolbarButton>
        <Show when={props.onComment}>
          <Divider />
          <Button
            size="sm"
            variant="ghost"
            class="shrink-0 h-7 gap-1.5 px-2 text-[13px] touch:min-h-[44px]"
            disabled={!props.canComment}
            onClick={() => props.onComment?.()}
            tooltip="Comment on selected cells (⌘/Ctrl Alt M)"
          >
            <CommentIcon class="size-[18px]" />
            Comment
          </Button>
        </Show>
        <Show when={props.readonly}>
          <span class="ml-auto shrink-0 px-2 text-[10px] text-ink-muted">
            View only
          </span>
        </Show>
      </div>
    </div>
  );
}

export function FormulaBar(props: {
  mentions?: SpreadsheetMentions;
  address: string;
  value: string;
  readonly: boolean;
  editing?: boolean;
  complete: CompleteFormula;
  selectionRequest?: FormulaTextSelection;
  pickingReference?: boolean;
  onSelectionChange?: (start: number, end: number) => void;
  onNavigate: (address: string) => void;
  onEdit: () => void;
  onInput: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onReturnToGrid: () => void;
}) {
  const commitPress = createTouchPress(
    () => {
      props.onCommit();
      props.onReturnToGrid();
    },
    () => props.readonly || !props.editing
  );
  const cancelPress = createTouchPress(
    () => {
      props.onCancel();
      props.onReturnToGrid();
    },
    () => props.readonly || !props.editing
  );
  return (
    <div class="flex h-7 shrink-0 items-center border-b border-edge-muted font-sans text-[13px] touch:h-[44px]">
      <input
        aria-label="Go to cell"
        class="h-full w-24 shrink-0 border-r border-edge-muted bg-transparent px-3 font-sans text-ink outline-none focus:bg-accent-bg touch:w-18 touch:px-2 touch:text-[max(16px,1rem)]"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        enterkeyhint="go"
        value={props.address}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            props.onNavigate(event.currentTarget.value);
            event.currentTarget.value = props.address;
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.value = props.address;
            props.onReturnToGrid();
          }
        }}
        onBlur={(event) => {
          event.currentTarget.value = props.address;
        }}
      />
      <FunctionIcon class="mx-2 size-3.5 shrink-0 text-ink-subtle" />
      <FormulaInput
        mentions={props.mentions}
        label="Formula bar"
        complete={props.complete}
        selectionRequest={props.selectionRequest}
        pickingReference={props.pickingReference}
        onSelectionChange={props.onSelectionChange}
        placeholder={
          props.readonly
            ? 'Select a cell to inspect its value'
            : 'Enter a value or formula, like =SUM(A1:A10)'
        }
        readonly={props.readonly}
        class="h-full min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-1 pr-3 font-sans text-[13px] leading-[18px] text-ink outline-none placeholder:text-ink-placeholder touch:py-[12px] touch:pr-1 touch:text-[max(16px,1rem)] touch:leading-[20px]"
        value={props.value}
        onFocus={props.onEdit}
        onInput={props.onInput}
        onBlur={props.onCommit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.isComposing) return;
          if (event.key === 'Enter' && !event.altKey) {
            event.preventDefault();
            props.onCommit();
            (event.currentTarget as HTMLTextAreaElement).blur();
            props.onReturnToGrid();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            props.onCancel();
            (event.currentTarget as HTMLTextAreaElement).blur();
            props.onReturnToGrid();
          }
        }}
      />
      <Show when={props.editing && !props.readonly}>
        <div
          class="hidden shrink-0 items-center touch:flex"
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
        >
          <Button
            {...cancelPress}
            label="Cancel edit"
            size="icon-sm"
            class="size-[44px]"
          >
            <X class="size-5" />
          </Button>
          <Button
            {...commitPress}
            label="Apply edit"
            size="icon-sm"
            variant="accent"
            class="size-[44px]"
          >
            <Check class="size-5" />
          </Button>
        </div>
      </Show>
    </div>
  );
}
