import { type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';

/** Shared recessed frame for segmented choices and grouped actions. */
export function InsetControlTrack(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div
      {...rest}
      class={cn(
        'relative isolate flex items-center border border-edge-frame bg-ink/4 rounded-full p-0.5 has-focus-visible:ring-2 has-focus-visible:ring-edge-focus',
        local.class
      )}
    >
      {local.children}
    </div>
  );
}
