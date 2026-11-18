import '../../../../index.css';
import { fireAndForget } from '@core/util/fireAndForget';
import { createCrmAccessAuthority } from '@service-storage/crm-access-authority';
import { Button } from '@ui';
import { createSignal, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { CrmAccessFallback } from '../../components/access-denied';
import { CrmMobileTabs } from '../../components/crm-mobile-tabs';
import { CrmSidebar } from '../../components/crm-sidebar';

// Production navigation and authority state, with local-only response fixtures.
function Fixture() {
  const authority = createCrmAccessAuthority({
    fetchProof: async () => {
      const response = await fetch('/fixture-authority');
      const policy = response.headers.get('x-macro-crm-access');
      if (!policy) throw new Error('Missing permission proof');
      return policy;
    },
    retire: async () => {},
  });
  authority.setSession('fixture-viewer');
  const [active, setActive] = createSignal(
    new URLSearchParams(location.search).get('view') === 'pipeline'
      ? 'pipeline:shared'
      : 'active'
  );
  const [failed, setFailed] = createSignal(false);
  const refresh = async () => {
    try {
      await authority.refresh();
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  onMount(() => {
    fireAndForget(refresh(), 'crm.access.fixture');
  });
  const pipelines = [{ id: 'shared', name: 'Shared pipeline' }];
  const lists = [{ id: 'private', name: 'Private collection', count: 3 }];
  return (
    <main class="flex h-dvh flex-col bg-panel text-ink">
      <div class="flex flex-wrap items-center gap-2 border-b border-edge-muted p-3">
        <Button onClick={refresh}>Check access</Button>
        <Button onClick={() => setActive('active')}>Open records route</Button>
        <Button onClick={() => setActive('pipeline:shared')}>
          Open shared pipeline
        </Button>
        <Show when={failed()}>
          <p role="alert">Access could not be refreshed</p>
        </Show>
      </div>
      <div class="flex min-h-0 flex-1">
        <aside class="hidden w-64 shrink-0 border-r border-edge-muted md:flex">
          <CrmSidebar
            active={active()}
            canAccess={authority.allowed()}
            pipelines={
              <Button onClick={() => setActive('pipeline:shared')}>
                Shared pipeline
              </Button>
            }
            lists={lists}
            listsEnabled
            listsLoading={false}
            listsError={false}
            canCreateList
            onNavigate={setActive}
            onCreateCompany={() => {}}
            onCreateContact={() => {}}
            onNewList={() => {}}
            onImport={() => {}}
            onExport={() => {}}
            onSettings={() => {}}
          />
        </aside>
        <section class="flex min-w-0 flex-1 flex-col">
          <div class="min-w-0 border-b border-edge-muted px-4 md:hidden">
            <CrmMobileTabs
              active={active()}
              canAccess={authority.allowed()}
              pipelines={pipelines}
              lists={lists}
              onNavigate={setActive}
            />
          </div>
          <Show
            when={active() === 'pipeline:shared'}
            fallback={
              <Show
                when={authority.allowed()}
                fallback={<CrmAccessFallback state={authority.state()} />}
              >
                <div class="p-6">
                  <h1 class="text-xl font-semibold">Company records</h1>
                  <p>Private record content</p>
                </div>
              </Show>
            }
          >
            <div class="p-6">
              <h1 class="text-xl font-semibold">Shared pipeline</h1>
              <table class="mt-4 w-full text-left">
                <thead>
                  <tr>
                    <th>Record reference</th>
                    <th>Stage</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() => setActive('record')}
                      >
                        Open referenced record
                      </Button>
                    </td>
                    <td>Qualified</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Show>
        </section>
      </div>
    </main>
  );
}
render(Fixture, document.getElementById('root')!);
