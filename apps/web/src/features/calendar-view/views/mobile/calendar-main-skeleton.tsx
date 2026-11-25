import { ViewShell } from '@app/components/view-shell';
import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import type { ParentProps } from 'solid-js';

/** Reserve the same month, Today, and Search islands as the loaded header. */
export function MobileCalendarMainSkeleton(props: ParentProps) {
  return (
    <ViewSkeleton.Main>
      <ViewShell.TopBar
        touch
        navigation={
          <ViewShell.TopBarIsland>
            <ViewSkeleton.Control control={1} />
          </ViewShell.TopBarIsland>
        }
      >
        <ViewShell.TopBarTitle>
          <ViewSkeleton.Control control="November" />
        </ViewShell.TopBarTitle>
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <ViewShell.TopBarIsland class="size-10 justify-center p-0">
            <ViewSkeleton.Control control={1} />
          </ViewShell.TopBarIsland>
          <ViewShell.TopBarIsland class="size-10 justify-center p-0">
            <ViewSkeleton.Control control={1} />
          </ViewShell.TopBarIsland>
        </div>
      </ViewShell.TopBar>
      <div class="flex min-h-0 flex-1 pt-[var(--mobile-content-inset-top,0px)]">
        {props.children}
      </div>
    </ViewSkeleton.Main>
  );
}
