import Check from '@icon/system/regular/check.svg';
import type { JSX } from 'solid-js';
import { cn } from '../utils/classname';

/** Transition the explicitly supplied icon without measuring or inspecting it. */
export function CopyFeedback(props: {
  copied: boolean;
  children: JSX.Element;
}) {
  return (
    <span class="relative inline-flex shrink-0" aria-hidden="true">
      <span
        class={cn(
          'inline-flex transition-[opacity,filter] duration-150 motion-reduce:transition-none',
          props.copied ? 'opacity-0 blur-xs' : 'opacity-100 blur-none'
        )}
      >
        {props.children}
      </span>
      <Check
        data-copy-feedback={props.copied ? '' : undefined}
        class={cn(
          'absolute inset-0 size-full text-success transition-[opacity,filter] duration-150 motion-reduce:transition-none',
          props.copied ? 'opacity-100 blur-none' : 'opacity-0 blur-xs'
        )}
      />
    </span>
  );
}
