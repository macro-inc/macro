import { ViewShell } from '@app/components/view-shell/ViewShell';
import { ViewSidebar } from '@app/components/view-shell/ViewSidebar';
import ArrowLeft from '@icon/system/regular/arrow-left.svg';
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
          aria-label="Back to conversations"
          tooltip="Back to conversations"
          variant="ghost"
          size="icon-md"
          onClick={props.onBack}
        >
          <ArrowLeft class="size-4 touch:size-6 shrink-0 pointer-events-none" />
        </Button>
      </Show>
      <div class="flex min-w-0 items-center gap-1">
        {props.titleContent ?? (
          <Show when={props.title}>
            <ViewSidebar.Title caret={false}>{props.title}</ViewSidebar.Title>
          </Show>
        )}
      </div>
      <div class="header-actions ml-auto flex shrink-0 items-center gap-2 touch:gap-1">
        {props.children}
      </div>
    </ViewShell.TopBar>
  );
}
