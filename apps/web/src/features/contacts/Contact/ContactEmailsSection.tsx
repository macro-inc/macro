import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { useInfiniteScrollSentinel } from '@companies/Company/use-infinite-scroll-sentinel';
import { TabsInset } from '@core/component/TabsInset';
import { ListEntity, ListLayoutProvider } from '@entity';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { createSignal, For, Show } from 'solid-js';
import {
  type EmailSignalView,
  type EmailView,
  useContactEmailsQuery,
} from './use-contact-emails-query';

export function ContactEmailsSection(props: { contact?: CrmContactResponse }) {
  const email = () => props.contact?.email;
  const [view, setView] = createSignal<EmailView>('team');
  const [signalView, setSignalView] = createSignal<EmailSignalView>('all');
  const emailsQuery = useContactEmailsQuery(email, view, signalView);
  const emails = () => emailsQuery.data?.entities ?? [];

  const [listRef, setListRef] = createSignal<HTMLElement>();
  const [sentinelRef, setSentinelRef] = createSignal<HTMLDivElement>();

  useInfiniteScrollSentinel({
    sentinel: sentinelRef,
    hasNextPage: () => emailsQuery.hasNextPage ?? false,
    isFetchingNextPage: () => emailsQuery.isFetchingNextPage,
    fetchNextPage: () => emailsQuery.fetchNextPage(),
  });

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-medium text-ink-muted">Emails</h2>
        <div class="flex items-center gap-2.5">
          <TabsInset
            list={[
              { value: 'signal', label: 'Signal' },
              { value: 'all', label: 'All' },
            ]}
            value={signalView()}
            onChange={(v) => setSignalView(v as EmailSignalView)}
          />
          <TabsInset
            list={[
              { value: 'team', label: 'Team' },
              { value: 'me', label: 'Me' },
            ]}
            value={view()}
            onChange={(v) => setView(v as EmailView)}
          />
        </div>
      </div>
      <Show
        when={props.contact && !emailsQuery.isLoading}
        fallback={
          <div class="p-6 text-center text-sm text-ink-muted">Loading…</div>
        }
      >
        <Show
          when={emails().length > 0}
          fallback={
            <div class="rounded-lg border border-dashed border-edge-muted p-6 text-center text-sm text-ink-muted">
              {`No ${signalView() === 'signal' ? 'signal emails' : 'emails'} with this contact ${view() === 'me' ? 'in your inbox' : 'yet'}.`}
            </div>
          }
        >
          <div class="max-h-96 overflow-y-auto">
            <ListLayoutProvider ref={listRef}>
              <div ref={setListRef} class="flex flex-col">
                <For each={emails()}>
                  {(entity) => (
                    <ListEntity
                      entity={entity}
                      timestamp={entity.updatedAt}
                      onClick={() =>
                        openEntityInSplitFromUnifiedList(entity, {})
                      }
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
          </div>
        </Show>
      </Show>
    </div>
  );
}
