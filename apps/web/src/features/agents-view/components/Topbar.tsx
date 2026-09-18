import { ViewShell } from '@app/components/view-shell/ViewShell';
import { SplitPanel } from '@components/app/split-panel';
import type { JSX } from 'solid-js';

/** Shared workspace chrome for conversation and new-session pages. */
export function Topbar(props: {
  title: string;
  titleContent?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <ViewShell.TopBar class="touch:flex">
      <SplitPanel.CloseButton class="hidden shrink-0 @max-[720px]/view-shell:flex" />
      <div class="flex min-w-0 items-center gap-1">
        {props.titleContent ?? (
          <h1 class="min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink">
            {props.title}
          </h1>
        )}
      </div>
      <div class="ml-auto flex shrink-0 items-center gap-2">
        {props.children}
      </div>
    </ViewShell.TopBar>
  );
}
