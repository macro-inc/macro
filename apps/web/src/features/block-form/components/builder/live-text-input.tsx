import {
  type Accessor,
  createRenderEffect,
  type JSX,
  on,
  splitProps,
} from 'solid-js';
import { mapSelection, rebaseEdit, textChange } from '../../core/text-change';

type LiveElement = HTMLInputElement | HTMLTextAreaElement;

/** Write an edit; false when it was refused and the value stays. */
type Edit = (value: string) => boolean;

/**
 * Binds a native control to text other editors change while it is focused.
 * Every keystroke is written; a value from elsewhere replaces only the span
 * that changed and carries the selection across it. Text still being
 * composed is never touched: the composed edit is replayed onto whatever
 * arrived meanwhile when composition ends.
 */
function bindLiveText(options: { value: Accessor<string>; onEdit: Edit }) {
  let element: LiveElement | undefined;
  // The value the control last agreed with, which the person's edit is of.
  let base = '';
  let composing = false;

  const show = (text: string) => {
    if (!element || element.value === text) return;
    if (document.activeElement !== element) {
      element.value = text;
      return;
    }
    const direction = element.selectionDirection ?? 'none';
    const selection = mapSelection(
      { start: element.selectionStart ?? 0, end: element.selectionEnd ?? 0 },
      textChange(element.value, text)
    );
    element.value = text;
    element.setSelectionRange(selection.start, selection.end, direction);
  };

  createRenderEffect(
    on(options.value, (value) => {
      if (composing) return;
      base = value;
      show(value);
    })
  );

  const commit = () => {
    if (!element) return;
    const value = options.value();
    const next = rebaseEdit(base, element.value, value);
    if (next !== value && options.onEdit(next)) base = next;
    else base = options.value();
    show(base);
  };

  return {
    ref: (target: LiveElement) => {
      element = target;
      base = options.value();
      target.value = base;
    },
    onInput: (event: InputEvent) => {
      if (!composing && !event.isComposing) commit();
    },
    onCompositionStart: () => {
      composing = true;
    },
    onCompositionEnd: () => {
      composing = false;
      commit();
    },
  };
}

/** A native text input over shared text; see `bindLiveText`. */
export function LiveTextInput(
  props: Omit<
    JSX.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'ref' | 'onInput' | 'onCompositionStart' | 'onCompositionEnd'
  > & { value: string; onEdit: Edit }
) {
  const [local, rest] = splitProps(props, ['value', 'onEdit']);
  const binding = bindLiveText({
    value: () => local.value,
    onEdit: (value) => local.onEdit(value),
  });
  return (
    <input
      {...rest}
      ref={binding.ref}
      onInput={binding.onInput}
      onCompositionStart={binding.onCompositionStart}
      onCompositionEnd={binding.onCompositionEnd}
    />
  );
}

/** The textarea form of `LiveTextInput`. */
export function LiveTextarea(
  props: Omit<
    JSX.TextareaHTMLAttributes<HTMLTextAreaElement>,
    'value' | 'ref' | 'onInput' | 'onCompositionStart' | 'onCompositionEnd'
  > & { value: string; onEdit: Edit }
) {
  const [local, rest] = splitProps(props, ['value', 'onEdit']);
  const binding = bindLiveText({
    value: () => local.value,
    onEdit: (value) => local.onEdit(value),
  });
  return (
    <textarea
      {...rest}
      ref={binding.ref}
      onInput={binding.onInput}
      onCompositionStart={binding.onCompositionStart}
      onCompositionEnd={binding.onCompositionEnd}
    />
  );
}
