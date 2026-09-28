import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import type { EditorState } from '@codemirror/state';
import { type EditorView, runScopeHandlers } from '@codemirror/view';
import ReplaceAllIcon from '@phosphor/arrow-bend-double-up-right.svg';
import ReplaceIcon from '@phosphor/arrow-bend-up-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import CaretUp from '@phosphor/caret-up.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import X from '@phosphor/x.svg';
import { Button, Surface } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';

/**
 * Counting every match in a huge file on each keystroke isn't worth it, so the
 * tally saturates and the label reads `1000+`.
 */
const MATCH_COUNT_LIMIT = 1000;

type MatchCount = {
  total: number;
  /** 1-based index of the match the selection currently sits on, else 0. */
  current: number;
  capped: boolean;
};

function countMatches(query: SearchQuery, state: EditorState): MatchCount {
  if (!query.valid) return { total: 0, current: 0, capped: false };

  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;

  for (let match = cursor.next(); !match.done; match = cursor.next()) {
    total += 1;
    if (match.value.from === from && match.value.to === to) current = total;
    if (total >= MATCH_COUNT_LIMIT) return { total, current, capped: true };
  }

  return { total, current, capped: false };
}

function ModifierToggle(props: {
  glyph: string;
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      size="icon-sm"
      variant={props.active ? 'accent' : 'ghost'}
      tooltip={props.label}
      aria-pressed={props.active}
      onClick={props.onToggle}
    >
      <span class="font-mono text-xxs leading-none">{props.glyph}</span>
    </Button>
  );
}

/**
 * CodeMirror's search commands locate the field to focus and select through a
 * `main-field` attribute, which isn't part of the JSX attribute types.
 */
function markAsMainField(element: HTMLInputElement) {
  element.setAttribute('main-field', 'true');
}

const FIELD_CLASS =
  'flex h-7 w-56 max-w-full min-w-0 shrink items-center gap-1.5 rounded-md px-2';

const INPUT_CLASS =
  'min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder focus:outline-none focus:ring-0';

export type CodeSearchPanelProps = {
  view: EditorView;
  /** Editor state as of the last update the panel was notified about. */
  state: EditorState;
};

/**
 * Find (and, when the document is editable, replace) bar for the code block's
 * CodeMirror instance. Installed through `search({ createPanel })` so that
 * CodeMirror keeps highlighting matches for us; viewers without edit access get
 * the find half only, since `EditorState.readOnly` rejects replacements.
 */
export function CodeSearchPanel(props: CodeSearchPanelProps) {
  const [replaceOpen, setReplaceOpen] = createSignal(false);

  const query = createMemo(() => getSearchQuery(props.state));
  const matches = createMemo(() => countMatches(query(), props.state));
  const canReplace = () => !props.state.readOnly;

  const commit = (
    changes: Partial<{
      search: string;
      caseSensitive: boolean;
      regexp: boolean;
      replace: string;
      wholeWord: boolean;
    }>
  ) => {
    const current = getSearchQuery(props.view.state);
    props.view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: current.search,
          caseSensitive: current.caseSensitive,
          literal: current.literal,
          regexp: current.regexp,
          replace: current.replace,
          wholeWord: current.wholeWord,
          ...changes,
        })
      ),
    });
  };

  const countLabel = () => {
    const { search, valid } = query();
    if (!search) return '';
    if (!valid) return 'Invalid pattern';

    const { total, current, capped } = matches();
    if (total === 0) return 'No matches';

    const totalLabel = capped ? `${MATCH_COUNT_LIMIT}+` : `${total}`;
    if (current > 0) return `${current} of ${totalLabel}`;
    return `${totalLabel} match${total === 1 ? '' : 'es'}`;
  };

  const close = () => {
    closeSearchPanel(props.view);
  };

  // Escape is claimed by the code block's own hotkey scope, so this only runs
  // when that scope is inactive; the other search bindings live in CodeMirror's
  // `search-panel` keymap scope.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (runScopeHandlers(props.view, event, 'search-panel')) {
      event.preventDefault();
    }
  };

  const onFindKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.shiftKey) findPrevious(props.view);
    else findNext(props.view);
  };

  const onReplaceKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    replaceNext(props.view);
  };

  return (
    <div
      class="flex w-full flex-col gap-1 border-b border-edge-muted bg-surface p-1.5"
      onKeyDown={onKeyDown}
    >
      <div class="flex min-w-0 items-center gap-1">
        <Show when={canReplace()}>
          <Button
            size="icon-sm"
            tooltip={replaceOpen() ? 'Hide replace' : 'Show replace'}
            onClick={() => setReplaceOpen(!replaceOpen())}
          >
            <Show when={replaceOpen()} fallback={<CaretRight />}>
              <CaretDown />
            </Show>
          </Button>
        </Show>

        <Surface depth={1} class={FIELD_CLASS}>
          <MagnifyingGlass class="size-3.5 shrink-0 text-ink-extra-muted" />
          <input
            ref={markAsMainField}
            type="text"
            placeholder="Find"
            aria-label="Find"
            autocomplete="off"
            spellcheck={false}
            class={INPUT_CLASS}
            value={query().search}
            onInput={(event) => commit({ search: event.currentTarget.value })}
            onKeyDown={onFindKeyDown}
          />
        </Surface>

        <ModifierToggle
          glyph="Aa"
          label="Match case"
          active={query().caseSensitive}
          onToggle={() => commit({ caseSensitive: !query().caseSensitive })}
        />
        <ModifierToggle
          glyph="ab"
          label="Match whole word"
          active={query().wholeWord}
          onToggle={() => commit({ wholeWord: !query().wholeWord })}
        />
        <ModifierToggle
          glyph=".*"
          label="Use regular expression"
          active={query().regexp}
          onToggle={() => commit({ regexp: !query().regexp })}
        />

        <span class="min-w-0 flex-1 truncate px-1 text-xs text-ink-muted">
          {countLabel()}
        </span>

        <Button
          size="icon-sm"
          tooltip="Previous match"
          shortcut="shift+enter"
          onClick={() => findPrevious(props.view)}
        >
          <CaretUp />
        </Button>
        <Button
          size="icon-sm"
          tooltip="Next match"
          shortcut="enter"
          onClick={() => findNext(props.view)}
        >
          <CaretDown />
        </Button>
        <Button size="icon-sm" tooltip="Close find" onClick={close}>
          <X />
        </Button>
      </div>

      <Show when={canReplace() && replaceOpen()}>
        <div class="flex min-w-0 items-center gap-1 pl-7">
          <Surface depth={1} class={FIELD_CLASS}>
            <input
              type="text"
              placeholder="Replace"
              aria-label="Replace"
              autocomplete="off"
              spellcheck={false}
              class={INPUT_CLASS}
              value={query().replace}
              onInput={(event) =>
                commit({ replace: event.currentTarget.value })
              }
              onKeyDown={onReplaceKeyDown}
            />
          </Surface>
          <Button
            size="icon-sm"
            tooltip="Replace"
            onClick={() => replaceNext(props.view)}
          >
            <ReplaceIcon />
          </Button>
          <Button
            size="icon-sm"
            tooltip="Replace all"
            onClick={() => replaceAll(props.view)}
          >
            <ReplaceAllIcon />
          </Button>
        </div>
      </Show>
    </div>
  );
}
