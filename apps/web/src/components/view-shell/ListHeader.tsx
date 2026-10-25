import SearchIcon from '@phosphor/magnifying-glass.svg';
import { Button, cn } from '@ui';
import { createSignal, type JSX, onMount, Show } from 'solid-js';
import { SearchBar } from './SearchBar';
import { ViewShell } from './ViewShell';

export function ListHeader(props: {
  title: JSX.Element;
  /** Islands and controls after the title; omit for a title-only header. */
  children?: JSX.Element;
}) {
  return (
    <ViewShell.TopBar class="gap-2 pr-4">
      {/* Both regions clip overflow; the padding keeps control rings unclipped. */}
      <div class="-m-1 min-w-0 flex-1 truncate p-1">{props.title}</div>
      <div class="-m-1 flex min-w-0 max-w-full items-center gap-2 overflow-x-auto p-1 [scrollbar-width:none]">
        {props.children}
      </div>
    </ViewShell.TopBar>
  );
}

/** The query belongs to the view; only the expanded presentation is local. */
export function ListHeaderSearch(props: {
  label: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
  onEscape?: () => void;
  registerFocus: (focus: () => void) => void;
  ref?: (element: HTMLDivElement) => void;
}) {
  const [expanded, setExpanded] = createSignal(Boolean(props.value));
  let input: HTMLInputElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const focus = () => {
    setExpanded(true);
    queueMicrotask(() => {
      input?.focus();
      input?.select();
    });
  };
  const close = () => {
    props.onValueChange('');
    setExpanded(false);
    trigger?.focus();
  };
  onMount(() => props.registerFocus(focus));

  return (
    <div
      ref={props.ref}
      class={cn('shrink-0', expanded() ? 'w-56 max-w-[40cqw] min-w-24' : 'w-8')}
    >
      <Show
        when={expanded()}
        fallback={
          <Button
            ref={trigger}
            variant="outline"
            size="icon-md"
            label={props.label}
            aria-expanded="false"
            onClick={focus}
          >
            <SearchIcon class="size-4" />
          </Button>
        }
      >
        <SearchBar
          ref={input}
          size="sm"
          label={props.label}
          placeholder={props.placeholder ?? props.label}
          value={props.value}
          onValueChange={props.onValueChange}
          onClose={close}
          onEscape={() => {
            close();
            props.onEscape?.();
          }}
        />
      </Show>
    </div>
  );
}
