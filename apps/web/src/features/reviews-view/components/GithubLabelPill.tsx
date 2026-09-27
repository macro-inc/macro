import { DEFAULT_TAG_COLOR } from '@property/tags/tagColors';
import { cn } from '@ui';

/**
 * A GitHub label drawn the way GitHub draws it. Dark themes tint the pill and
 * lighten dark label colors until the text is readable; light themes fill with
 * the label color and flip the text to black or white by its lightness.
 */
export function GithubLabelPill(props: {
  name: string;
  /** A CSS color; falls back to the default tag color. */
  color?: string;
  class?: string;
}) {
  return (
    <span
      class={cn(
        'inline-flex h-5 max-w-full min-w-0 items-center rounded-full border px-[7px] text-xs leading-none font-medium',
        'dark-mode:border-[color:oklch(from_var(--label-color)_max(l,0.72)_c_h/0.3)] dark-mode:bg-[oklch(from_var(--label-color)_l_c_h/0.18)] dark-mode:text-[color:oklch(from_var(--label-color)_max(l,0.72)_c_h)]',
        'light-mode:border-[color:oklch(from_var(--label-color)_calc(l_-_0.25)_c_h/clamp(0,(l_-_0.95)_*_100,1))] light-mode:bg-(--label-color) light-mode:text-[color:oklch(from_var(--label-color)_clamp(0,(0.66_-_l)_*_1000,1)_0_0)]',
        props.class
      )}
      style={{ '--label-color': props.color ?? DEFAULT_TAG_COLOR }}
    >
      <span class="truncate">{props.name}</span>
    </span>
  );
}
