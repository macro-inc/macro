import type { JSX } from 'solid-js';

type ThreadActionsFooterProps = {
  children: JSX.Element;
};

export function ThreadActionsFooter(props: ThreadActionsFooterProps) {
  return (
    <div class="relative z-10 w-fit ml-(--message-padding-x)">
      {props.children}
    </div>
  );
}
