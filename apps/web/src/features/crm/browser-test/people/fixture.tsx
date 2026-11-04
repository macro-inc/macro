import type { FilterContext } from '@app/features/next-soup/filters/configs/base';
import type { PredicateConfig } from '@app/features/next-soup/filters/filter-store/predicates-store';
import type { EntityData } from '@entity';
import '../../../../index.css';
import { SearchBar } from '@app/components/view-shell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { registerActiveGraphqlSoupQuery } from '@queries/soup/graphql/active-queries';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { createSoupLiveQuery } from '@queries/soup/graphql/create-soup-live-query';
import { storageServiceClient } from '@service-storage/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui';
import { createSignal, For, onCleanup, Show, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { createPredicatesStore } from '../../../next-soup/filters/filter-store/predicates-store';
import { createQueryStore } from '../../../next-soup/filters/filter-store/query-store';
import {
  crmContactActiveFilter,
  crmContactHiddenFilter,
} from '../../collection-filters';
import {
  PeopleDisplayMenu,
  RemovedPeopleNotice,
} from '../../components/people-display-menu';
import { RecordVisibilityAction } from '../../components/record-visibility-action';
import {
  bindPeopleVisibility,
  createPeopleVisibility,
} from '../../primitives/people-visibility';
import {
  useContactQuery,
  useSetContactHiddenMutation,
} from '../../queries/contacts';
import {
  readHeld,
  releaseRead,
  requests,
  setHoldNextRead,
} from './graphql-preview';
import {
  role,
  setFailNext,
  setFailRead,
  setRole,
  setTeamId,
  setUserId,
  teamId,
  userId,
  writes,
} from './preview-adapters';

const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const deps = { client, storage: storageServiceClient };
document.documentElement.dataset.touchDevice = String(isTouchDevice());

function Detail(props: { id: string; close(): void }) {
  const query = useContactQuery(deps, () => props.id);
  const mutation = useSetContactHiddenMutation(deps);
  const [error, setError] = createSignal('');
  return (
    <section
      aria-label="Contact detail"
      class="flex flex-col gap-3 p-4 border-b border-edge-muted"
    >
      <Button onClick={props.close}>Back to People</Button>
      <Show
        when={query.isSuccess ? query.data : undefined}
        fallback={<p>Contact unavailable</p>}
      >
        {(contact) => (
          <>
            <h2>{contact().name}</h2>
            <RecordVisibilityAction
              recordId={contact().id}
              name={contact().name ?? 'Contact'}
              kind="contact"
              hidden={contact().hidden}
              canManage={role() !== 'member'}
              pending={mutation.isPending}
              onChange={(hidden, onSuccess) => {
                setError('');
                mutation.mutate(
                  { contactId: contact().id, hidden },
                  {
                    onSuccess,
                    onError: () =>
                      setError('Could not update contact visibility'),
                  }
                );
              }}
            />
            <output aria-label="Contact identity">
              {contact().id} / {contact().companyId ?? 'unfiled'}
            </output>
            <Show when={error()}>
              <p role="alert">{error()}</p>
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}
function Fixture() {
  const [activeTab, setActiveTab] = createSignal('people');
  const [selected, setSelected] = createSignal<string>();
  const visibility = createPeopleVisibility({
    userId,
    teamId,
    isAdmin: () => role() !== 'member',
    activeTab,
  });
  const queryFilters = createQueryStore({
    initial: { include: { crmContactHidden: false } },
  });
  const predicates = createPredicatesStore<
    EntityData,
    FilterContext,
    PredicateConfig<EntityData, string, FilterContext>
  >({ configs: [crmContactActiveFilter, crmContactHiddenFilter] });
  bindPeopleVisibility(visibility, {
    activeTab,
    queryFilters,
    soup: { predicates },
  });
  const source = createSoupLiveQuery(
    () =>
      makeGraphqlSoupInput({
        params: { limit: 2, sort_method: 'updated_at' },
        body: queryFilters.compile(),
      }).initial,
    () => ({ enabled: activeTab() === 'people' })
  );
  onCleanup(
    registerActiveGraphqlSoupQuery({
      isEnabled: source.isEnabled,
      body: queryFilters.compile,
      refresh: source.refresh,
    })
  );
  const rows = () =>
    (source.data() ?? []).flatMap((row) => {
      if (row.__typename !== 'GraphqlSoupCrmContact') return [];
      const entity: EntityData = {
        type: 'crm_contact',
        id: row.id,
        name: row.crmContactName ?? '',
        ownerId: row.contactTeamId,
        teamId: row.contactTeamId,
        hidden: row.hidden,
        companyId: row.contactCompanyId,
      };
      return predicates.test(entity, {
        crmRemovedPeopleTeamId: visibility.removedTeamId(),
      })
        ? [row]
        : [];
    });
  return (
    <QueryClientProvider client={client}>
      <main class="flex h-dvh flex-col overflow-auto bg-panel text-ink">
        <nav
          class="flex flex-wrap gap-2 p-3 border-b border-edge-muted"
          aria-label="Fixture controls"
        >
          <Button
            onClick={() => {
              setSelected(undefined);
              setActiveTab(activeTab() === 'people' ? 'active' : 'people');
            }}
          >
            Toggle list
          </Button>
          <Button
            onClick={() => {
              setSelected(undefined);
              setRole(role() === 'member' ? 'admin' : 'member');
              client.clear();
            }}
          >
            Toggle member
          </Button>
          <Button
            onClick={() => {
              setSelected(undefined);
              setTeamId(teamId() === 'team-1' ? 'team-2' : 'team-1');
              client.clear();
            }}
          >
            Switch team
          </Button>
          <Button
            onClick={() => {
              setSelected(undefined);
              setUserId(userId() === 'user-1' ? 'user-2' : 'user-1');
              client.clear();
            }}
          >
            Switch account
          </Button>
          <Button onClick={() => setFailNext(true)}>Fail next write</Button>
          <Button onClick={() => setFailRead(true)}>Fail next query</Button>
          <Button onClick={() => setHoldNextRead(true)}>Hold next query</Button>
          <Show when={readHeld()}>
            <Button onClick={releaseRead}>Release query</Button>
          </Show>
          <Button
            onClick={() => {
              queryFilters.set({
                include: {
                  crmContactHidden: true,
                  crmContactTeamId: ['team-2'],
                },
              });
              predicates.set({ or: ['crm-contact-hidden'] });
            }}
          >
            Inject hidden filters
          </Button>
          <Button onClick={() => setSelected('removed-a')}>
            Open removed directly
          </Button>
        </nav>
        <Show when={activeTab() === 'people'} fallback={<h1>Companies</h1>}>
          <header class="flex items-center gap-2 px-4 py-3">
            <h1 class="flex-1 text-lg font-semibold">
              {visibility.showRemoved() ? 'Removed people' : 'People'}
            </h1>
            <PeopleDisplayMenu visibility={visibility} />
          </header>
          <div class="px-4 pb-3">
            <SearchBar
              label="Search people"
              placeholder="Search people"
              value={queryFilters.state.include.crmContactSearch ?? ''}
              onValueChange={(value) =>
                queryFilters.set({
                  include: { crmContactSearch: value || undefined },
                })
              }
            />
          </div>
          <Show when={visibility.showRemoved()}>
            <RemovedPeopleNotice
              onShowActive={() => visibility.setShowRemoved(false)}
            />
          </Show>
          <Suspense fallback={<p>Loading contact</p>}>
            <Show when={selected()}>
              {(id) => (
                <Detail id={id()} close={() => setSelected(undefined)} />
              )}
            </Show>
          </Suspense>
          <section aria-label="People results" class="flex flex-col px-4">
            <Show when={source.isLoading()}>
              <p role="status">Loading people</p>
            </Show>
            <Show when={source.error()}>
              <p role="alert">Could not load people</p>
              <Button onClick={() => source.refresh()}>Retry</Button>
            </Show>
            <For each={rows()}>
              {(row) => (
                <Show
                  when={
                    row.__typename === 'GraphqlSoupCrmContact' ? row : undefined
                  }
                >
                  {(contact) => (
                    <button
                      type="button"
                      class="text-left min-h-12 border-b border-edge-muted"
                      onClick={() => setSelected(contact().id)}
                    >
                      {contact().crmContactName}
                    </button>
                  )}
                </Show>
              )}
            </For>
            <Show
              when={
                !source.isLoading() && !source.error() && rows().length === 0
              }
            >
              <p>
                {visibility.showRemoved() ? 'No removed people' : 'No people'}
              </p>
            </Show>
            <Show when={source.hasNextPage()}>
              <Button
                disabled={source.isFetchingNextPage()}
                onClick={() => source.fetchNextPage()}
              >
                Load more
              </Button>
            </Show>
          </section>
          <output aria-label="Successful writes">{writes()}</output>
          <output aria-label="Request count">{requests().length}</output>
          <output aria-label="Requests" class="hidden">
            {JSON.stringify(requests())}
          </output>
        </Show>
      </main>
    </QueryClientProvider>
  );
}
render(Fixture, document.getElementById('root')!);
