/**
 * Section header rows of the slide rail and sorter, as in PowerPoint: a caret
 * that collapses the section's thumbnails, the name (renamed in place) and
 * slide count. Clicking a header selects its slides; dragging it onto
 * another header moves the section there. Also the right-click menu of a
 * header.
 */

import { MenuItem, MenuSeparator } from '@core/component/ContextMenu';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Trash from '@phosphor/trash.svg';
import CaretRight from '@phosphor-fill/caret-right-fill.svg';
import { createSignal, For, Show } from 'solid-js';
import type { SectionRow } from '../core/sections';
import type { DeckSetup } from '../primitives/create-deck-setup';

/** Returns focus to the slide list after renaming in place. */
const focusList = (el: HTMLElement) =>
  el.closest<HTMLElement>('[data-testid="pptx-slide-list"]')?.focus();

/**
 * Focuses the name field once no menu holds focus: Rename Section is picked
 * in a menu that keeps focus until it has closed.
 */
function claimFocus(el: HTMLInputElement, tries = 40) {
  if (!el.isConnected) return;
  if (document.activeElement?.closest('[role="menu"]')) {
    if (tries > 0) setTimeout(() => claimFocus(el, tries - 1), 25);
    return;
  }
  el.focus();
  el.select();
}

function SectionHeader(props: {
  setup: DeckSetup;
  row: SectionRow;
  grid?: boolean;
  readonly: boolean;
}) {
  const s = props.setup.sections;
  const id = () => props.row.section.id;
  const name = () => props.row.section.name;
  const count = () => props.row.section.slideIds.length;
  const collapsed = () => s.isCollapsed(id());
  const renaming = () => s.renaming() === id();
  const selected = () => s.isSelected(id());
  const [dropTarget, setDropTarget] = createSignal(false);
  const finish = (input: HTMLInputElement, value: string | null) => {
    if (!renaming()) return;
    focusList(input);
    s.finishRename(id(), value);
  };

  return (
    <div
      data-testid="pptx-section-header"
      data-section-id={id()}
      aria-expanded={!collapsed()}
      title={`${name()} (${count()} slide${count() === 1 ? '' : 's'})`}
      class="relative flex min-w-0 select-none items-center gap-1 rounded-sm"
      classList={{
        'h-6 px-0.5 text-xs': !props.grid,
        'col-span-full h-8 border-edge-muted border-b px-1 text-sm':
          !!props.grid,
        'bg-accent-bg text-accent': selected(),
        'text-ink': !selected(),
        'ring-1 ring-accent': dropTarget(),
      }}
      draggable={!props.readonly && !renaming()}
      onClick={() => s.select(id())}
      onDblClick={() => s.toggleCollapsed(id())}
      // A right press selects the section its menu is for.
      onPointerDown={(e) => {
        if (e.button === 2 && !selected()) s.select(id());
      }}
      onDragStart={(e) => {
        s.setDragging(id());
        e.dataTransfer?.setData('text/plain', name());
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        const from = s.dragging();
        if (!from || from === id()) return;
        e.preventDefault();
        setDropTarget(true);
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropTarget(false);
        const from = s.dragging();
        s.setDragging(null);
        if (from && from !== id()) s.moveTo(from, props.row.index);
      }}
      onDragEnd={() => {
        s.setDragging(null);
        setDropTarget(false);
      }}
    >
      <button
        type="button"
        data-testid="pptx-section-toggle"
        aria-label={`${collapsed() ? 'Expand' : 'Collapse'} section ${name()}`}
        aria-expanded={!collapsed()}
        class="flex size-4 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-ink/10 hover:text-ink"
        onClick={(e) => {
          e.stopPropagation();
          s.toggleCollapsed(id());
        }}
        onDblClick={(e) => e.stopPropagation()}
      >
        <CaretRight
          class="size-2.5 transition-transform"
          classList={{ 'rotate-90': !collapsed() }}
        />
      </button>
      <Show
        when={renaming()}
        fallback={
          <button
            type="button"
            class="min-w-0 truncate text-left font-medium outline-none focus-visible:underline"
          >
            {name()}
          </button>
        }
      >
        <input
          ref={(el) => setTimeout(() => claimFocus(el), 0)}
          type="text"
          data-testid="pptx-section-rename"
          aria-label="Section name"
          value={name()}
          class="h-5 min-w-0 flex-1 rounded-sm border border-accent bg-input px-1 text-ink outline-none"
          onClick={(e) => e.stopPropagation()}
          onDblClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          // Keys, text, and the clipboard stay in the field (the rail would
          // act on slides).
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              finish(e.currentTarget, e.currentTarget.value);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              finish(e.currentTarget, null);
            }
          }}
          onCopy={(e) => e.stopPropagation()}
          onCut={(e) => e.stopPropagation()}
          onPaste={(e) => e.stopPropagation()}
          onBlur={(e) => finish(e.currentTarget, e.currentTarget.value)}
        />
      </Show>
      <span class="shrink-0 text-ink-muted tabular-nums">({count()})</span>
    </div>
  );
}

/** The headers of the sections that start before slide `before`. */
export function SectionHeaders(props: {
  setup: DeckSetup;
  before: number;
  grid?: boolean;
  readonly: boolean;
}) {
  return (
    <For each={props.setup.sections.headersBefore(props.before)}>
      {(id) => (
        <Show when={props.setup.sections.row(id)}>
          {(row) => (
            <SectionHeader
              setup={props.setup}
              row={row()}
              grid={props.grid}
              readonly={props.readonly}
            />
          )}
        </Show>
      )}
    </For>
  );
}

/** Right-click menu of a section header. */
export function SectionMenuItems(props: {
  setup: DeckSetup;
  id: string;
  readonly: boolean;
}) {
  const s = props.setup.sections;
  const ro = () => props.readonly;
  return (
    <>
      <MenuItem
        text="Rename Section"
        icon={PencilSimple}
        disabled={ro()}
        onClick={() => s.startRename(props.id)}
      />
      <MenuItem
        text="Remove Section"
        disabled={ro()}
        onClick={() => s.remove(props.id)}
      />
      <MenuItem
        text="Remove Section & Slides"
        icon={Trash}
        disabled={ro() || s.holdsEverySlide(props.id)}
        onClick={() => s.remove(props.id, true)}
      />
      <MenuItem
        text="Remove All Sections"
        disabled={ro()}
        onClick={s.removeAll}
      />
      <MenuSeparator />
      <MenuItem
        text="Move Section Up"
        icon={ArrowUp}
        disabled={ro() || !s.canMove(props.id, -1)}
        onClick={() => s.move(props.id, -1)}
      />
      <MenuItem
        text="Move Section Down"
        icon={ArrowDown}
        disabled={ro() || !s.canMove(props.id, 1)}
        onClick={() => s.move(props.id, 1)}
      />
      <MenuSeparator />
      <MenuItem text="Collapse All" onClick={s.collapseAll} />
      <MenuItem text="Expand All" onClick={s.expandAll} />
    </>
  );
}
