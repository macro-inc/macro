import { openEntityInSplitFromUnifiedList } from '@app/component/next-soup/utils';
import { TabsInset } from '@core/component/TabsInset';
import { type CrmCompanyEntity, ListEntity, ListLayoutProvider } from '@entity';
import { createMemo, createSignal, For, Show } from 'solid-js';
import {
  type EmailView,
  useCompanyEmailsQuery,
} from './use-company-emails-query';
import { useInfiniteScrollSentinel } from './use-infinite-scroll-sentinel';

export function CompanyEmailsSection(props: { company?: CrmCompanyEntity }) {
  const domains = createMemo(
    () => props.company?.domains.map((domain) => domain.domain) ?? []
  );
  const [view, setView] = createSignal<EmailView>('team');
  const emailsQuery = useCompanyEmailsQuery(domains, view);
  const emails = () => emailsQuery.data?.entities ?? [];

  const [listRef, setListRef] = createSignal<HTMLElement>();
  const [sentinelRef, setSentinelRef] = createSignal<HTMLDivElement>();

  useInfiniteScrollSentinel({
    sentinel: sentinelRef,
    hasNextPage: () => emailsQuery.hasNextPage ?? false,
    isFetchingNextPage: () => emailsQuery.isFetchingNextPage,
    fetchNextPage: () => emailsQuery.fetchNextPage(),
  });

  const emptyMessage = () => {
    if (view() === 'me') return 'No emails with this company in your inbox.';
    if (props.company?.emailSync === false) {
      return 'Email sync is disabled for this company.';
    }
    return 'No emails with this company yet.';
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-medium text-ink-muted">Emails</h2>
        <TabsInset
          list={[
            { value: 'team', label: 'Team' },
            { value: 'me', label: 'Me' },
          ]}
          value={view()}
          onChange={(v) => setView(v as EmailView)}
        />
      </div>
      <Show
        when={props.company && !emailsQuery.isLoading}
        fallback={
          <div class="p-6 text-center text-sm text-ink-muted">Loading…</div>
        }
      >
        <Show
          when={emails().length > 0}
          fallback={
            <div class="rounded-lg border border-dashed border-edge-muted p-6 text-center text-sm text-ink-muted">
              {emptyMessage()}
            </div>
          }
        >
          <ListLayoutProvider ref={listRef}>
            <div ref={setListRef} class="flex flex-col">
              <For each={emails()}>
                {(entity) => (
                  <ListEntity
                    entity={entity}
                    timestamp={entity.updatedAt}
                    onClick={() => openEntityInSplitFromUnifiedList(entity, {})}
                  />
                )}
              </For>
            </div>
          </ListLayoutProvider>
          <Show when={emailsQuery.hasNextPage}>
            <div ref={setSentinelRef} class="h-px" />
          </Show>
          <Show when={emailsQuery.isFetchingNextPage}>
            <div class="p-3 text-center text-xs text-ink-muted">
              Loading more…
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
