import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import type { JSX } from 'solid-js';

/** Keeps the routine pane's top bar, and its split controls, before a routine loads. */
export function RoutineStatusFrame(props: {
  onBack: () => void;
  children: JSX.Element;
}) {
  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col text-ink">
      <ViewShell.TopBar aria-label="Routine toolbar">
        <ViewBreadcrumbs.ReturnButton
          onClick={() => props.onBack()}
          aria-label="Back to routines"
          tooltip="Routines"
        >
          Routines
        </ViewBreadcrumbs.ReturnButton>
      </ViewShell.TopBar>
      <div class="min-h-0 flex-1">{props.children}</div>
    </div>
  );
}
