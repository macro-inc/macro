import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
import { Hotkey, Surface } from '@ui';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { floatWithSelection } from '../../directive/floatWithSelection';

export type InlineFollowupMenuOption = {
  id: string;
  label: JSX.Element;
  hotkey?: string;
  onSelect: () => void;
};

export function InlineFollowupMenu(props: {
  editor: LexicalEditor;
  open: boolean;
  selection?: Selection | null;
  options: readonly InlineFollowupMenuOption[];
  portalScope?: PortalScope;
  useBlockBoundary?: boolean;
  selectedIndex?: number;
  onSelectedIndexChange?: (index: number) => void;
  onClose: () => void;
}) {
  const selectedIndex = () => props.selectedIndex ?? 0;

  const boundedIndex = () => {
    const count = props.options.length;
    if (count === 0) return 0;
    return Math.min(Math.max(selectedIndex(), 0), count - 1);
  };

  createEffect(() => {
    if (!props.open) return;
    const bounded = boundedIndex();
    if (bounded !== selectedIndex()) {
      props.onSelectedIndexChange?.(bounded);
    }
  });

  const moveSelection = (delta: number) => {
    const count = props.options.length;
    if (count <= 1) return;
    props.onSelectedIndexChange?.((boundedIndex() + delta + count) % count);
  };

  const selectCurrent = () => {
    props.options[boundedIndex()]?.onSelect();
  };

  const isReservedNavigationKey = (event: KeyboardEvent) => {
    if (event.key.startsWith('Arrow')) return true;
    return (
      (event.ctrlKey || event.metaKey) &&
      (event.key === 'j' || event.key === 'k')
    );
  };

  const isTypingKey = (event: KeyboardEvent) =>
    event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

  const keyDown = (event: KeyboardEvent) => {
    if (!props.open) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      selectCurrent();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
      return;
    }

    if (isReservedNavigationKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'ArrowUp' || event.key === 'k') moveSelection(-1);
      if (event.key === 'ArrowDown' || event.key === 'j') moveSelection(1);
      return;
    }

    if (!isTypingKey(event)) {
      return;
    }

    props.onClose();
  };

  onMount(() => {
    document.addEventListener('keydown', keyDown, { capture: true });
    onCleanup(() => {
      document.removeEventListener('keydown', keyDown, { capture: true });
    });
  });

  return (
    <Show when={props.open}>
      <ScopedPortal scope={props.portalScope}>
        <div
          class="w-64 max-w-[calc(100cqw-1rem-2px)] cursor-default select-none z-modal-content menu-open-animation"
          ref={(el) => {
            floatWithSelection(el, () => ({
              selection: props.selection,
              reactiveOnContainer: props.editor.getRootElement(),
              useBlockBoundary: props.useBlockBoundary,
            }));
            clickOutside(el, () => () => props.onClose());
          }}
        >
          <Surface
            depth={2}
            class="py-1.5 shadow-lg shadow-drop-shadow rounded-xl"
          >
            <For each={props.options}>
              {(option, index) => (
                <button
                  type="button"
                  class="w-[calc(100%-0.75rem)] flex items-center gap-2 px-2 py-1.5 mx-1.5 text-left text-sm rounded-lg"
                  classList={{
                    'bg-hover': boundedIndex() === index(),
                  }}
                  onMouseEnter={() => props.onSelectedIndexChange?.(index())}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    option.onSelect();
                  }}
                >
                  <span class="min-w-0 flex-1 truncate">{option.label}</span>
                  <Show when={option.hotkey}>
                    {(hotkey) => <Hotkey shortcut={hotkey()} theme="subtle" />}
                  </Show>
                </button>
              )}
            </For>
          </Surface>
        </div>
      </ScopedPortal>
    </Show>
  );
}
