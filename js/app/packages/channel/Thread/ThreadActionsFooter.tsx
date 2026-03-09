import type { JSX } from 'solid-js';
import { replyCenterOffsetX } from './utils/thread-rail-geometry';

type ThreadActionsFooterProps = {
  children: JSX.Element;
};

export function ThreadActionsFooter(props: ThreadActionsFooterProps) {
  return (
    <div
      class="relative z-10 w-fit"
      style={{
        'margin-left': `calc(${replyCenterOffsetX} - var(--user-icon-width) / 2)`,
      }}
    >
      {props.children}
    </div>
  );
}
