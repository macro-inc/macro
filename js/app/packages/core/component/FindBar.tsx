import CaretDown from '@icon/regular/caret-down.svg';
import CaretUp from '@icon/regular/caret-up.svg';
import MagnifyingGlass from '@icon/regular/magnifying-glass.svg';
import X from '@icon/regular/x.svg';
import { Button } from '@ui/components/Button';
import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  createContext,
  type JSX,
  onCleanup,
  onMount,
  Show,
  useContext,
} from 'solid-js';
import type { FindBarController } from './createFindBarController';

/**
 * Which physical key advances the cursor. `'asc'` — ArrowDown/Enter advance,
 * ArrowUp/Shift+Enter retreat. `'desc'` — flipped, for surfaces where the
 * natural reading direction is bottom-to-top (e.g. a chat channel).
 */
export type FindBarDirection = 'asc' | 'desc';

type FindBarContextValue = {
  controller: FindBarController;
  direction: Accessor<FindBarDirection>;
};

const FindBarContext = createContext<FindBarContextValue>();

function useFindBarContext(): FindBarContextValue {
  const ctx = useContext(FindBarContext);
  if (!ctx)
    throw new Error('FindBar sub-components must render inside <FindBar>');
  return ctx;
}

export type FindBarProps = {
  controller: FindBarController;
  direction?: FindBarDirection;
  placeholder?: string;
  autofocus?: boolean;
  class?: string;
  /**
   * Override the default layout. Sub-components (`FindBar.SubmitButton`,
   * `FindBar.Input`, etc.) read state from the FindBar context.
   */
  children?: JSX.Element;
};

export function FindBar(props: FindBarProps) {
  const direction: Accessor<FindBarDirection> = () => props.direction ?? 'asc';

  return (
    <FindBarContext.Provider
      value={{ controller: props.controller, direction }}
    >
      <div
        class={cn(
          'flex items-center gap-1 rounded-md border border-edge bg-panel p-1 shadow-md focus-within:border-accent',
          props.class
        )}
      >
        <Show
          when={props.children}
          fallback={
            <FindBarDefaultLayout
              placeholder={props.placeholder}
              autofocus={props.autofocus}
            />
          }
        >
          {props.children}
        </Show>
      </div>
    </FindBarContext.Provider>
  );
}

function FindBarDefaultLayout(props: {
  placeholder?: string;
  autofocus?: boolean;
}) {
  return (
    <>
      <FindBarSubmitButton />
      <FindBarInput
        placeholder={props.placeholder}
        autofocus={props.autofocus}
      />
      <FindBarCount />
      <FindBarPreviousButton />
      <FindBarNextButton />
      <FindBarCloseButton />
    </>
  );
}

function FindBarSubmitButton() {
  const { controller } = useFindBarContext();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Search"
      onClick={() => controller.submit()}
      classList={{
        '!text-accent':
          !controller.hasUnsubmittedChanges() && !!controller.query().trim(),
      }}
    >
      <MagnifyingGlass />
    </Button>
  );
}

function FindBarInput(props: { placeholder?: string; autofocus?: boolean }) {
  const { controller, direction } = useFindBarContext();
  let inputEl: HTMLInputElement | undefined;

  onMount(() => {
    if (!inputEl) return;
    controller.setInputEl(inputEl);
    if (props.autofocus !== false) inputEl.focus();
  });

  onCleanup(() => controller.setInputEl(undefined));

  const handleKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (
    e
  ) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      controller.close();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (controller.hasUnsubmittedChanges() && !e.shiftKey) {
        controller.submit();
      } else if (e.shiftKey) {
        controller.previous();
      } else {
        controller.next();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (direction() === 'desc') controller.previous();
      else controller.next();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (direction() === 'desc') controller.next();
      else controller.previous();
    }
  };

  return (
    <input
      ref={inputEl}
      type="text"
      class="min-w-0 flex-1 bg-transparent border-0 px-1 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-0"
      placeholder={props.placeholder ?? 'Find'}
      value={controller.query()}
      onInput={(e) => controller.setQuery(e.currentTarget.value)}
      onKeyDown={handleKeyDown}
    />
  );
}

function FindBarCount() {
  const { controller } = useFindBarContext();
  const showCount = () =>
    !!controller.submittedQuery() &&
    !controller.hasUnsubmittedChanges() &&
    !controller.isPending();

  return (
    <span
      class="px-1 text-xs text-ink-muted tabular-nums whitespace-nowrap"
      classList={{ invisible: !showCount() }}
    >
      {controller.activeIndex()}/{controller.resultsCount()}
    </span>
  );
}

function FindBarPreviousButton() {
  const { controller, direction } = useFindBarContext();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={direction() === 'desc' ? 'Next match' : 'Previous match'}
      onClick={() =>
        direction() === 'desc' ? controller.next() : controller.previous()
      }
    >
      <CaretUp />
    </Button>
  );
}

function FindBarNextButton() {
  const { controller, direction } = useFindBarContext();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={direction() === 'desc' ? 'Previous match' : 'Next match'}
      onClick={() =>
        direction() === 'desc' ? controller.previous() : controller.next()
      }
    >
      <CaretDown />
    </Button>
  );
}

function FindBarCloseButton() {
  const { controller } = useFindBarContext();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Close find bar"
      onClick={() => controller.close()}
    >
      <X />
    </Button>
  );
}

FindBar.SubmitButton = FindBarSubmitButton;
FindBar.Input = FindBarInput;
FindBar.Count = FindBarCount;
FindBar.PreviousButton = FindBarPreviousButton;
FindBar.NextButton = FindBarNextButton;
FindBar.CloseButton = FindBarCloseButton;
