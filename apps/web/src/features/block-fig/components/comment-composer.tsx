/**
 * A comment box: Enter posts (⇧Enter for a new line), Escape cancels, and
 * `@` offers people to mention. Keeps the text when posting fails.
 */

import { Button } from '@ui/components/Button';
import { createSignal, For, onMount, Show } from 'solid-js';
import {
  type FigPerson,
  insertMention,
  mentionQuery,
  mentionsIn,
} from '../core/comments';

export function CommentComposer(props: {
  placeholder: string;
  /** `data-testid` of the box; the button is `<testId>-post`. */
  testId: string;
  submitLabel?: string;
  autofocus?: boolean;
  people: (query: string) => FigPerson[];
  onSubmit: (text: string, mentions: FigPerson[]) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [text, setText] = createSignal('');
  const [picked, setPicked] = createSignal<FigPerson[]>([]);
  const [query, setQuery] = createSignal<{ start: number; query: string }>();
  const [highlight, setHighlight] = createSignal(0);
  const [busy, setBusy] = createSignal(false);
  let input!: HTMLTextAreaElement;

  onMount(() => {
    if (props.autofocus) input.focus({ preventScroll: true });
  });

  const options = () => {
    const q = query();
    return q ? props.people(q.query).slice(0, 6) : [];
  };

  const sync = () => {
    setText(input.value);
    setQuery(mentionQuery(input.value, input.selectionStart ?? 0));
    setHighlight(0);
  };

  const choose = (person: FigPerson) => {
    const q = query();
    if (!q) return;
    const next = insertMention(
      input.value,
      q.start,
      input.selectionStart ?? input.value.length,
      person
    );
    input.value = next.text;
    input.setSelectionRange(next.caret, next.caret);
    setPicked((p) => [...p, person]);
    setText(next.text);
    setQuery(undefined);
    input.focus();
  };

  const submit = async () => {
    const value = text().trim();
    if (!value || busy()) return;
    setBusy(true);
    try {
      await props.onSubmit(value, mentionsIn(value, picked()));
      input.value = '';
      setText('');
      setPicked([]);
    } catch {
      // The text stays for another try; the store reports the failure.
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const list = options();
    if (list.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setHighlight((h) => (h + step + list.length) % list.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(list[highlight()] ?? list[0]);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query()) setQuery(undefined);
      else props.onCancel?.();
    }
    // Typing here never reaches the viewer's shortcuts.
    e.stopPropagation();
  };

  return (
    <div class="relative flex flex-col gap-1.5">
      <textarea
        ref={input}
        rows={2}
        class="w-full resize-none rounded-md border border-edge-muted bg-input px-2 py-1.5 text-ink text-xs outline-none placeholder:text-ink-placeholder focus:border-accent"
        placeholder={props.placeholder}
        data-testid={props.testId}
        onInput={sync}
        onClick={sync}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => e.stopPropagation()}
      />
      <Show when={options().length > 0}>
        <div
          class="absolute top-full left-0 z-10 mt-1 w-48 overflow-hidden rounded-md border border-edge-muted bg-panel py-1 shadow-lg"
          role="listbox"
          data-testid="fig-mention-menu"
        >
          <For each={options()}>
            {(person, k) => (
              <button
                type="button"
                role="option"
                aria-selected={highlight() === k()}
                class="block w-full truncate px-2 py-1 text-left text-xs"
                classList={{ 'bg-hover': highlight() === k() }}
                data-testid="fig-mention-option"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(person)}
              >
                {person.name}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="flex justify-end gap-1.5">
        <Show when={props.onCancel}>
          <Button
            variant="ghost"
            size="sm"
            data-testid={`${props.testId}-cancel`}
            onClick={() => props.onCancel?.()}
          >
            Cancel
          </Button>
        </Show>
        <Button
          variant="accent"
          size="sm"
          disabled={!text().trim() || busy()}
          data-testid={`${props.testId}-post`}
          onClick={() => void submit()}
        >
          {props.submitLabel ?? 'Post'}
        </Button>
      </div>
    </div>
  );
}
