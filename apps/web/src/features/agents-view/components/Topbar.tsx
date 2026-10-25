import { ViewShell } from '@app/components/view-shell/ViewShell';
import ArrowLeft from '@phosphor/arrow-left.svg';
import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';

/** Shared workspace chrome for conversation and new-session pages. */
export function Topbar(props: {
  title?: string;
  onBack?: () => void;
  titleContent?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <ViewShell.TopBar class="touch:flex">
      <Show when={props.onBack}>
        <Button
          variant="ghost"
          size="icon-md"
          label="Back to conversations"
          onClick={props.onBack}
        >
          <ArrowLeft />
        </Button>
      </Show>
      <div class="flex min-w-0 items-center gap-1">
        {props.titleContent ?? (
          <Show when={props.title}>
            <h1 class="min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink">
              {props.title}
            </h1>
          </Show>
        )}
      </div>
      <div class="header-actions ml-auto flex shrink-0 items-center gap-2 touch:gap-1">
        {props.children}
      </div>
    </ViewShell.TopBar>
  );
}
