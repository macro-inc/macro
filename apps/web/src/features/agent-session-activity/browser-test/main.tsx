import { SidePanel } from '@components/app/side-panel';
import { UserContextProvider } from '@core/context/user';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import '@fontsource-variable/inter';
import '../../../index.css';
import {
  type AgentActivityRow,
  AgentActivitySourceProvider,
} from '../context/agent-activity-source';
import { AgentActivitySection } from '../views/agent-activity-section';

const INITIAL_ROWS: AgentActivityRow[] = Array.from(
  { length: 12 },
  (_, index) => ({
    id: String(12 - index),
    entityType: 'document',
    entityId: String(12 - index),
    action: 'created',
    verb: 'created',
    occurredAt: new Date(Date.now() - index * 60_000).toISOString(),
  })
);

function Fixture() {
  const [rows, setRows] = createSignal(INITIAL_ROWS);
  let nextId = 13;
  const addUpdate = () => {
    const id = String(nextId++);
    setRows((current) => [
      {
        id,
        entityType: 'document',
        entityId: '3',
        action: 'edited',
        verb: 'edited',
        occurredAt: new Date().toISOString(),
      },
      ...current,
    ]);
  };
  const addNew = () => {
    const id = String(nextId++);
    setRows((current) => [
      {
        id,
        entityType: 'document',
        entityId: id,
        action: 'created',
        verb: 'created',
        occurredAt: new Date().toISOString(),
      },
      ...current,
    ]);
  };
  return (
    <main class="flex h-dvh flex-col bg-page p-3">
      <div class="flex gap-2">
        <button type="button" onClick={addUpdate}>
          Update document 3
        </button>
        <button type="button" onClick={addNew}>
          Add document
        </button>
      </div>
      <SidePanel.Root
        floating
        persistentFloating
        defaultOpen
        persistKey="activity-test"
      >
        <SidePanel.Toggle />
        <div class="relative min-h-0 flex-1">
          <SidePanel.Layout headerToggle={false} floating persistentFloating>
            <AgentActivitySourceProvider
              value={{
                rows,
                isPending: () => false,
                hasMore: () => false,
                loadMore: () => {},
              }}
            >
              <AgentActivitySection />
            </AgentActivitySourceProvider>
            <SidePanel.Section
              id="below"
              title={<span data-below-section>Session</span>}
              order={10}
            >
              <span />
            </SidePanel.Section>
            <section class="size-full" aria-label="Agent session" />
          </SidePanel.Layout>
        </div>
      </SidePanel.Root>
    </main>
  );
}

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <UserContextProvider>
        <Fixture />
      </UserContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);
