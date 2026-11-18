import '@fontsource-variable/inter';
import '@app/index.css';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { authKeys } from '@queries/auth/keys';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { closestCenter, DragDropProvider } from '@thisbeyond/solid-dnd';
import { Button } from '@ui';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { CollapsibleSection } from '../CollapsibleSection';
import { ViewSidebar } from '../ViewSidebar';

document.documentElement.dataset.touchDevice = String(isTouchDevice());

function Section(props: { id: string }) {
  const [open, setOpen] = createSignal(true);
  const [count, setCount] = createSignal(0);
  return (
    <CollapsibleSection.Root
      sectionId={props.id}
      sectionLabel={props.id}
      open={open()}
      onOpenChange={setOpen}
    >
      <CollapsibleSection.Header>
        <CollapsibleSection.Trigger>{props.id}</CollapsibleSection.Trigger>
        <CollapsibleSection.Action
          aria-label={`Action ${props.id}`}
          onClick={() => setCount(count() + 1)}
        >
          +
        </CollapsibleSection.Action>
      </CollapsibleSection.Header>
      <CollapsibleSection.Content>
        <p>
          {props.id} action count: {count()}
        </p>
        <input aria-label={`${props.id} draft`} />
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}

function Fixture() {
  const [view, setView] = createSignal('mail');
  return (
    <div class="min-h-dvh bg-panel p-4 text-ink">
      <div class="mb-4 flex gap-2">
        <Button onClick={() => setView('mail')}>Mail fixture</Button>
        <Button onClick={() => setView('drive')}>Drive fixture</Button>
      </div>
      <div class="h-[600px] w-72 max-w-full border border-edge-muted">
        <DragDropProvider collisionDetector={closestCenter}>
          <ViewSidebar.Root reorderId={view()} aria-label="Fixture sidebar">
            <ViewSidebar.Content>
              <span>Fixed top</span>
              <For each={['First', 'Middle', 'Last']}>
                {(id) => <Section id={id} />}
              </For>
              <span>Fixed bottom</span>
            </ViewSidebar.Content>
          </ViewSidebar.Root>
        </DragDropProvider>
      </div>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
});
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: 'sidebar-fixture',
  authenticated: true,
});
const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <UserContextProvider>
          <Fixture />
        </UserContextProvider>
      </QueryClientProvider>
    ),
    root
  );
