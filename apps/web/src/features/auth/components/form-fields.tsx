import { cn } from '@ui/utils/classname';
import { type JSX, onCleanup, onMount, Show, splitProps } from 'solid-js';

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
      class="obf-input w-full rounded-2xl border border-edge bg-input px-4 py-3 text-sm text-ink placeholder:text-ink-placeholder transition-colors focus:border-ink/40 focus:outline-none user-invalid:border-failure"
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

/** Onboarding's pill buttons: filled for the main action, outlined otherwise. */
export function AuthButton(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary';
  }
) {
  const [local, rest] = splitProps(props, ['variant', 'class', 'type']);
  return (
    <button
      type={local.type ?? 'button'}
      class={cn(
        'flex min-h-14 w-full items-center justify-center gap-3 rounded-full px-6 py-3.5 text-base font-medium transition-[opacity,background-color] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:opacity-40',
        local.variant === 'secondary'
          ? 'border border-edge text-ink hover:bg-ink/5'
          : 'bg-ink text-surface hover:opacity-90',
        local.class
      )}
      {...rest}
    />
  );
}
