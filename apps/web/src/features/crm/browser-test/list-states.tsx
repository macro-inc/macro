import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Button } from '@ui';
import { createSignal, Match, Switch } from 'solid-js';
import { render } from 'solid-js/web';
import {
  CrmListEmpty,
  CrmListError,
  CrmListSearchEmpty,
  CrmListSkeleton,
} from '../components/list-state';
import { RecordSection } from '../components/record-section';
import { RecordTabs } from '../components/record-tabs';
import { COMPANY_SECTIONS, type CompanySection } from '../core/record';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const initialState =
  new URLSearchParams(location.search).get('state') ?? 'empty';

function Fixture() {
  const [section, setSection] = createSignal<CompanySection>('databases');
  const [state, setState] = createSignal(initialState);
  const [search, setSearch] = createSignal(
    initialState === 'search' ? 'missing' : ''
  );
  const [action, setAction] = createSignal('');
  return (
    <main
      class="flex h-dvh flex-col bg-panel text-ink"
      style={{
        '--mobile-content-inset-top': '47px',
        '--mobile-content-inset-bottom': '40px',
      }}
    >
      <div class="shrink-0 overflow-x-auto p-3">
        <RecordTabs
          sections={COMPANY_SECTIONS}
          value={section()}
          onChange={setSection}
          compact
        />
      </div>
      <RecordSection
        title="Databases"
        search={search()}
        onSearchChange={(value) => {
          setSearch(value);
          setState(value ? 'search' : 'empty');
        }}
        actions={
          <Button variant="outline" onClick={() => setAction('create')}>
            New database
          </Button>
        }
      >
        <Switch>
          <Match when={state() === 'loading'}>
            <CrmListSkeleton label="Loading databases" />
          </Match>
          <Match when={state() === 'error'}>
            <CrmListError onRetry={async () => setAction('retry')} />
          </Match>
          <Match when={state() === 'search'}>
            <CrmListSearchEmpty
              title="No matching databases"
              onClearSearch={() => {
                setSearch('');
                setState('empty');
              }}
            />
          </Match>
          <Match when={true}>
            <CrmListEmpty
              title="No linked databases yet"
              description="Add a company or contact reference to a row to see the database here."
              action={{
                label: 'New database',
                onClick: () => setAction('create'),
              }}
            />
          </Match>
        </Switch>
      </RecordSection>
      <output class="sr-only" aria-label="Last action">
        {action()}
      </output>
      <output class="sr-only" aria-label="Selected section">
        {section()}
      </output>
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
