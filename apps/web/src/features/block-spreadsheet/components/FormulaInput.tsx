import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
} from '@floating-ui/dom';
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  argumentLabel,
  formulaFunctions,
  functionSummary,
} from '../core/formula-completion';
import type { FormulaTextSelection } from '../core/formula-reference';
import {
  type CompleteFormula,
  createFormulaAssistance,
} from '../primitives/create-formula-assistance';
import { createTouchPress } from '../primitives/create-touch-press';

/** Shared cell/formula-bar input. The popup keeps focus and editing in the textarea. */
export function FormulaInput(props: {
  label: string;
  value: string;
  class: string;
  readonly?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  complete?: CompleteFormula;
  selectionRequest?: FormulaTextSelection;
  pickingReference?: boolean;
  onSelectionChange?: (start: number, end: number) => void;
  onFocus?: () => void;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onBlur: () => void;
}) {
  let input!: HTMLTextAreaElement;
  let popup: HTMLDivElement | undefined;
  const id = createUniqueId();
  const [focused, setFocused] = createSignal(false);
  const assistance = createFormulaAssistance(
    (text, cursor) =>
      props.complete?.(text, cursor) ?? Promise.resolve(undefined),
    (text, cursor) => {
      if (props.readonly) return;
      props.onInput(text);
      input.value = text;
      input.focus({ preventScroll: true });
      input.setSelectionRange(cursor, cursor);
      update();
    }
  );
  const result = assistance.completion;
  const choices = () => {
    const value = result();
    return value?.kind === 'list' ? value.names : [];
  };
  const name = () => {
    const value = result();
    return value?.kind === 'detail'
      ? value.name
      : choices()[assistance.selected()];
  };
  const info = () => formulaFunctions[name()];
  const popupVisible = () =>
    focused() && !props.readonly && !props.pickingReference && !!info();
  const argument = () => {
    const value = result();
    return value?.kind === 'detail' ? value.argument : -1;
  };
  const activeArgument = () => {
    const args = info()?.args ?? [];
    if (argument() < 0 || !args.length) return -1;
    return Math.min(argument(), args.length - 1);
  };
  const update = () => {
    if (!focused() || props.readonly) return;
    props.onSelectionChange?.(input.selectionStart, input.selectionEnd);
    if (props.pickingReference) assistance.dismiss();
    else
      assistance.update(input.value, input.selectionStart, input.selectionEnd);
  };
  let appliedSelection: FormulaTextSelection | undefined;
  // Pointer selection changes the draft without moving focus out of this editor.
  createEffect(
    on(
      () => [props.selectionRequest, props.pickingReference] as const,
      ([selection]) => {
        if (document.activeElement !== input) return;
        if (selection && selection !== appliedSelection) {
          appliedSelection = selection;
          input.value = props.value;
          input.setSelectionRange(selection.start, selection.end);
        }
        update();
      }
    )
  );
  onMount(() => {
    if (props.autoFocus) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      update();
    }
  });

  return (
    <>
      <textarea
        ref={input}
        aria-label={props.label}
        aria-autocomplete="list"
        aria-controls={
          popupVisible() && choices().length ? `${id}-list` : undefined
        }
        aria-activedescendant={
          popupVisible() && choices().length
            ? `${id}-${assistance.selected()}`
            : undefined
        }
        aria-describedby={popupVisible() ? `${id}-help` : undefined}
        rows={1}
        wrap="off"
        spellcheck={false}
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        enterkeyhint="done"
        readOnly={props.readonly}
        maxLength={10_000}
        placeholder={props.placeholder}
        class={`${props.class} touch:text-[max(16px,1rem)]`}
        value={props.value}
        onFocus={() => {
          props.onFocus?.();
          setFocused(true);
          update();
        }}
        onInput={() => {
          props.onInput(input.value);
          update();
        }}
        onSelect={update}
        onClick={update}
        onKeyUp={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            update();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (!props.readonly && assistance.keyDown(event)) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
              popup
                ?.querySelector('[aria-selected="true"]')
                ?.scrollIntoView({ block: 'nearest' });
            return;
          }
          props.onKeyDown(event);
        }}
        onBlur={() => {
          setFocused(false);
          assistance.dismiss();
          props.onBlur();
        }}
      />
      <Show when={popupVisible()}>
        <Portal>
          <FormulaPopup
            anchor={input}
            interactive={choices().length > 0}
            onReady={(element) => {
              popup = element;
            }}
          >
            <Show when={choices().length}>
              <div
                id={`${id}-list`}
                role="listbox"
                aria-label="Formula suggestions"
                class="min-h-0 max-h-48 shrink overflow-y-auto overscroll-contain p-1"
              >
                <For each={choices()}>
                  {(choice, index) => {
                    const press = createTouchPress(
                      () => assistance.accept(index()),
                      () => props.readonly ?? false
                    );
                    return (
                      <div
                        {...press}
                        id={`${id}-${index()}`}
                        role="option"
                        aria-selected={assistance.selected() === index()}
                        class="flex items-center gap-3 rounded px-2.5 py-2 text-xs touch:min-h-[44px] touch:text-sm"
                        classList={{
                          'bg-accent-bg text-accent':
                            assistance.selected() === index(),
                          'text-ink hover:bg-hover':
                            assistance.selected() !== index(),
                        }}
                        onPointerMove={(event) => {
                          press.onPointerMove(event);
                          assistance.setSelected(index());
                        }}
                      >
                        <span class="font-mono font-semibold">{choice}</span>
                        <span class="truncate text-[11px] text-ink-muted">
                          {functionSummary(formulaFunctions[choice])}
                        </span>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
            <div
              id={`${id}-help`}
              class="min-h-0 overflow-y-auto border-t border-edge-muted px-3 py-3 text-xs touch:text-sm"
              classList={{ 'touch:hidden': choices().length > 0 }}
            >
              <div class="mb-2 break-words font-mono leading-5 text-ink">
                <span class="font-semibold text-accent">{name()}</span>(
                <For each={info().args}>
                  {(arg, index) => (
                    <>
                      {index() > 0 ? ', ' : ''}
                      <span
                        classList={{
                          'rounded bg-accent-bg px-0.5 text-accent font-semibold':
                            index() === activeArgument(),
                        }}
                      >
                        {argumentLabel(arg[0])}
                      </span>
                    </>
                  )}
                </For>
                )
              </div>
              <p class="leading-5 text-ink-muted">
                {activeArgument() >= 0
                  ? info().args[activeArgument()][2]
                  : functionSummary(info())}
              </p>
              <Show when={info().examples[0]}>
                <p class="mt-2 break-words font-mono text-[11px] leading-4 text-ink-subtle">
                  {info().examples[0]}
                </p>
              </Show>
            </div>
            <Show when={choices().length}>
              <div class="shrink-0 border-t border-edge-muted px-3 py-2 text-[10px] text-ink-subtle touch:hidden">
                ↑↓ Navigate · Tab or Enter to insert · Esc to dismiss
              </div>
            </Show>
          </FormulaPopup>
        </Portal>
      </Show>
    </>
  );
}

function FormulaPopup(props: {
  anchor: HTMLElement;
  interactive: boolean;
  children: import('solid-js').JSX.Element;
  onReady: (element: HTMLDivElement) => void;
}) {
  let element!: HTMLDivElement;
  onMount(() => {
    props.onReady(element);
    let alive = true;
    const update = async () => {
      const position = await computePosition(props.anchor, element, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [
          offset(5),
          flip(),
          shift({ padding: 12 }),
          size({
            padding: 12,
            apply({ availableHeight, elements }) {
              elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
            },
          }),
        ],
      });
      if (alive)
        Object.assign(element.style, {
          left: `${position.x}px`,
          top: `${position.y}px`,
          visibility: 'visible',
        });
    };
    const cleanup = autoUpdate(props.anchor, element, () => {
      void update();
    });
    onCleanup(() => {
      alive = false;
      cleanup();
    });
  });
  return (
    <div
      ref={element}
      style={{ visibility: 'hidden' }}
      class="fixed z-[100] flex w-96 max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg border border-edge bg-panel text-ink shadow-xl"
      classList={{ 'pointer-events-none': !props.interactive }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {props.children}
    </div>
  );
}
