import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
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
    <main class="w-[320px] p-3">
      <div class="flex gap-2">
        <button onClick={addUpdate}>Update document 3</button>
        <button onClick={addNew}>Add document</button>
      </div>
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
      <div data-below-section class="h-10">
        Next section
      </div>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
