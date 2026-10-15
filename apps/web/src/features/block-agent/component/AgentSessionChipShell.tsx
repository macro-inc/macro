import { badgeClasses } from '@ui';
import type { JSX, ParentProps } from 'solid-js';

/** Pill chrome shared by the session header chips. */
export function ChipShell(props: ParentProps): JSX.Element {
  return (
    <span
      class={badgeClasses({
        size: 'sm',
        class: 'max-w-44 min-w-0 gap-1.5 hover:bg-hover hover:text-ink',
      })}
    >
      {props.children}
    </span>
  );
}
