import '@app/index.css';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ViewShell } from '../ViewShell';
import { ViewSidebar } from '../ViewSidebar';

document.documentElement.dataset.touchDevice = 'true';
document.documentElement.dataset.platform = 'ios';

function Fixture() {
  const [tab, setTab] = createSignal('all');
  return (
    <div class="h-dvh bg-panel text-ink">
      <ViewShell.Root asidePreferenceKey="touch-fixture" resizable>
        <ViewShell.Aside>
          <ViewSidebar.Root aria-label="Workspace navigation">
            <ViewSidebar.Header>
              <ViewSidebar.Title>Drive</ViewSidebar.Title>
            </ViewSidebar.Header>
            <ViewSidebar.Content>
              <ViewSidebar.Item onClick={() => setTab('all')}>
                All files
              </ViewSidebar.Item>
            </ViewSidebar.Content>
          </ViewSidebar.Root>
        </ViewShell.Aside>
        <ViewShell.Main>
          <ViewShell.Header>
            <PillTabs
              scrollable
              leading={
                <>
                  <ViewSidebar.Toggle action="expand" presentation="pill" />
                  <button
                    type="button"
                    class="island size-10 rounded-full"
                    aria-label="Filters"
                  >
                    Filters
                  </button>
                </>
              }
              items={[
                { value: 'all', label: 'All' },
                { value: 'recent', label: 'Recent' },
              ]}
              value={tab()}
              onChange={setTab}
            />
          </ViewShell.Header>
          <p>Selected: {tab()}</p>
        </ViewShell.Main>
      </ViewShell.Root>
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
