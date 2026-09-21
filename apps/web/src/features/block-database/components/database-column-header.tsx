import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import ArrowDownIcon from '@phosphor/arrow-down.svg';
import ArrowUpIcon from '@phosphor/arrow-up.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import XIcon from '@phosphor/x.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js';
import type { DatabaseViewColumn } from '../core/database-view';
import { PropertyIcon } from './property-icon';

export type DatabaseColumnHeaderProps = {
  column: DatabaseViewColumn;
  sortDirection?: 'asc' | 'desc';
  canRename?: boolean;
  onRename?: (
    columnId: string,
    name: string,
    previousName: string
  ) => Promise<void>;
  onSort: (columnId: string, direction: 'asc' | 'desc' | null) => void;
  onHide?: (columnId: string) => void;
  onMove?: (columnId: string, direction: 'left' | 'right') => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
};

/** Header interactions stay local; the host supplies the persisted rename. */
export function DatabaseColumnHeader(props: DatabaseColumnHeaderProps) {
  const [draft, setDraft] = createSignal<{
    id: string;
    name: string;
    previousName: string;
  }>();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [menuOpen, setMenuOpen] = createSignal(false);
  const errorId = createUniqueId();
  let header!: HTMLDivElement;
  let input: HTMLInputElement | undefined;
  let mounted = true;
  onCleanup(() => {
    mounted = false;
  });
  const canRename = () => !!props.canRename && !!props.onRename;
  const restoreFocus = () =>
    queueMicrotask(() => header?.isConnected && header.focus());
  const rename = () => {
    if (!canRename() || pending()) return;
    setMenuOpen(false);
    setError('');
    setDraft({
      id: props.column.id,
      name: props.column.name,
      previousName: props.column.name,
    });
    queueMicrotask(() => {
      input?.focus();
      input?.select();
    });
  };
  const cancel = () => {
    if (pending()) return;
    setDraft(undefined);
    setError('');
    restoreFocus();
  };
  const save = async () => {
    const current = draft();
    const onRename = props.onRename;
    if (!current || pending() || !canRename() || !onRename) return;
    const name = current.name.trim();
    if (!name) {
      setError('Enter a column name.');
      return;
    }
    if (name === current.previousName) {
      cancel();
      return;
    }
    setPending(true);
    setError('');
    try {
      await onRename(current.id, name, current.previousName);
      if (!mounted) return;
      setDraft(undefined);
      restoreFocus();
    } catch (caught) {
      if (mounted)
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not rename this column. Try again.'
        );
    } finally {
      if (mounted) setPending(false);
    }
  };
  const actions = () => [
    ...(canRename() ? [{ label: 'Rename column', run: rename }] : []),
    {
      label: 'Sort ascending',
      run: () => props.onSort(props.column.id, 'asc'),
    },
    {
      label: 'Sort descending',
      run: () => props.onSort(props.column.id, 'desc'),
    },
    ...(props.sortDirection
      ? [
          {
            label: 'Remove sort',
            run: () => props.onSort(props.column.id, null),
          },
        ]
      : []),
    ...(props.onMove
      ? [
          {
            label: 'Move left',
            disabled: !props.canMoveLeft,
            run: () => props.onMove?.(props.column.id, 'left'),
          },
          {
            label: 'Move right',
            disabled: !props.canMoveRight,
            run: () => props.onMove?.(props.column.id, 'right'),
          },
        ]
      : []),
    ...(props.onHide
      ? [{ label: 'Hide column', run: () => props.onHide?.(props.column.id) }]
      : []),
  ];
  return (
    <ContextMenu>
      <ContextMenu.Trigger
        as="div"
        ref={header}
        role="columnheader"
        aria-label={props.column.name}
        aria-sort={
          props.sortDirection === 'asc'
            ? 'ascending'
            : props.sortDirection === 'desc'
              ? 'descending'
              : 'none'
        }
        aria-keyshortcuts={canRename() ? 'F2 Shift+F10' : 'Shift+F10'}
        tabIndex={draft() ? -1 : 0}
        disabled={!!draft()}
        class="relative min-w-0 border-r border-edge-muted/50 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/50 [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ink/50"
        onDblClick={(event: MouseEvent & { currentTarget: HTMLDivElement }) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.closest('button, input')
          )
            return;
          event.preventDefault();
          rename();
        }}
        onKeyDown={(
          event: KeyboardEvent & { currentTarget: HTMLDivElement }
        ) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'F2' && canRename()) {
            event.preventDefault();
            event.stopPropagation();
            rename();
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setMenuOpen(true);
          } else if (
            event.key === 'ContextMenu' ||
            (event.shiftKey && event.key === 'F10')
          ) {
            event.preventDefault();
            event.stopPropagation();
            const bounds = event.currentTarget.getBoundingClientRect();
            event.currentTarget.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: bounds.left,
                clientY: bounds.bottom,
              })
            );
          }
        }}
      >
        <Show
          when={draft()}
          fallback={
            <div
              class="flex min-h-10 items-center gap-2 px-3 text-xs font-medium text-ink-muted"
              title={canRename() ? 'Double-click to rename' : undefined}
            >
              <PropertyIcon
                type={props.column.dataType}
                entityType={props.column.specificEntityType}
              />
              <span class="min-w-0 flex-1 truncate">{props.column.name}</span>
              <Show when={props.sortDirection}>
                <Show
                  when={props.sortDirection === 'asc'}
                  fallback={
                    <ArrowDownIcon class="size-3 shrink-0 text-accent" />
                  }
                >
                  <ArrowUpIcon class="size-3 shrink-0 text-accent" />
                </Show>
              </Show>
              <Dropdown open={menuOpen()} onOpenChange={setMenuOpen}>
                <Dropdown.Trigger
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${props.column.name} column menu`}
                >
                  <CaretDownIcon class="size-3" />
                </Dropdown.Trigger>
                <Dropdown.Content
                  class="min-w-44"
                  onCloseAutoFocus={(event) => {
                    if (draft()) event.preventDefault();
                  }}
                >
                  <Dropdown.Group>
                    <Dropdown.GroupLabel>
                      {props.column.name}
                    </Dropdown.GroupLabel>
                    <For each={actions()}>
                      {(action) => (
                        <Dropdown.Item
                          disabled={'disabled' in action && action.disabled}
                          onSelect={action.run}
                        >
                          {action.label}
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            </div>
          }
        >
          {(current) => (
            <div
              class="flex min-h-10 items-center gap-1 px-1.5"
              aria-busy={pending()}
            >
              <input
                ref={input}
                aria-label="Column name"
                aria-invalid={!!error()}
                aria-describedby={error() ? errorId : undefined}
                maxlength={200}
                value={current().name}
                readOnly={pending()}
                class="h-8 min-w-0 flex-1 rounded border border-ink/40 bg-input px-2 text-xs text-ink outline-none focus:ring-2 focus:ring-ink/20"
                onInput={(event) => {
                  setDraft({ ...current(), name: event.currentTarget.value });
                  setError('');
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.isComposing || event.keyCode === 229) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void save();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancel();
                  }
                }}
              />
              <button
                type="button"
                aria-label={
                  error() ? 'Retry rename column' : 'Save column name'
                }
                disabled={pending()}
                class="shrink-0 rounded p-1 text-accent hover:bg-hover disabled:opacity-40"
                onClick={() => void save()}
              >
                <CheckIcon class="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Cancel rename column"
                disabled={pending()}
                class="shrink-0 rounded p-1 text-ink-muted hover:bg-hover disabled:opacity-40"
                onClick={cancel}
              >
                <XIcon class="size-3.5" />
              </button>
            </div>
          )}
        </Show>
        <Show when={error()}>
          <p
            id={errorId}
            role="alert"
            class="absolute top-full left-0 z-2 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-failure-ink/20 bg-panel p-2 text-xs font-normal text-failure-ink shadow-md"
          >
            {error()}
          </p>
        </Show>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent
          class="min-w-44"
          onCloseAutoFocus={(event) => {
            if (draft()) event.preventDefault();
          }}
        >
          <For each={actions()}>
            {(action) => (
              <MenuItem
                text={action.label}
                disabled={'disabled' in action && action.disabled}
                onClick={action.run}
                closeOnSelect
              />
            )}
          </For>
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
