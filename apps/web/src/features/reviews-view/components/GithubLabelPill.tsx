import { liveThemeMode } from '@app/features/theme/signals/themeSignals';
import { cn } from '@ui';
import { githubLabelColors } from '../github-label-colors';

/** A GitHub label drawn the way GitHub draws it, for the active theme. */
export function GithubLabelPill(props: {
  name: string;
  /** GitHub's six-digit hex color, with or without `#`. */
  color?: string;
  class?: string;
}) {
  const style = () => {
    const colors = githubLabelColors(props.color, liveThemeMode());
    return {
      color: colors.color,
      'background-color': colors.background,
      'border-color': colors.border,
    };
  };

  return (
    <span
      class={cn(
        'inline-flex h-5 max-w-full min-w-0 items-center rounded-full border px-[7px] text-xs leading-none font-medium',
        props.class
      )}
      style={style()}
    >
      <span class="truncate">{props.name}</span>
    </span>
  );
}
