import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import { cellMentionQuery } from '@macro-inc/spreadsheet/cell-mentions';
import {
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { CellTextEditorProps } from '../context/spreadsheet-mentions';
import {
  cellTextSelection,
  readCellText,
  setCellTextCursor,
  writeCellText,
} from '../primitives/cell-mention-dom';

export function CellMentionEditor(
  props: CellTextEditorProps & {
    convertPaste: (value: string) => string;
    renderMenu: (
      menu: ReturnType<typeof createMenuOperations>,
      anchor: HTMLElement,
      pick: (value: string) => void
    ) => JSX.Element;
  }
) {
  let root!: HTMLDivElement;
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const menu = createMenuOperations();
  let acceptedValue = props.value;
  let search: ReturnType<typeof cellMentionQuery>;
  const update = () => {
    if (props.readonly || document.activeElement !== root) {
      menu.closeMenu();
      return;
    }
    const selection = cellTextSelection(root);
    if (!selection) return;
    props.onSelectionChange?.(selection.start, selection.end);
    search =
      selection.start === selection.end
        ? cellMentionQuery(readCellText(root), selection.start)
        : undefined;
    if (search) {
      menu.setSearchTerm(search.query);
      menu.openMenu();
    } else menu.closeMenu();
  };
  const publish = () => {
    const value = readCellText(root);
    if (value.length > 10_000) {
      writeCellText(root, acceptedValue);
      setCellTextCursor(root, acceptedValue.length);
      return;
    }
    acceptedValue = value;
    props.onInput(value);
    update();
  };
  const replace = (text: string, start?: number, end?: number) => {
    const selection = cellTextSelection(root);
    const value = readCellText(root);
    const from = start ?? selection?.start ?? value.length;
    const to = end ?? selection?.end ?? from;
    const next = value.slice(0, from) + text + value.slice(to);
    if (next.length > 10_000) return;
    writeCellText(root, next);
    root.focus({ preventScroll: true });
    setCellTextCursor(root, from + text.length);
    publish();
  };
  onMount(() => {
    writeCellText(root, props.value);
    setAnchor(root);
    document.addEventListener('selectionchange', update);
    onCleanup(() => document.removeEventListener('selectionchange', update));
    if (props.autoFocus) {
      root.focus({ preventScroll: true });
      setCellTextCursor(root, props.value.length);
      update();
    }
  });
  createEffect(
    on(
      () => props.value,
      (value) => {
        if (!root || value === acceptedValue) return;
        acceptedValue = value;
        writeCellText(root, value);
      }
    )
  );
  return (
    <>
      <div
        ref={root}
        role="textbox"
        aria-label={props.label}
        aria-readonly={props.readonly}
        data-spreadsheet-input
        contentEditable={!props.readonly}
        tabIndex={0}
        class={`${props.class} whitespace-pre-wrap touch:text-[max(16px,1rem)]`}
        spellcheck={false}
        onFocus={() => {
          props.onFocus?.();
          update();
        }}
        onInput={publish}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.isComposing) return;
          if (event.key === 'Enter' && event.altKey && !props.readonly) {
            event.preventDefault();
            replace('\n');
            return;
          }
          props.onKeyDown(event);
        }}
        onPaste={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!props.readonly)
            replace(
              props.convertPaste(
                event.clipboardData?.getData('text/plain') ?? ''
              )
            );
        }}
        onCopy={(event) => {
          const selected = cellTextSelection(root);
          if (!selected || selected.start === selected.end) return;
          event.preventDefault();
          event.stopPropagation();
          event.clipboardData?.setData(
            'text/plain',
            readCellText(root).slice(selected.start, selected.end)
          );
        }}
        onCut={(event) => {
          const selected = cellTextSelection(root);
          if (!selected || selected.start === selected.end) return;
          event.preventDefault();
          event.stopPropagation();
          event.clipboardData?.setData(
            'text/plain',
            readCellText(root).slice(selected.start, selected.end)
          );
          if (!props.readonly) replace('', selected.start, selected.end);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!props.readonly)
            replace(
              props.convertPaste(
                event.dataTransfer?.getData('text/plain') ?? ''
              )
            );
        }}
        onBlur={() => {
          menu.closeMenu();
          props.onBlur();
        }}
      />
      <Show when={anchor() && menu.isOpen()}>
        <div
          class="contents"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {props.renderMenu(menu, anchor()!, (value) => {
            if (search && !props.readonly)
              replace(value + ' ', search.start, search.end);
            menu.closeMenu();
          })}
        </div>
      </Show>
    </>
  );
}
