import { registerHotkey } from '@core/hotkey/hotkeys';
import { fireAndForget } from '@core/util/fireAndForget';
import { isEditableInput } from '@core/util/isEditableInput';
import {
  type EntityData,
  ListEntity,
  ListLayoutProvider,
  type SearchLocation,
} from '@entity';
import { Button, createCommandListController } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  on,
  Show,
} from 'solid-js';

/** Global Search rows, including message snippets, in a host-owned collection. */
export function EmbeddedSearchResults(props: {
  items: EntityData[];
  loading: boolean;
  error?: string;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
  scopeId: string;
  revision: string;
  canHandleKeyboard?: Accessor<boolean>;
  onOpen: (
    entity: EntityData,
    newSplit: boolean,
    location?: SearchLocation
  ) => void;
}) {
  const list = createCommandListController({ items: () => props.items });
  const [navigating, setNavigating] = createSignal(false);
  createEffect(
    on(
      () => props.revision,
      () => {
        setNavigating(false);
        list.setSelectedIndex(0);
      }
    )
  );
  const accepts = (event?: KeyboardEvent) =>
    !!event &&
    !event.isComposing &&
    event.target instanceof Element &&
    !!isEditableInput(event.target) &&
    props.canHandleKeyboard?.() !== false;
  const options = {
    scopeId: props.scopeId,
    runWithInputFocused: true,
    hide: true,
  };
  for (const [hotkey, direction] of [
    ['arrowdown', 1],
    ['arrowup', -1],
  ] as const) {
    registerHotkey({
      ...options,
      hotkey,
      description: 'Navigate search results',
      keyDownHandler: (event) => {
        if (!accepts(event) || !props.items.length) return false;
        if (!navigating()) {
          setNavigating(true);
          list.setSelectedIndex(direction === 1 ? 0 : props.items.length - 1, {
            scrollIntoView: true,
          });
        } else if (direction === 1) list.selectNext();
        else list.selectPrevious();
        return true;
      },
    });
  }
  registerHotkey({
    ...options,
    hotkey: 'enter',
    description: 'Open search result',
    keyDownHandler: (event) => {
      if (!accepts(event) || event?.shiftKey || !navigating()) return false;
      const item = list.selectedItem();
      if (!item) return false;
      props.onOpen(item, false);
      return true;
    },
  });
  registerHotkey({
    ...options,
    hotkey: 'escape',
    description: 'Exit search navigation',
    keyDownHandler: (event) => {
      if (!accepts(event) || !navigating()) return false;
      setNavigating(false);
      return true;
    },
  });
  const [container, setContainer] = createSignal<HTMLDivElement>();
  createEffect(() => {
    const index = list.selectedIndex();
    if (!navigating() || !list.shouldScrollSelectedIntoView()) return;
    container()
      ?.querySelectorAll<HTMLElement>('[role="option"]')
      [index]?.scrollIntoView({ block: 'nearest' });
  });
  return (
    <div class="space-y-2">
      <Show when={props.error}>
        <p role="alert" class="text-sm text-failure">
          {props.error}
        </p>
      </Show>
      <div
        ref={setContainer}
        role="listbox"
        aria-label="Search results"
        aria-busy={props.loading}
        class="soup-list max-h-80 overflow-auto"
      >
        <ListLayoutProvider ref={container} narrowLayout="single-line">
          <For
            each={props.items}
            fallback={
              <p role="status" class="px-3 py-6 text-sm text-ink-muted">
                {props.loading ? 'Searching…' : 'No results found'}
              </p>
            }
          >
            {(entity, index) => (
              <div
                role="option"
                aria-label={entity.name}
                aria-selected={navigating() && list.selectedIndex() === index()}
              >
                <ListEntity
                  entity={entity}
                  hideCheckbox
                  highlighted={navigating() && list.selectedIndex() === index()}
                  onMouseMove={() => {
                    setNavigating(true);
                    list.setSelectedIndexFromPointer(index());
                  }}
                  onClick={(event) => props.onOpen(entity, event.shiftKey)}
                  onContentHitClick={(event, location) => {
                    event.stopPropagation();
                    props.onOpen(entity, event.shiftKey, location);
                  }}
                />
              </div>
            )}
          </For>
        </ListLayoutProvider>
      </div>
      <Show when={props.hasMore}>
        <Button
          variant="ghost"
          disabled={props.loadingMore}
          onClick={() => fireAndForget(props.loadMore(), 'universal-input')}
        >
          {props.loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      </Show>
    </div>
  );
}
