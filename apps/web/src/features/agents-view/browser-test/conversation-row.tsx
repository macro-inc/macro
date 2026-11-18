import '@app/index.css';
import { ViewSidebar } from '@app/components/view-shell';
import { Button } from '@ui';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { ConversationRowRoot } from '../components/conversation-row/root';
import { ConversationRowTitle } from '../components/conversation-row/title';
import { ConversationRowTrailing } from '../components/conversation-row/trailing';

function Fixture() {
  const [age, setAge] = createSignal('2m');
  return (
    <div class="min-h-screen bg-page p-8 text-ink">
      <Button onClick={() => setAge('September 21')}>Longer age</Button>
      <aside class="w-[260px]">
        <ViewSidebar.Root>
          <For each={[false, true]}>
            {(active) => (
              <ConversationRowRoot
                id={active ? 'active' : 'inactive'}
                title="A long conversation title that truncates inside the sidebar"
                kind="code"
                state="dormant"
                active={active}
              >
                <ConversationRowTitle />
                <ConversationRowTrailing age={age()}>
                  <button type="button" aria-label="Code details">
                    ↗
                  </button>
                </ConversationRowTrailing>
              </ConversationRowRoot>
            )}
          </For>
        </ViewSidebar.Root>
      </aside>
    </div>
  );
}
render(() => <Fixture />, document.getElementById('root')!);
