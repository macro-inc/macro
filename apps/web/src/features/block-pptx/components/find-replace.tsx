/**
 * Find and replace, floating over the slide: matches across the deck in
 * reading order, each shown selected in its shape when visited.
 */

import CaretDown from '@phosphor/caret-down.svg';
import CaretUp from '@phosphor/caret-up.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { createMemo, createSignal, onMount, Show } from 'solid-js';
import {
  findInDeck,
  replaceAllOps,
  replaceOps,
  type TextMatch,
} from '../core/find';
import { cellBox, tableGeometry } from '../core/table';
import type { EditorCommands } from '../primitives/create-editor-commands';
import type { PresentationSession } from '../primitives/create-presentation-session';
import type { SlideEditor } from '../primitives/create-slide-editor';

export function FindReplace(props: {
  replace: boolean;
  readonly: boolean;
  session: PresentationSession;
  editor: SlideEditor;
  commands: EditorCommands;
  onReplaceMode: (replace: boolean) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal('');
  const [replacement, setReplacement] = createSignal('');
  const [matchCase, setMatchCase] = createSignal(false);
  const [wholeWord, setWholeWord] = createSignal(false);
  const [current, setCurrent] = createSignal(-1);
  let findInput!: HTMLInputElement;

  const matches = createMemo(() => {
    const deck = props.session.outline();
    return deck
      ? findInDeck(deck, query(), {
          matchCase: matchCase(),
          wholeWord: wholeWord(),
        })
      : [];
  });

  onMount(() => findInput.focus());

  /** Shows a match: its slide, its shape in text editing, the text selected. */
  async function reveal(match: TextMatch) {
    const { editor, session } = props;
    if (session.slideIndex() !== match.slideIndex)
      editor.goToSlide(match.slideIndex);
    const shape = editor.findShape(match.shape);
    if (!shape) return;
    if (match.cell) {
      const g = tableGeometry(shape);
      if (!g) return;
      await editor.startEditing(shape.id, undefined, {
        ref: match.cell,
        bounds: cellBox(shape, g, match.cell),
      });
    } else {
      await editor.startEditing(shape.id);
    }
    editor.selectText(
      { paragraph: match.paragraph, offset: match.start },
      { paragraph: match.paragraph, offset: match.end }
    );
    // Keep typing in the find field.
    findInput.focus();
  }

  /** The first match at or after the current slide, moving `direction`. */
  function step(direction: 1 | -1) {
    const list = matches();
    if (list.length === 0) return;
    let next = current() + direction;
    if (current() < 0) {
      const here = props.session.slideIndex();
      next =
        direction > 0
          ? Math.max(
              0,
              list.findIndex((m) => m.slideIndex >= here)
            )
          : list.length - 1;
    }
    next = (next + list.length) % list.length;
    setCurrent(next);
    void reveal(list[next]);
  }

  async function replaceOne() {
    const list = matches();
    const at = current();
    const match = list[at];
    if (!match) {
      step(1);
      return;
    }
    props.editor.stopEditing();
    await props.session.apply(replaceOps(match, replacement()));
    // The next match now sits at the same index.
    const after = matches();
    if (after.length === 0) {
      setCurrent(-1);
      return;
    }
    const next = Math.min(at, after.length - 1);
    setCurrent(next);
    void reveal(after[next]);
  }

  async function replaceAll() {
    const list = matches();
    if (list.length === 0) return;
    props.editor.stopEditing();
    await props.session.apply(replaceAllOps(list, replacement()));
    setCurrent(-1);
  }

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  };

  const toggleClass = (on: boolean) =>
    `h-6 rounded-md px-1.5 text-xs ${on ? 'bg-accent-bg text-accent' : 'text-ink-muted hover:bg-ink/5'}`;

  return (
    <div
      class="absolute top-2 right-3 z-20 flex w-80 flex-col gap-1.5 rounded-xl border border-edge bg-menu p-2 shadow-xl"
      data-testid="pptx-find"
      role="search"
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div class="flex items-center gap-1">
        <input
          ref={findInput}
          data-testid="pptx-find-input"
          placeholder="Find"
          aria-label="Find"
          class="h-7 min-w-0 flex-1 rounded-md border border-edge-muted bg-input px-2 text-ink text-xs outline-none focus:border-accent"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setCurrent(-1);
          }}
        />
        <span
          class="w-14 text-right text-ink-muted text-xs tabular-nums"
          data-testid="pptx-find-count"
        >
          {query()
            ? matches().length === 0
              ? 'No results'
              : `${current() < 0 ? '–' : current() + 1} of ${matches().length}`
            : ''}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          label="Previous"
          onClick={() => step(-1)}
        >
          <CaretUp />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          label="Next"
          onClick={() => step(1)}
        >
          <CaretDown />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          label="Close"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </div>
      <Show when={props.replace && !props.readonly}>
        <div class="flex items-center gap-1">
          <input
            data-testid="pptx-replace-input"
            placeholder="Replace with"
            aria-label="Replace with"
            class="h-7 min-w-0 flex-1 rounded-md border border-edge-muted bg-input px-2 text-ink text-xs outline-none focus:border-accent"
            value={replacement()}
            onInput={(e) => setReplacement(e.currentTarget.value)}
          />
          <Button
            size="xs"
            variant="outline"
            disabled={matches().length === 0}
            onClick={() => void replaceOne()}
          >
            Replace
          </Button>
          <Button
            size="xs"
            variant="outline"
            data-testid="pptx-replace-all"
            disabled={matches().length === 0}
            onClick={() => void replaceAll()}
          >
            All
          </Button>
        </div>
      </Show>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class={toggleClass(matchCase())}
          aria-pressed={matchCase()}
          onClick={() => setMatchCase((v) => !v)}
        >
          Match case
        </button>
        <button
          type="button"
          class={toggleClass(wholeWord())}
          aria-pressed={wholeWord()}
          onClick={() => setWholeWord((v) => !v)}
        >
          Whole words
        </button>
        <span class="flex-1" />
        <Show when={!props.replace && !props.readonly}>
          <button
            type="button"
            class={toggleClass(false)}
            onClick={() => props.onReplaceMode(true)}
          >
            Replace…
          </button>
        </Show>
      </div>
    </div>
  );
}
