import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import Clipboard from '@phosphor/clipboard-text.svg';
import Download from '@phosphor/download-simple.svg';
import Eraser from '@phosphor/eraser.svg';
import Eye from '@phosphor/eye.svg';
import FileCsv from '@phosphor/file-csv.svg';
import FileXls from '@phosphor/file-xls.svg';
import Sliders from '@phosphor/sliders-horizontal.svg';
import SortAscending from '@phosphor/sort-ascending.svg';
import SortDescending from '@phosphor/sort-descending.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import Upload from '@phosphor/upload-simple.svg';
import { Dropdown } from '@ui/components/Dropdown';
import type { JSX, ParentProps } from 'solid-js';
import type {
  SpreadsheetCommand,
  SpreadsheetToolbarProps,
} from '../core/toolbar-types';

function ActionMenu(
  props: ParentProps<{
    label: string;
    icon: JSX.Element;
    disabled?: boolean;
    placement?: 'bottom-start' | 'top-end';
    onRestoreFocus?: () => void;
  }>
) {
  let dismissedByPointer = false;
  return (
    <Dropdown placement={props.placement ?? 'bottom-start'} modal={false}>
      <Dropdown.Trigger
        size="icon-sm"
        variant="ghost"
        label={props.label}
        disabled={props.disabled}
        class="h-7 w-7 min-h-7 min-w-7 shrink-0 rounded-md p-1 text-ink-muted touch:h-[44px] touch:w-[44px] touch:min-h-[44px] touch:min-w-[44px]"
      >
        {props.icon}
      </Dropdown.Trigger>
      <Dropdown.Content
        class="min-w-56 max-h-[min(30rem,70dvh)] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain touch:text-[max(14px,0.875rem)] touch:[&_[role=menuitem]]:min-h-[44px] touch:[&_[role=menuitemcheckbox]]:min-h-[44px]"
        onPointerDownOutside={() => {
          dismissedByPointer = true;
        }}
        onCloseAutoFocus={(event) => {
          const preservePointerFocus = dismissedByPointer;
          dismissedByPointer = false;
          if (preservePointerFocus) return;
          if (!props.onRestoreFocus) return;
          event.preventDefault();
          queueMicrotask(() => props.onRestoreFocus?.());
        }}
      >
        {props.children}
      </Dropdown.Content>
    </Dropdown>
  );
}

export function PasteMenu(props: SpreadsheetToolbarProps) {
  return (
    <ActionMenu
      label="Paste special"
      icon={<Clipboard class="size-[18px]" />}
      disabled={props.readonly}
      onRestoreFocus={props.onRestoreFocus}
    >
      <Dropdown.Group>
        <Dropdown.Item
          closeOnSelect
          disabled={props.readonly}
          onSelect={() => props.onCommand('paste')}
        >
          Paste
        </Dropdown.Item>
        <Dropdown.Item
          closeOnSelect
          disabled={props.readonly}
          onSelect={() => props.onCommand('paste-values')}
        >
          Paste values only
        </Dropdown.Item>
      </Dropdown.Group>
    </ActionMenu>
  );
}

export function ViewMenu(props: SpreadsheetToolbarProps) {
  return (
    <ActionMenu
      label="View options"
      icon={<Eye class="size-[18px]" />}
      onRestoreFocus={props.onRestoreFocus}
    >
      <Dropdown.Group>
        <Dropdown.CheckboxItem
          checked={props.showGridlines}
          onChange={() => props.onCommand('toggle-gridlines')}
        >
          Gridlines
        </Dropdown.CheckboxItem>
        <Dropdown.CheckboxItem
          checked={props.showFormulaBar}
          onChange={() => props.onCommand('toggle-formula-bar')}
        >
          Formula bar
        </Dropdown.CheckboxItem>
        <Dropdown.CheckboxItem
          checked={props.showFormulas}
          onChange={() => props.onCommand('toggle-formulas')}
        >
          Formulas
        </Dropdown.CheckboxItem>
      </Dropdown.Group>
    </ActionMenu>
  );
}

export function DataFormatMenu(props: SpreadsheetToolbarProps) {
  return (
    <ActionMenu
      label="Format and data"
      icon={<Sliders class="size-[18px]" />}
      disabled={props.readonly}
      onRestoreFocus={props.onRestoreFocus}
    >
      <Dropdown.Group>
        <Dropdown.Item
          closeOnSelect
          disabled={props.readonly}
          onSelect={() => props.onCommand('sort-asc')}
        >
          <SortAscending class="size-4" />
          Sort selected range A → Z
        </Dropdown.Item>
        <Dropdown.Item
          closeOnSelect
          disabled={props.readonly}
          onSelect={() => props.onCommand('sort-desc')}
        >
          <SortDescending class="size-4" />
          Sort selected range Z → A
        </Dropdown.Item>
        <Dropdown.Item
          closeOnSelect
          disabled={props.readonly}
          onSelect={() => props.onCommand('trim-whitespace')}
        >
          <TextAlignLeft class="size-4" />
          Trim whitespace
        </Dropdown.Item>
      </Dropdown.Group>
      <Dropdown.Group>
        <Dropdown.Item
          closeOnSelect
          disabled={props.readonly}
          onSelect={() => props.onCommand('fill-down')}
        >
          <ArrowDown class="size-4" />
          Fill down
        </Dropdown.Item>
        <Dropdown.Item
          closeOnSelect
          disabled={props.readonly}
          onSelect={() => props.onCommand('fill-right')}
        >
          <ArrowRight class="size-4" />
          Fill right
        </Dropdown.Item>
      </Dropdown.Group>
      <Dropdown.Group>
        <Dropdown.Item
          closeOnSelect
          disabled={props.readonly}
          onSelect={() => props.onCommand('clear-formatting')}
        >
          <Eraser class="size-4" />
          Clear formatting
        </Dropdown.Item>
        <Dropdown.Item
          closeOnSelect
          disabled={props.readonly}
          onSelect={() => props.onCommand('clear-values')}
        >
          Clear values
        </Dropdown.Item>
      </Dropdown.Group>
    </ActionMenu>
  );
}

export function SpreadsheetFileMenu(props: {
  readonly: boolean;
  canExport: boolean;
  onCommand: (command: SpreadsheetCommand) => void;
  onRestoreFocus?: () => void;
}) {
  return (
    <ActionMenu
      label="Import and export"
      icon={<Download class="size-[18px]" />}
      placement="top-end"
      onRestoreFocus={props.onRestoreFocus}
    >
      <Dropdown.Group>
        <Dropdown.Item
          closeOnSelect
          disabled={props.readonly}
          onSelect={() => props.onCommand('import')}
        >
          <Upload class="size-4" />
          Import…
        </Dropdown.Item>
      </Dropdown.Group>
      <Dropdown.Group>
        <Dropdown.Item
          closeOnSelect
          disabled={!props.canExport}
          onSelect={() => props.onCommand('export-xlsx')}
        >
          <FileXls class="size-4" />
          Download as Excel (.xlsx)
        </Dropdown.Item>
        <Dropdown.Item
          closeOnSelect
          disabled={!props.canExport}
          onSelect={() => props.onCommand('export-csv')}
        >
          <FileCsv class="size-4" />
          Download as CSV
        </Dropdown.Item>
      </Dropdown.Group>
    </ActionMenu>
  );
}
