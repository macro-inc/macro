import type { DecoratorHost } from '../context/DecoratorHostContext';

/** The complete editor dependency of the four selection-only chips. */
export type DecoratorSelectionHost = Pick<DecoratorHost, 'isSelected'>;
export interface DecoratorSelectionHostProp {
  readonly host?: DecoratorSelectionHost;
}
