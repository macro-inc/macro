import CaretDown from '@phosphor/caret-down.svg';
import CaretUp from '@phosphor/caret-up.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import Swap from '@phosphor/swap.svg';
import TextAa from '@phosphor/text-aa.svg';
import TextT from '@phosphor/text-t.svg';
import X from '@phosphor/x.svg';
import { InputGroup } from '@ui/components/InputGroup';
import { Toolbar } from '@ui/components/Toolbar';
import { createEffect, on, Show } from 'solid-js';

export type DocxFindBarProps = {
  query: string;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
  /** Matches found, and the one being looked at (0-based). */
  count: number;
  current: number | undefined;
  /** More matches exist than were counted. */
  truncated: boolean;
  /** How many matches the last replace all changed. */
  replaced: number | undefined;
  /** The replace field is showing. */
  replacing: boolean;
  canEdit: boolean;
  /** Bumps when the search field should take focus. */
  focusRequest: number;
  onQuery: (query: string) => void;
  onReplacement: (replacement: string) => void;
  onToggleMatchCase: () => void;
  onToggleWholeWord: () => void;
  onToggleReplace: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
};

/** Whether a key press is the platform's find shortcut (Mod+F). */
function isFindKey(event: KeyboardEvent) {
  return (event.metaKey || event.ctrlKey) && event.code === 'KeyF';
}

/** Find and replace over the pages: a search field with the match count,
 * case and whole-word options, and an optional replace field. */
export function DocxFindBar(props: DocxFindBarProps) {
  let search!: HTMLInputElement;

  createEffect(
    on(
      () => props.focusRequest,
      () => {
        search.focus();
        search.select();
      }
    )
  );

  const status = () => {
    if (props.replaced !== undefined && props.count === 0)
      return `Replaced ${props.replaced.toLocaleString()}`;
    if (!props.query) return '';
    if (!props.count) return 'No results';
    const total = `${props.count.toLocaleString()}${props.truncated ? '+' : ''}`;
    return props.current === undefined
      ? total
      : `${(props.current + 1).toLocaleString()} of ${total}`;
  };

  /** Keys shared by both fields. */
  function onKeyDown(event: KeyboardEvent, enter: (shift: boolean) => void) {
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      enter(event.shiftKey);
    } else if (isFindKey(event)) {
      event.preventDefault();
      search.focus();
      search.select();
    } else if ((event.metaKey || event.ctrlKey) && event.code === 'KeyG') {
      event.preventDefault();
      if (event.shiftKey) props.onPrevious();
      else props.onNext();
    }
  }

  return (
    <Toolbar
      size="icon-sm"
      orientation="vertical"
      aria-label="Find in document"
      class="w-[min(26rem,calc(100vw-2rem))] shadow-md"
      data-docx-find
    >
      <div class="flex items-center gap-1">
        <InputGroup size="sm" class="flex-1">
          <InputGroup.Addon>
            <MagnifyingGlass />
          </InputGroup.Addon>
          <InputGroup.Input
            ref={search}
            type="text"
            placeholder="Find in document"
            aria-label="Find in document"
            value={props.query}
            spellcheck={false}
            onInput={(event) => props.onQuery(event.currentTarget.value)}
            onKeyDown={(event) =>
              onKeyDown(event, (shift) =>
                shift ? props.onPrevious() : props.onNext()
              )
            }
            data-docx-find-query
          />
          <InputGroup.Addon align="inline-end">
            <span
              class="whitespace-nowrap text-xs text-ink-muted tabular-nums"
              aria-live="polite"
              data-docx-find-status
            >
              {status()}
            </span>
          </InputGroup.Addon>
        </InputGroup>
        <Toolbar.Button
          label="Match case"
          aria-pressed={props.matchCase}
          onClick={() => props.onToggleMatchCase()}
        >
          <TextAa />
        </Toolbar.Button>
        <Toolbar.Button
          label="Whole words only"
          aria-pressed={props.wholeWord}
          onClick={() => props.onToggleWholeWord()}
        >
          <TextT />
        </Toolbar.Button>
        <Toolbar.Button
          label="Previous match"
          shortcut="Shift+Enter"
          disabled={!props.count}
          onClick={() => props.onPrevious()}
        >
          <CaretUp />
        </Toolbar.Button>
        <Toolbar.Button
          label="Next match"
          shortcut="Enter"
          disabled={!props.count}
          onClick={() => props.onNext()}
        >
          <CaretDown />
        </Toolbar.Button>
        <Show when={props.canEdit}>
          <Toolbar.Button
            label={props.replacing ? 'Hide replace' : 'Replace'}
            aria-pressed={props.replacing}
            onClick={() => props.onToggleReplace()}
            data-docx-find-replace-toggle
          >
            <Swap />
          </Toolbar.Button>
        </Show>
        <Toolbar.Button
          label="Close"
          shortcut="Escape"
          onClick={() => props.onClose()}
        >
          <X />
        </Toolbar.Button>
      </div>
      <Show when={props.canEdit && props.replacing}>
        <div class="flex items-center gap-1">
          <InputGroup size="sm" class="flex-1">
            <InputGroup.Input
              type="text"
              placeholder="Replace with"
              aria-label="Replace with"
              value={props.replacement}
              spellcheck={false}
              onInput={(event) =>
                props.onReplacement(event.currentTarget.value)
              }
              onKeyDown={(event) => onKeyDown(event, () => props.onReplace())}
              data-docx-find-replacement
            />
          </InputGroup>
          <Toolbar.Button
            size="sm"
            variant="outline"
            disabled={props.current === undefined}
            onClick={() => props.onReplace()}
            data-docx-replace
          >
            Replace
          </Toolbar.Button>
          <Toolbar.Button
            size="sm"
            variant="outline"
            disabled={!props.count}
            onClick={() => props.onReplaceAll()}
            data-docx-replace-all
          >
            Replace all
          </Toolbar.Button>
        </div>
      </Show>
    </Toolbar>
  );
}
