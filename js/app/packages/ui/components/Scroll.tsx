import { splitProps, type JSX } from 'solid-js';
import { cn } from '../utils/classname';

export type ScrollProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'> & {
  style?: JSX.CSSProperties;
};

export function Scroll(props: ScrollProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn(
        'relative size-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </div>
  );
}
