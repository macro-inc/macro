import { Button, type ButtonProps } from '@ui';
import { splitProps } from 'solid-js';

export type ValuePillProps = Omit<ButtonProps, 'variant' | 'finish' | 'size'>;

/**
 * A quiet editable value using the shared Button's value treatment.
 * @do Compose menu carets as children only for values that open a menu.
 * @dont Put a read-only duration in a filled value pill.
 */
export function ValuePill(props: ValuePillProps) {
  const [local, rest] = splitProps(props, ['children']);
  return (
    <Button {...rest} variant="value" finish="flat" size="sm">
      {local.children}
    </Button>
  );
}
