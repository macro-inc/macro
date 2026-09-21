import { Popover } from '@kobalte/core/popover';
import ChatIcon from '@phosphor/chat-circle.svg';
import CheckIcon from '@phosphor/check.svg';
import TaskIcon from '@phosphor/check-square.svg';
import EmailIcon from '@phosphor/envelope.svg';
import FileIcon from '@phosphor/file.svg';
import FolderIcon from '@phosphor/folder.svg';
import ChannelIcon from '@phosphor/hash.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import UserGlyph from '@phosphor/user.svg';
import { Tooltip } from '@ui/components/Tooltip';
import {
  createSignal,
  createUniqueId,
  ErrorBoundary,
  For,
  type JSX,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { DatabaseMentionPickerProps } from '../component/GridCell';
import type { DatabaseEntityType } from '../core/column-inference';
import type {
  DatabaseMentionCandidate,
  DatabaseMentionSource,
} from '../core/database-mentions';

function mentionTypeLabel(type: DatabaseEntityType): string {
  return match(type)
    .with('USER', () => 'Person')
    .with('DOCUMENT', () => 'Document')
    .with('TASK', () => 'Task')
    .with('CHANNEL', () => 'Channel')
    .with('PROJECT', () => 'Project')
    .with('CHAT', () => 'Chat')
    .with('THREAD', () => 'Email')
    .with('COMPANY', () => 'Company')
    .with('CALL_RECORD', () => 'Call')
    .with('CALENDAR_EVENT', () => 'Event')
    .exhaustive();
}

function MentionIcon(props: { type: DatabaseEntityType }) {
  const icon = () =>
    match(props.type)
      .with('USER', () => UserGlyph)
      .with('TASK', () => TaskIcon)
      .with('CHANNEL', () => ChannelIcon)
      .with('PROJECT', () => FolderIcon)
      .with('CHAT', () => ChatIcon)
      .with('THREAD', () => EmailIcon)
      .otherwise(() => FileIcon);
  return (
    <span
      aria-hidden="true"
      class="flex size-4 shrink-0 items-center text-ink-muted"
    >
      <Dynamic component={icon()} class="size-4" />
    </span>
  );
}

export function DatabaseMentionChoices(
  props: DatabaseMentionPickerProps & { source: DatabaseMentionSource }
) {
  const [activeKey, setActiveKey] = createSignal<string>();
  const [loadError, setLoadError] = createSignal(false);
  const listId = createUniqueId();
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  const key = (item: DatabaseMentionCandidate) =>
    `${item.entityType}:${item.id}`;
  const activeIndex = () =>
    Math.max(
      0,
      props.source.items().findIndex((item) => key(item) === activeKey())
    );
  const active = () => props.source.items()[activeIndex()];
  const choose = (item: DatabaseMentionCandidate, direction?: 1 | -1) => {
    props.onSelect(
      { id: item.id, entityType: item.entityType, label: item.label },
      direction
    );
  };
  const move = (direction: 1 | -1) => {
    const items = props.source.items();
    if (!items.length) return;
    const index = (activeIndex() + direction + items.length) % items.length;
    setActiveKey(key(items[index]));
    list
      ?.querySelector<HTMLElement>(`[data-mention-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };
  const loadMore = async () => {
    if (props.source.loadingMore()) return;
    setLoadError(false);
    try {
      await props.source.loadMore();
    } catch {
      setLoadError(true);
    }
  };
  onMount(() => input?.focus());
  return (
    <div class="flex min-h-0 w-80 max-w-[calc(100vw-1.5rem)] flex-col">
      <div class="flex shrink-0 items-center gap-2 border-b border-edge-muted px-3 py-2">
        <SearchIcon class="size-4 shrink-0 text-ink-muted" />
        <input
          ref={input}
          role="combobox"
          aria-label="Search mentions"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={
            active() ? `${listId}-${activeIndex()}` : undefined
          }
          value={props.search}
          placeholder={
            props.specificEntityType === 'USER'
              ? 'Find a person…'
              : 'Find a person or item…'
          }
          class="h-7 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
          onInput={(event) => {
            const next = event.currentTarget.value;
            setActiveKey(undefined);
            props.onSearchChange?.(next);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              const item = active();
              if (item)
                choose(
                  item,
                  event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : undefined
                );
              else if (event.key === 'Tab') props.onClose();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              props.onClose();
            }
          }}
        />
      </div>
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Mention suggestions"
        class="min-h-0 max-h-64 overflow-y-auto overscroll-contain p-1"
      >
        <For each={props.source.items()}>
          {(item, index) => (
            <button
              type="button"
              role="option"
              tabIndex={-1}
              id={`${listId}-${index()}`}
              data-mention-index={index()}
              aria-selected={index() === activeIndex()}
              class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-ink outline-none"
              classList={{ 'bg-hover': index() === activeIndex() }}
              onMouseDown={(event) => event.preventDefault()}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setActiveKey(key(item))}
              onClick={() => choose(item)}
            >
              <MentionIcon type={item.entityType} />
              <span class="min-w-0 flex-1">
                <span class="block truncate">{item.label}</span>
                <span class="block truncate text-[11px] text-ink-muted">
                  {item.description || mentionTypeLabel(item.entityType)}
                </span>
              </span>
              <Show when={props.value === item.id}>
                <CheckIcon class="size-3.5 shrink-0 text-ink-muted" />
              </Show>
            </button>
          )}
        </For>
      </div>
      <Show when={!props.source.items().length}>
        <p
          role="status"
          class="shrink-0 px-3 py-4 text-center text-xs text-ink-muted"
        >
          {props.source.loading() ? 'Loading…' : 'No matches'}
        </p>
      </Show>
      <Show when={props.source.hasMore()}>
        <button
          type="button"
          disabled={props.source.loadingMore()}
          class="w-full shrink-0 border-t border-edge-muted px-3 py-2 text-left text-xs text-ink-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/50"
          onClick={() => void loadMore()}
        >
          {props.source.loadingMore() ? 'Loading…' : 'Show more'}
        </button>
      </Show>
      <Show when={loadError()}>
        <p role="alert" class="shrink-0 px-3 py-2 text-xs text-failure">
          Could not load more. Try again.
        </p>
      </Show>
    </div>
  );
}

export function DatabaseMentionPopover(
  props: DatabaseMentionPickerProps & { children: JSX.Element }
) {
  return (
    <Popover
      open
      anchorRef={() => props.anchor}
      placement="bottom-start"
      gutter={4}
      fitViewport
      overlap
      overflowPadding={8}
      onOpenChange={(open) => !open && props.onClose(false)}
    >
      <Popover.Portal>
        <Popover.Content
          class="z-action-menu flex min-h-0 flex-col overflow-hidden rounded-lg border border-edge bg-menu text-ink shadow-menu outline-none"
          style={{
            'max-height':
              'min(28rem, var(--kb-popper-content-available-height, calc(100dvh - 1rem)), calc(100dvh - 1rem))',
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            props.onClose();
          }}
        >
          <Popover.Title class="sr-only">Choose a mention</Popover.Title>
          <ErrorBoundary
            fallback={
              <div class="w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto p-3">
                <p role="alert" class="text-xs text-ink-muted">
                  Mentions could not be loaded.
                </p>
                <button
                  type="button"
                  class="mt-2 rounded px-2 py-1 text-xs text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                  onClick={() => props.onClose()}
                >
                  Close
                </button>
              </div>
            }
          >
            <Suspense
              fallback={
                <p role="status" class="p-3 text-xs text-ink-muted">
                  Loading…
                </p>
              }
            >
              {props.children}
            </Suspense>
          </ErrorBoundary>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

export function DatabaseMentionLabel(props: {
  name: string;
  icon: JSX.Element;
  entityType: DatabaseEntityType;
}) {
  return (
    <Tooltip
      as="span"
      label={props.name || mentionTypeLabel(props.entityType)}
      class="min-w-0 max-w-full"
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <span
          class="pointer-events-none flex size-4 shrink-0 items-center"
          aria-hidden="true"
        >
          {props.icon}
        </span>
        <span class="truncate">
          {props.name || mentionTypeLabel(props.entityType)}
        </span>
      </span>
    </Tooltip>
  );
}

export function DatabaseMentionPlaceholder(props: {
  entityType: DatabaseEntityType;
}) {
  return (
    <span class="truncate text-ink-muted">
      {mentionTypeLabel(props.entityType)}
    </span>
  );
}
