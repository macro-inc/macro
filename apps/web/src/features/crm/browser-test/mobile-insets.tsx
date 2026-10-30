import '@app/index.css';
import { EntityDetailTopBar } from '@app/components/entity-detail/EntityDetailTopBar';
import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { SidePanel } from '@components/app/side-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Button } from '@ui';
import { createSignal, For, Match, Switch } from 'solid-js';
import { render } from 'solid-js/web';
import { CrmMobileTabs } from '../components/crm-mobile-tabs';
import { RecordOverview } from '../components/record-overview';
import { RecordSection } from '../components/record-section';

// Production layout components with local content; no account or backend writes.
const params = new URLSearchParams(location.search);
const surface = params.get('surface') ?? 'company';
const safeTop = Number(params.get('safe') ?? 47);
const headerHeight = ['company', 'contact', 'reviews'].includes(surface)
  ? 45
  : 0;
document.documentElement.dataset.touchDevice = String(isTouchDevice());

function Fixture() {
  const [tab, setTab] = createSignal('active');
  const [search, setSearch] = createSignal('');
  const [section, setSection] = createSignal('overview');
  return (
    <main
      class="relative flex h-dvh flex-col bg-panel text-ink"
      style={{
        '--safe-top': `${safeTop}px`,
        '--mobile-content-inset-top': `${safeTop + headerHeight}px`,
        '--mobile-content-inset-bottom': '80px',
      }}
    >
      <Switch>
        <Match when={surface === 'crm' || surface === 'reviews'}>
          <ViewShell.Header>
            <CrmMobileTabs
              active={tab()}
              pipelines={[{ id: 'sales', name: 'Sales' }]}
              lists={[]}
              onNavigate={setTab}
            />
          </ViewShell.Header>
          <div class="min-h-0 flex-1 overflow-auto touch:[--mobile-content-inset-top:0px]">
            <p>Selected: {tab()}</p>
          </div>
        </Match>
        <Match when={surface === 'project'}>
          <SidePanel.Root defaultOpen={false}>
            <ViewBreadcrumbs.Root value="project" onChange={() => {}}>
              <EntityDetailTopBar
                navigation={
                  <Button onClick={() => setSection('tasks')}>
                    Project tasks
                  </Button>
                }
              />
            </ViewBreadcrumbs.Root>
          </SidePanel.Root>
          <p>Selected: {section()}</p>
        </Match>
        <Match when={surface === 'company' || surface === 'contact'}>
          <nav
            aria-label="Record navigation"
            class="absolute inset-x-0 top-0 z-10 flex gap-2 bg-panel touch:top-(--safe-top) touch:h-11.25 not-touch:hidden"
          >
            <Button onClick={() => setSection('overview')}>Overview</Button>
            <Button onClick={() => setSection('files')}>Files</Button>
          </nav>
          <Switch>
            <Match when={section() === 'overview'}>
              <RecordOverview>
                <h1>
                  {surface === 'company' ? 'Acme company' : 'Maya contact'}
                </h1>
                <For each={Array.from({ length: 35 }, (_, i) => i)}>
                  {(index) => <p>Discussion item {index}</p>}
                </For>
                <Button>Last action</Button>
              </RecordOverview>
            </Match>
            <Match when={section() === 'files'}>
              <RecordSection
                title="Files"
                search={search()}
                onSearchChange={setSearch}
              >
                <p>{search() ? `Searching: ${search()}` : 'No files yet.'}</p>
              </RecordSection>
            </Match>
          </Switch>
        </Match>
      </Switch>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 top-0 bg-panel/80 touch:h-(--safe-top)"
      />
    </main>
  );
}
const root = document.getElementById('root');
if (root)
  render(
    () => (
      <AnalyticsContextProvider>
        <PosthogProvider>
          <Fixture />
        </PosthogProvider>
      </AnalyticsContextProvider>
    ),
    root
  );
