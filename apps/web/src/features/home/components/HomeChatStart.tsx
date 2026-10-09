import {
  useViewShell,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { rememberBootShell } from '@components/app/boot-shell';
import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { ChatInputProvider } from '@core/component/AI/context';
import { onMount, Show } from 'solid-js';
import { UniversalInput } from '../../universal-input/universal-input';
import { HomeRecommendedActions } from './home-recommended-actions';

/** Desktop Home starts with an uncommitted thought, then reveals its destination. */
export function HomeChatStart() {
  const shell = useViewShell();
  const showHomeTopBar = () =>
    shell.aside.isCollapsed() || shell.aside.isOverlay();
  onMount(() => rememberBootShell({ homeComposer: 'universal' }));
  return (
    <ChatInputProvider>
      <Show when={showHomeTopBar()}>
        <ViewShell.TopBar>
          <ViewSidebar.Title>Home</ViewSidebar.Title>
        </ViewShell.TopBar>
      </Show>
      <DragDropWrapper class="relative min-h-0 min-w-0 flex-1 overflow-y-auto px-6">
        <div
          class="mx-auto flex min-h-full w-full max-w-180 flex-col pt-[min(24vh,180px)] pb-16"
          data-home-composer-align="universal"
        >
          <UniversalInput />
          <div class="mt-6 min-w-0 pb-8">
            <HomeRecommendedActions />
          </div>
        </div>
      </DragDropWrapper>
    </ChatInputProvider>
  );
}
