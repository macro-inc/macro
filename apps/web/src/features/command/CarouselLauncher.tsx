import { Show } from 'solid-js';
import { CarouselCards } from './components/CarouselCards';
import { type LauncherInnerProps, LauncherShell } from './Launcher';

/** Production carousel, sharing creation, history, and shortcuts with the list. */
export default function CarouselLauncher(props: LauncherInnerProps) {
  return (
    <LauncherShell {...props} horizontalNavigation>
      {(state) => (
        <Show
          when={state.blocks().length}
          fallback={
            <div
              role="status"
              class="flex h-56 items-center justify-center pb-12 text-sm text-ink-muted"
            >
              No matching create options
            </div>
          }
        >
          <CarouselCards
            items={state.blocks()}
            selectedIndex={state.selectedIndex()}
            itemId={state.itemId}
            showHotkeys={!state.searchMode()}
            onSelect={state.select}
            onStep={state.step}
            onChoose={state.choose}
          />
        </Show>
      )}
    </LauncherShell>
  );
}
