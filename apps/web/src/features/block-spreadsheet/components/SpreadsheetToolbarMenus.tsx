import AlignMiddle from '@phosphor/align-center-vertical-simple.svg';
import Check from '@phosphor/check.svg';
import PaintBucket from '@phosphor/paint-bucket.svg';
import Sigma from '@phosphor/sigma.svg';
import Table from '@phosphor/table.svg';
import TextColor from '@phosphor/text-a-underline.svg';
import TextAlignCenter from '@phosphor/text-align-center.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import TextAlignRight from '@phosphor/text-align-right.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { For, type JSX, Match, type ParentProps, Show, Switch } from 'solid-js';
import {
  SPREADSHEET_FUNCTIONS,
  SPREADSHEET_NUMBER_FORMATS,
  SPREADSHEET_ZOOM_LEVELS,
  type SpreadsheetToolbarProps,
} from '../core/toolbar-types';

function ToolbarMenu(
  props: ParentProps<{
    label: string;
    trigger: JSX.Element;
    disabled?: boolean;
    narrow?: boolean;
    onRestoreFocus?: () => void;
  }>
) {
  let dismissedByPointer = false;
  return (
    <Dropdown placement="bottom-start" modal={false}>
      <Dropdown.Trigger
        size="sm"
        variant="ghost"
        label={props.label}
        disabled={props.disabled}
        class="h-7 min-h-7 gap-1 rounded-[3px] px-1.5 text-[13px] font-normal text-ink-muted touch:h-[44px] touch:min-h-[44px] touch:min-w-[44px] touch:px-2 touch:text-[max(14px,0.875rem)]"
      >
        {props.trigger}
        <span
          aria-hidden="true"
          class="ml-0.5 h-0 w-0 shrink-0 border-x-[4px] border-t-[4px] border-x-transparent border-t-current opacity-70"
        />
      </Dropdown.Trigger>
      <Dropdown.Content
        onPointerDownOutside={() => {
          dismissedByPointer = true;
        }}
        onCloseAutoFocus={(event) => {
          const preservePointerFocus = dismissedByPointer;
          dismissedByPointer = false;
          if (preservePointerFocus) return;
          if (!props.onRestoreFocus) return;
          event.preventDefault();
          // Kobalte restores its trigger after this callback, even when the
          // event is cancelled. Reclaim editor focus after that teardown.
          queueMicrotask(() => props.onRestoreFocus?.());
        }}
        class="max-h-[min(30rem,70dvh)] max-w-[calc(100vw-1rem)] overflow-y-auto text-sm text-ink overscroll-contain touch:text-[max(14px,0.875rem)]"
        classList={{ 'min-w-28': props.narrow, 'min-w-52': !props.narrow }}
      >
        <Dropdown.Group>{props.children}</Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

function Choice(
  props: ParentProps<{
    selected?: boolean;
    disabled?: boolean;
    description?: string;
    onSelect: () => void;
  }>
) {
  return (
    <Dropdown.Item
      closeOnSelect
      disabled={props.disabled}
      onSelect={props.onSelect}
      class="h-8 gap-2 touch:h-auto touch:min-h-[44px]"
    >
      <span class="flex size-3.5 items-center text-accent">
        <Show when={props.selected}>
          <Check class="size-3.5" />
        </Show>
      </span>
      <span class="flex-1">{props.children}</span>
      <Show when={props.description}>
        <span class="pl-4 text-[13px] text-ink-extra-muted">
          {props.description}
        </span>
      </Show>
    </Dropdown.Item>
  );
}

export function ZoomMenu(props: SpreadsheetToolbarProps) {
  return (
    <ToolbarMenu
      onRestoreFocus={props.onRestoreFocus}
      label="Zoom"
      narrow
      trigger={<span class="w-12 text-center tabular-nums">{props.zoom}%</span>}
    >
      <For each={SPREADSHEET_ZOOM_LEVELS}>
        {(zoom) => (
          <Choice
            selected={props.zoom === zoom}
            onSelect={() => props.onZoom(zoom)}
          >
            {zoom}%
          </Choice>
        )}
      </For>
    </ToolbarMenu>
  );
}

export function NumberFormatMenu(props: SpreadsheetToolbarProps) {
  return (
    <ToolbarMenu
      onRestoreFocus={props.onRestoreFocus}
      label="Number format"
      disabled={props.readonly}
      trigger={<span class="text-[13px]">123</span>}
    >
      <For each={SPREADSHEET_NUMBER_FORMATS}>
        {(format) => (
          <Choice
            disabled={props.readonly}
            selected={(props.cell?.format ?? 'general') === format.value}
            description={format.example}
            onSelect={() => props.onStyle({ format: format.value })}
          >
            {format.label}
          </Choice>
        )}
      </For>
    </ToolbarMenu>
  );
}

const FONT_FAMILIES = [
  { value: 'sans', label: 'Sans serif', font: 'var(--font-sans)' },
  { value: 'serif', label: 'Serif', font: 'Georgia, serif' },
  { value: 'mono', label: 'Monospace', font: 'var(--font-mono)' },
] as const;

export function FontFamilyMenu(props: SpreadsheetToolbarProps) {
  return (
    <ToolbarMenu
      onRestoreFocus={props.onRestoreFocus}
      label="Font family"
      disabled={props.readonly}
      trigger={
        <span class="w-20 text-left">
          {FONT_FAMILIES.find((font) => font.value === props.cell?.fontFamily)
            ?.label ?? 'Sans serif'}
        </span>
      }
    >
      <For each={FONT_FAMILIES}>
        {(font) => (
          <Choice
            disabled={props.readonly}
            selected={(props.cell?.fontFamily ?? 'sans') === font.value}
            onSelect={() => props.onStyle({ fontFamily: font.value })}
          >
            <span style={{ 'font-family': font.font }}>{font.label}</span>
          </Choice>
        )}
      </For>
    </ToolbarMenu>
  );
}

// These are document colors, rather than application theme colors.
const CELL_COLORS = [
  { value: '#000000', name: 'Black' },
  { value: '#434343', name: 'Charcoal' },
  { value: '#666666', name: 'Gray' },
  { value: '#b7b7b7', name: 'Light gray' },
  { value: '#d9d9d9', name: 'Silver' },
  { value: '#ffffff', name: 'White' },
  { value: '#ea4335', name: 'Red' },
  { value: '#ff9900', name: 'Orange' },
  { value: '#fbbc04', name: 'Yellow' },
  { value: '#34a853', name: 'Green' },
  { value: '#4285f4', name: 'Blue' },
  { value: '#a142f4', name: 'Purple' },
  { value: '#f4cccc', name: 'Light red' },
  { value: '#fce5cd', name: 'Light orange' },
  { value: '#fff2cc', name: 'Light yellow' },
  { value: '#d9ead3', name: 'Light green' },
  { value: '#cfe2f3', name: 'Light blue' },
  { value: '#d9d2e9', name: 'Light purple' },
] as const;

export function CellColorMenu(
  props: SpreadsheetToolbarProps & { kind: 'textColor' | 'fillColor' }
) {
  const label = () =>
    props.kind === 'textColor' ? 'Text color' : 'Fill color';
  return (
    <ToolbarMenu
      onRestoreFocus={props.onRestoreFocus}
      label={label()}
      disabled={props.readonly}
      trigger={
        <span class="relative flex h-5 items-center pb-0.5">
          <Show
            when={props.kind === 'textColor'}
            fallback={<PaintBucket class="size-[18px]" />}
          >
            <TextColor class="size-[18px]" />
          </Show>
          <span
            class="absolute inset-x-0 bottom-0 h-0.5 rounded-sm"
            style={{
              'background-color':
                props.cell?.[props.kind] ||
                (props.kind === 'textColor'
                  ? 'var(--color-ink)'
                  : 'var(--color-edge)'),
            }}
          />
        </span>
      }
    >
      <Choice
        disabled={props.readonly}
        selected={!props.cell?.[props.kind]}
        onSelect={() => props.onStyle({ [props.kind]: '' })}
      >
        {props.kind === 'textColor' ? 'Automatic' : 'No fill'}
      </Choice>
      <div class="grid grid-cols-6 gap-1 p-2 touch:grid-cols-5">
        <For each={CELL_COLORS}>
          {(color) => (
            <Dropdown.Item
              disabled={props.readonly}
              closeOnSelect
              aria-label={`${label()}: ${color.name}`}
              title={color.name}
              textValue={color.name}
              onSelect={() => props.onStyle({ [props.kind]: color.value })}
              class="size-6 touch:size-[44px] justify-center rounded-sm border border-edge-muted p-0 data-highlighted:ring-2 data-highlighted:ring-accent"
              style={{ 'background-color': color.value }}
            >
              <Show when={props.cell?.[props.kind] === color.value}>
                <Check class="size-3.5 rounded-sm bg-menu text-ink" />
              </Show>
            </Dropdown.Item>
          )}
        </For>
      </div>
    </ToolbarMenu>
  );
}

export function BorderMenu(props: SpreadsheetToolbarProps) {
  return (
    <ToolbarMenu
      onRestoreFocus={props.onRestoreFocus}
      label="Borders"
      disabled={props.readonly}
      trigger={<Table class="size-[18px]" />}
    >
      <Choice
        disabled={props.readonly}
        onSelect={() => props.onCommand('border-all')}
      >
        All borders
      </Choice>
      <Choice
        disabled={props.readonly}
        onSelect={() => props.onCommand('border-outer')}
      >
        Outer borders
      </Choice>
      <Choice
        disabled={props.readonly}
        onSelect={() => props.onStyle({ borderBottom: true })}
      >
        Bottom border
      </Choice>
      <Choice
        disabled={props.readonly}
        onSelect={() => props.onStyle({ borderTop: true })}
      >
        Top border
      </Choice>
      <Choice
        disabled={props.readonly}
        onSelect={() => props.onStyle({ borderLeft: true })}
      >
        Left border
      </Choice>
      <Choice
        disabled={props.readonly}
        onSelect={() => props.onStyle({ borderRight: true })}
      >
        Right border
      </Choice>
      <Choice
        disabled={props.readonly}
        onSelect={() => props.onCommand('border-none')}
      >
        Clear borders
      </Choice>
    </ToolbarMenu>
  );
}

export function AlignmentMenu(props: SpreadsheetToolbarProps) {
  return (
    <ToolbarMenu
      onRestoreFocus={props.onRestoreFocus}
      label="Horizontal alignment"
      disabled={props.readonly}
      trigger={
        <Switch fallback={<TextAlignLeft class="size-[18px]" />}>
          <Match when={props.cell?.horizontalAlign === 'center'}>
            <TextAlignCenter class="size-[18px]" />
          </Match>
          <Match when={props.cell?.horizontalAlign === 'right'}>
            <TextAlignRight class="size-[18px]" />
          </Match>
        </Switch>
      }
    >
      <For each={['auto', 'left', 'center', 'right'] as const}>
        {(align) => (
          <Choice
            disabled={props.readonly}
            selected={(props.cell?.horizontalAlign ?? 'auto') === align}
            onSelect={() => props.onStyle({ horizontalAlign: align })}
          >
            {align === 'auto'
              ? 'Automatic'
              : align[0].toUpperCase() + align.slice(1)}
          </Choice>
        )}
      </For>
    </ToolbarMenu>
  );
}

export function VerticalAlignmentMenu(props: SpreadsheetToolbarProps) {
  return (
    <ToolbarMenu
      onRestoreFocus={props.onRestoreFocus}
      label="Vertical alignment"
      disabled={props.readonly}
      trigger={<AlignMiddle class="size-[18px]" />}
    >
      <For each={['top', 'middle', 'bottom'] as const}>
        {(align) => (
          <Choice
            disabled={props.readonly}
            selected={(props.cell?.verticalAlign ?? 'middle') === align}
            onSelect={() => props.onStyle({ verticalAlign: align })}
          >
            {align[0].toUpperCase() + align.slice(1)}
          </Choice>
        )}
      </For>
    </ToolbarMenu>
  );
}

export function FunctionMenu(props: SpreadsheetToolbarProps) {
  return (
    <ToolbarMenu
      onRestoreFocus={props.onRestoreFocus}
      label="Functions"
      disabled={props.readonly}
      trigger={<Sigma class="size-[18px]" />}
    >
      <For each={SPREADSHEET_FUNCTIONS}>
        {(item) => (
          <Choice
            disabled={props.readonly}
            description={item.description}
            onSelect={() => props.onCommand(item.command)}
          >
            {item.name}
          </Choice>
        )}
      </For>
    </ToolbarMenu>
  );
}
