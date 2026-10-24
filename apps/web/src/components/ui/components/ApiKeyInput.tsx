import KeyIcon from '@phosphor/key.svg';
import { splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import type { InputSize } from './Input';
import { InputGroup, type InputGroupInputProps } from './InputGroup';

/** Stands in for a stored key, which is never readable again. */
const MASK = '••••••••••••';

export type ApiKeyInputProps = Omit<
  InputGroupInputProps,
  'type' | 'value' | 'onInput' | 'placeholder'
> & {
  /** What the person has typed so far. */
  value: string;
  onValueChange: (value: string) => void;
  /** The key's public prefix, such as `sk-ant-`, shown in the placeholder. */
  prefix?: string;
  /** A key is already stored: the empty field shows it masked (`sk-ant-••••`). */
  saved?: boolean;
  /** Enter, the field's natural submit. */
  onSubmit?: () => void;
  size?: InputSize;
};

/**
 * A field for pasting a secret API key. It never shows a stored key, only a
 * masked placeholder, and keeps what is typed out of autofill, spellcheck and
 * session replay.
 *
 * @do Pair it with a Save button; `onSubmit` handles Enter.
 * @dont Do not pass a stored key as `value`: keys are write-only.
 */
export function ApiKeyInput(props: ApiKeyInputProps) {
  const [local, rest] = splitProps(props, [
    'value',
    'onValueChange',
    'prefix',
    'saved',
    'onSubmit',
    'size',
    'class',
    'onKeyDown',
  ]);
  const placeholder = () =>
    local.saved ? `${local.prefix ?? ''}${MASK}` : `${local.prefix ?? ''}…`;
  return (
    <InputGroup size={local.size ?? 'md'} class={cn('min-w-0', local.class)}>
      <InputGroup.Input
        type="password"
        autocomplete="off"
        spellcheck={false}
        class="ph-no-capture font-mono"
        placeholder={placeholder()}
        value={local.value}
        onInput={(event) => local.onValueChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (typeof local.onKeyDown === 'function') local.onKeyDown(event);
          if (event.key === 'Enter') local.onSubmit?.();
        }}
        {...rest}
      />
      <InputGroup.Addon align="inline-start">
        <KeyIcon aria-hidden="true" />
      </InputGroup.Addon>
    </InputGroup>
  );
}
