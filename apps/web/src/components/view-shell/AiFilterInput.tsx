import SparkleIcon from '@phosphor/sparkle.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { cn } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';

/** `applied` may carry a `note` explaining any part of the request left unmapped. */
export type AiFilterOutcome =
  | { status: 'applied'; note?: string }
  | { status: 'error'; message: string };

export type AiFilterInputProps = {
  placeholder?: string;
  /** Turns the description into filters and applies them. */
  onSubmit: (query: string) => Promise<AiFilterOutcome>;
  /** Fires after a fully mapped apply, e.g. so the host menu can close. */
  onApplied?: () => void;
  inputRef?: (element: HTMLInputElement) => void;
};

type Feedback = { tone: 'note' | 'error'; text: string };

/**
 * Plain-English filter box for list filter menus: type a description, press
 * Enter, and the host resolves it into concrete filters. Lives inside a
 * Kobalte menu, so key events the input owns stop here rather than reaching
 * the menu's typeahead and arrow-key handling.
 */
export function AiFilterInput(props: AiFilterInputProps) {
  const [value, setValue] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [feedback, setFeedback] = createSignal<Feedback>();
  let requestId = 0;
  onCleanup(() => {
    requestId += 1;
  });

  const submit = async () => {
    const query = value().trim();
    if (!query || pending()) return;

    requestId += 1;
    const id = requestId;
    setPending(true);
    setFeedback(undefined);
    const outcome = await props.onSubmit(query);
    if (id !== requestId) return;

    setPending(false);
    if (outcome.status === 'error') {
      setFeedback({ tone: 'error', text: outcome.message });
      return;
    }
    setValue('');
    if (outcome.note) {
      setFeedback({ tone: 'note', text: outcome.note });
      return;
    }
    props.onApplied?.();
  };

  let input: HTMLInputElement | undefined;
  // Kobalte focuses whichever row the mouse passes over, which would drop
  // focus mid-word when the pointer drifts below the box. Once the user has
  // engaged with the box, a hover-caused blur hands focus straight back.
  // Keyboard navigation, a click anywhere else, or focus moving into a
  // submenu releases it so the rest of the menu behaves as usual.
  let engaged = false;
  const release = () => {
    engaged = false;
  };
  const menuOf = (element: Element) => element.closest('[role="menu"]');

  const handleBlur = (event: FocusEvent) => {
    if (!engaged || !input) return;
    const next = event.relatedTarget;
    if (!(next instanceof Element) || menuOf(next) !== menuOf(input)) {
      release();
      return;
    }
    queueMicrotask(() => {
      if (engaged && input?.isConnected && document.activeElement !== input) {
        input.focus({ preventScroll: true });
      }
    });
  };

  onMount(() => {
    const onDocumentPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !input?.contains(event.target)) {
        release();
      }
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    onCleanup(() =>
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    );
  });

  const setInput = (element: HTMLInputElement) => {
    input = element;
    props.inputRef?.(element);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        void submit();
        return;
      case 'Escape':
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Tab':
        // The menu owns these: dismiss, or move focus into the option rows.
        release();
        return;
      default:
        // Caret movement and typing belong to the input, not menu typeahead.
        event.stopPropagation();
    }
  };

  return (
    <div class="flex w-60 flex-col gap-1">
      <div
        class={cn(
          'flex h-8 items-center gap-2 rounded-lg border border-edge-muted bg-input px-2',
          'focus-within:border-accent'
        )}
      >
        <Show
          when={pending()}
          fallback={<SparkleIcon class="size-3.5 shrink-0 text-ink-muted" />}
        >
          <SpinnerIcon class="size-3.5 shrink-0 animate-spin text-ink-muted" />
        </Show>
        <input
          ref={setInput}
          type="text"
          aria-label="Filter with AI"
          aria-busy={pending()}
          value={value()}
          readOnly={pending()}
          placeholder={props.placeholder ?? 'Describe a filter…'}
          autocomplete="off"
          spellcheck={false}
          class={cn(
            'min-w-0 flex-1 bg-transparent text-sm text-ink caret-accent outline-none placeholder:text-ink-placeholder',
            pending() && 'opacity-60'
          )}
          onInput={(event) => {
            engaged = true;
            setValue(event.currentTarget.value);
          }}
          onPointerDown={() => {
            engaged = true;
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      </div>
      <Show when={feedback()}>
        {(item) => (
          <p
            role={item().tone === 'error' ? 'alert' : 'status'}
            class={cn(
              'px-1 text-xs leading-snug',
              item().tone === 'error' ? 'text-failure-ink' : 'text-ink-muted'
            )}
          >
            {item().text}
          </p>
        )}
      </Show>
    </div>
  );
}
