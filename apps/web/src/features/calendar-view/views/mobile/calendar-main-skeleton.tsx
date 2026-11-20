import { ViewShell } from '@app/components/view-shell';
import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import type { ParentProps } from 'solid-js';

/** Reserve the same three islands as the loaded touch header. */
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
          <ViewSkeleton.Control control={1} />
        </ViewShell.TopBarTitle>
        <ViewShell.TopBarActions>
          <ViewShell.TopBarIsland>
            <ViewSkeleton.Control control={1} />
          </ViewShell.TopBarIsland>
        </ViewShell.TopBarActions>
      </ViewShell.TopBar>
      <div class="flex min-h-0 flex-1 pt-[var(--mobile-content-inset-top,0px)]">
        {props.children}
      </div>
    </ViewSkeleton.Main>
  );
}
