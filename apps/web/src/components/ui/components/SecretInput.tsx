import { t } from '@app/lib/i18n';
import EyeIcon from '@icon/system/regular/eye.svg';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import {
  children,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  splitProps,
} from 'solid-js';
import { cn } from '../utils/classname';
import type { InputSize } from './Input';
import { InputGroup, type InputGroupInputProps } from './InputGroup';

/** Stands in for a stored secret, which is never readable again. */
export const SECRET_MASK = '••••••••••••';

/**
 * How the browser's password manager treats the field: `new-password` for a
 * secret being set (API keys, new passwords), `current-password` for signing
 * in, `off` for secrets a password manager should not offer to fill.
 */
export type SecretInputAutocomplete =
  | 'new-password'
  | 'current-password'
  | 'off';

export type SecretInputProps = Omit<
  InputGroupInputProps,
  'type' | 'value' | 'onInput' | 'autocomplete'
> & {
  /** What the person has typed so far; never a stored secret. */
  value: string;
  onValueChange: (value: string) => void;
  autocomplete: SecretInputAutocomplete;
  /** A secret is already stored: the empty field shows a mask placeholder. */
  saved?: boolean;
  /** Leading icon, such as a key. */
  icon?: JSX.Element;
  /** Enter, the field's natural submit. */
  onSubmit?: () => void;
  size?: InputSize;
};

/**
 * A masked field for entering a secret: an API key, a password, a token. A
 * toggle reveals what is being typed now; a stored secret is never shown, only
 * a mask placeholder. What is typed stays out of spellcheck and session
 * replay.
 *
 * @do Pick `autocomplete` for the context: `new-password` when setting a
 *   secret, `current-password` when signing in, `off` otherwise.
 * @do Pair it with a Save button; `onSubmit` handles Enter.
 * @dont Do not pass a stored secret as `value`: secrets are write-only.
 */
export function SecretInput(props: SecretInputProps) {
  const [local, rest] = splitProps(props, [
    'value',
    'onValueChange',
    'saved',
    'icon',
    'onSubmit',
    'size',
    'class',
    'onKeyDown',
    'placeholder',
    'disabled',
  ]);
  // The toggle unmounts with an empty field, so whatever is typed next, after
  // a save or a clear, starts masked again.
  const [shown, setShown] = createSignal(false);
  const icon = children(() => local.icon);
  const placeholder = () =>
    local.placeholder ?? (local.saved ? SECRET_MASK : undefined);

  return (
    <InputGroup size={local.size ?? 'md'} class={cn('min-w-0', local.class)}>
      <InputGroup.Input
        type={shown() ? 'text' : 'password'}
        spellcheck={false}
        autocapitalize="off"
        autocorrect="off"
        class="ph-no-capture font-mono"
        placeholder={placeholder()}
        disabled={local.disabled}
        value={local.value}
        onInput={(event) => local.onValueChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (typeof local.onKeyDown === 'function') local.onKeyDown(event);
          if (event.key === 'Enter') local.onSubmit?.();
        }}
        {...rest}
      />
      <Show when={icon()}>
        <InputGroup.Addon align="inline-start" aria-hidden="true">
          {icon()}
        </InputGroup.Addon>
      </Show>
      <Show when={local.value !== ''}>
        <RevealToggle
          revealed={shown()}
          disabled={local.disabled}
          onToggle={() => setShown((current) => !current)}
          onUnmount={() => setShown(false)}
        />
      </Show>
    </InputGroup>
  );
}

type RevealToggleProps = {
  revealed: boolean;
  disabled: boolean | undefined;
  onToggle: () => void;
  onUnmount: () => void;
};

function RevealToggle(props: RevealToggleProps) {
  onCleanup(() => props.onUnmount());
  return (
    <InputGroup.Addon align="inline-end">
      <InputGroup.Button
        type="button"
        aria-label={
          props.revealed ? t('common.hideSecret') : t('common.showSecret')
        }
        disabled={props.disabled}
        // Keep focus, and the caret, in the field.
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => props.onToggle()}
      >
        <Show
          when={props.revealed}
          fallback={<EyeIcon class="size-3.5 shrink-0" />}
        >
          <EyeSlashIcon class="size-3.5 shrink-0" />
        </Show>
      </InputGroup.Button>
    </InputGroup.Addon>
  );
}
