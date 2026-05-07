import { cn } from '@ui';
import { authServiceClient } from '@service-auth/client';
import type { JSX } from 'solid-js';
import { createSignal, onMount, Show } from 'solid-js';

export function setCookie(name: string, value: string, days: number) {
  const expires = days
    ? `; expires=${new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()}`
    : '';
  document.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/`;
}

export const assignABGroup = async () => {
  const randomGroup = Math.random() < 0.5 ? 'A' : 'B';
  await authServiceClient.setGroup({ group: randomGroup });
  return randomGroup;
};

export enum Stage {
  Verify = 'verify',
  Email = 'email',
  Done = 'done',
  None = 'none',
}

export function Input(props: {
  onInput?: JSX.ChangeEventHandlerUnion<HTMLInputElement, Event>;
  inputMode?: 'text' | 'numeric';
  textCenter?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  value?: string;
  type?: string;
  id: string;
}) {
  const [el, setEl] = createSignal<HTMLInputElement>();
  onMount(() => {
    setTimeout(() => {
      el()?.focus();
    }, 1);
  });
  return (
    <input
      class={cn(
        'appearance-none disabled:bg-edge block w-full shadow-none placeholder-placeholder sm:text-sm',
        props.textCenter && 'text-center'
      )}
      required={props.required ?? true}
      placeholder={props.placeholder}
      type={props.type || 'text'}
      inputMode={props.inputMode}
      readOnly={props.readOnly}
      value={props.value ?? ''}
      onInput={props.onInput}
      autocomplete={props.id}
      name={props.id}
      id={props.id}
      ref={setEl}
    />
  );
}

export function ErrorMsg(props: { msg?: string }) {
  return (
    <Show when={props.msg}>
      <div class="grid items-center justify-center p-4 border-b border-edge-muted text-sm text-red-500">
        {props.msg}
      </div>
    </Show>
  );
}
