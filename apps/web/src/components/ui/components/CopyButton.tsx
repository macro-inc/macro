import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { mergeRefs } from '@solid-primitives/refs';
import { children, type JSX, splitProps, type ValidComponent } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';
import { createCopyFeedback } from './CopyFeedback';

export type CopyButtonProps<T extends ValidComponent = 'button'> =
  PolymorphicProps<T, Omit<ButtonProps, 'as'>>;

/**
 * Button with copy-success feedback, using the same props and children.
 * The first SVG fades to a check-circle without changing its layout or size.
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
    'class',
  ]);
  let button!: HTMLButtonElement;
  const { activate, CopyFeedback } = createCopyFeedback(() => button);

  const onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = async (
    event
  ) => {
    const handler = local.onClick;
    if (!handler || button.disabled) return;
    await activate(() =>
      typeof handler === 'function'
        ? handler(event)
        : handler[0](handler[1], event)
    );
  };

  const content = children(() => (
    <>
      {local.children}
      <CopyFeedback />
    </>
  ));
  return (
    <Dynamic
      component={local.as ?? Button}
      {...rest}
      class={cn('relative', local.class)}
      ref={mergeRefs((element) => (button = element), local.ref)}
      on:click={onClick}
    >
      {content()}
    </Dynamic>
  );
}
