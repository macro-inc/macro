import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { mergeRefs } from '@solid-primitives/refs';
import { type JSX, Show, splitProps, type ValidComponent } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { createCopyState } from '../utils/create-copy-state';
import { Button, type ButtonProps } from './Button';
import { CopyFeedback } from './CopyFeedback';

export type CopyButtonProps<T extends ValidComponent = 'button'> =
  PolymorphicProps<T, Omit<ButtonProps, 'as'>> & { icon?: JSX.Element };

/**
 * Button with an explicit icon that blurs and fades to a check on copy success.
 *
 * @do Return the clipboard promise from onClick so feedback waits for success.
 * @do Return false (or reject) when copying fails; report errors in the handler.
 * @do Use as={ButtonGroup.Button} to render a segment in an action group.
 * @dont Discard the promise with `void` inside onClick.
 */
export function CopyButton<T extends ValidComponent = 'button'>(
  props: CopyButtonProps<T>
) {
  const [local, rest] = splitProps(props, [
    'onClick',
    'children',
    'ref',
    'as',
    'icon',
  ]);
  let button!: HTMLButtonElement;
  const { copy, copied } = createCopyState();

  const onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = async (
    event
  ) => {
    const handler = local.onClick;
    if (!handler || button.disabled) return;
    await copy(() =>
      typeof handler === 'function'
        ? handler(event)
        : handler[0](handler[1], event)
    );
  };

  return (
    <Dynamic
      component={local.as ?? Button}
      {...rest}
      ref={mergeRefs((element) => (button = element), local.ref)}
      on:click={onClick}
    >
      <Show when={local.icon}>
        {(icon) => <CopyFeedback copied={copied()}>{icon()}</CopyFeedback>}
      </Show>
      {local.children}
    </Dynamic>
  );
}
