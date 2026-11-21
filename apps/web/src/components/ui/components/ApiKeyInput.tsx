import KeyIcon from '@icon/system/regular/key.svg';
import { splitProps } from 'solid-js';
import { SECRET_MASK, SecretInput, type SecretInputProps } from './SecretInput';

export type ApiKeyInputProps = Omit<
  SecretInputProps,
  'autocomplete' | 'icon' | 'placeholder'
> & {
  /** The key's public prefix, such as `sk-ant-`, shown in the placeholder. */
  prefix?: string;
};

/**
 * A `SecretInput` for pasting an API key: a key icon, and the provider's
 * prefix in the placeholder (`sk-ant-••••` once a key is saved).
 *
 * @do Pair it with a Save button; `onSubmit` handles Enter.
 * @dont Do not pass a stored key as `value`: keys are write-only.
 */
export function ApiKeyInput(props: ApiKeyInputProps) {
  const [local, rest] = splitProps(props, ['prefix']);
  const placeholder = () =>
    rest.saved
      ? `${local.prefix ?? ''}${SECRET_MASK}`
      : `${local.prefix ?? ''}…`;
  return (
    <SecretInput
      autocomplete="new-password"
      icon={<KeyIcon />}
      placeholder={placeholder()}
      {...rest}
    />
  );
}
