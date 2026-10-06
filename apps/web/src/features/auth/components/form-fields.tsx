import { onCleanup, onMount, Show } from 'solid-js';

export function FormInput(props: {
  id: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  value: string;
  autoFocus?: boolean;
  onInput: (value: string) => void;
}) {
  let inputEl: HTMLInputElement | undefined;
  onMount(() => {
    if (props.autoFocus === false) return;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    // The Stepper's outin Transition resolves this step's JSX (firing onMount)
    // before attaching it to the document, so the input is still detached
    // here. Poll until it's connected, then focus.
    const focusWhenConnected = () => {
      if (cancelled || !inputEl) return;
      if (inputEl.isConnected) inputEl.focus({ preventScroll: true });
      else requestAnimationFrame(focusWhenConnected);
    };
    focusWhenConnected();
  });
  return (
    <input
      ref={(el) => (inputEl = el)}
      id={props.id}
      name={props.id}
      type={props.type ?? 'text'}
      placeholder={props.placeholder}
      value={props.value}
      required={props.required ?? true}
      autocomplete={props.id}
      onInput={(event) => props.onInput(event.currentTarget.value)}
      class="ln-input w-full px-4 py-3 rounded-lg border border-edge bg-surface text-sm text-ink placeholder:text-ink-placeholder focus:border-accent focus:outline-none transition-colors user-invalid:border-failure"
    />
  );
}

export function FormError(props: { message?: string }) {
  return (
    <Show when={props.message}>
      <p role="alert" class="text-xs text-failure leading-snug">
        {props.message}
      </p>
    </Show>
  );
}
