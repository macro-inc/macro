import {
  AddOnlyGuestsEditor,
  EventGuestPicker,
} from '@app/features/calendar/components/composer/EventGuestsEditor';
import type { SelectedEventEditorGuest } from '@app/features/calendar/components/composer/event-form-model';
import { eventGuestOptions } from '@app/features/calendar/components/composer/guest-options';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import { contactUserItem } from '@core/context/quickAccess/person-items';
import type {
  Bucket,
  ItemForBucket,
  ItemsForBuckets,
  QuickAccessContextValue,
  QuickAccessList,
  QuickAccessListOptions,
} from '@core/context/quickAccess/types';
import { createContactDirectoryWindow } from '@queries/contacts/directory-query';
import { createContactExclusions } from '@queries/contacts/exclusions';
import { hashKey } from '@tanstack/solid-query';
import { createSignal, Show } from 'solid-js';
import { changeViewer } from './network';

const VIEWER = 'macro|viewer@example.com';
export const [reads, setReads] = createSignal(0);
const [lastRead, setLastRead] = createSignal('');
let factoryCount = 0;
const [lastExclusions, setLastExclusions] = createSignal<readonly string[]>([]);
function useList(): QuickAccessList;
function useList<B extends Bucket>(
  bucket: B
): QuickAccessList<ItemForBucket<B>>;
function useList<B extends Bucket[]>(
  ...buckets: B
): QuickAccessList<ItemsForBuckets<B>>;
function useList<const B extends readonly Bucket[]>(
  options: QuickAccessListOptions<B>
): QuickAccessList<ItemForBucket<B[number]>>;
function useList(
  ...args: (Bucket | QuickAccessListOptions)[]
): QuickAccessList {
  const factory = ++factoryCount;
  const options = typeof args[0] === 'object' ? args[0] : undefined;
  const exclusions = createContactExclusions(
    () => options?.excludedPeople?.() ?? [],
    () => undefined
  );
  const window = createContactDirectoryWindow(
    () => ({ userId: VIEWER }),
    async (viewer, _host, request, signal) => {
      signal.throwIfAborted();
      setReads((count) => count + 1);
      setLastRead(
        JSON.stringify({
          factory,
          query: request.query,
          cursor: request.cursor,
        })
      );
      setLastExclusions(request.policy?.excluded ?? []);
      const excluded = new Set(request.policy?.excluded);
      let start =
        request.cursor?.source === 'server' ? Number(request.cursor.after) : 0;
      if (request.query === 'late') start = 99_999;
      if (request.query === 'broader') start = 99_998;
      const users = [];
      while (
        start < 100_000 &&
        users.length < (request.query ? 1 : 50) &&
        (!request.query ||
          request.query === 'late' ||
          request.query === 'broader')
      ) {
        const i = start++;
        const id = `macro|person${i}@example.com`;
        if (!excluded.has(id))
          users.push({
            id,
            email: `person${i}@example.com`,
            name:
              i === 99_999
                ? 'Private late name'
                : i === 99_998
                  ? 'Source-approved match'
                  : `Person ${String(i).padStart(6, '0')}`,
          });
      }
      if (request.query === 'custom$@example.org')
        users.push({
          id: 'macro|alias@example.com',
          email: 'alias@example.com',
          name: 'custom$@example.org',
        });
      return {
        query: request.query,
        users,
        source: 'server',
        sync: 'unavailable',
        offline: false,
        nextCursor:
          !request.query && start < 100_000
            ? {
                source: 'server',
                userId: viewer,
                query: request.query,
                after: String(start),
                policyKey: hashKey([request.policy]),
              }
            : null,
      };
    },
    () => options?.enabled?.() !== false,
    {
      search: options?.searchTerm,
      policy: () => ({ mode: 'property', excluded: exclusions.native() }),
      resetKey: exclusions.key,
    }
  );
  const items = () => {
    const users = window.data()?.users ?? [];
    return users
      .filter((user) => !exclusions.ids().has(user.id))
      .map(contactUserItem);
  };
  return {
    items,
    totalCount: () => items().length,
    isLoading: window.loading,
    isLoadingMore: window.loading,
    error: window.error,
    windowKey: window.windowKey,
    hasMore: () => !!window.data()?.nextCursor,
    loadMore: async () => {
      await window.loadNext();
    },
  };
}
export const ACCESS: QuickAccessContextValue = {
  useList,
  usesRecordSelection: () => false,
  usesSearchProjection: () => true,
  isLoading: () => false,
  refresh: () => {},
  getById: () => undefined,
  interactionForUser: () => undefined,
};

export function CalendarGuestsFixture() {
  changeViewer(VIEWER);
  const [open, setOpen] = createSignal(false);
  const [selected, setSelected] = createSignal<SelectedEventEditorGuest[]>([
    {
      kind: 'custom',
      id: 'macro|OUTSIDE@example.org',
      data: {
        id: 'macro|OUTSIDE@example.org',
        email: 'OUTSIDE@example.org',
        invalid: false,
      },
    },
  ]);
  const current = eventGuestOptions([
    { email: 'PERSON0@example.com', name: 'Event-owned guest' },
  ]);
  const adding =
    new URLSearchParams(location.search).get('calendar-guests') === 'add';
  return (
    <QuickAccessContextProvider value={ACCESS}>
      <main class="max-w-md min-h-screen bg-page p-5 text-ink">
        <button onClick={() => setOpen(true)}>Open guests</button>
        <Show when={open()}>
          <div class="menu-surface mt-4 max-h-[75vh] overflow-auto">
            <Show
              when={adding}
              fallback={
                <EventGuestPicker
                  options={() => current}
                  selected={selected()}
                  onChange={setSelected}
                  onClose={() => setOpen(false)}
                />
              }
            >
              <AddOnlyGuestsEditor
                options={() => current}
                current={current}
                added={selected()}
                onAddedChange={setSelected}
                onClose={() => setOpen(false)}
              />
            </Show>
          </div>
          <button onClick={() => setOpen(false)}>Close guests</button>
        </Show>
        <output data-testid="reads">{reads()}</output>
        <output data-testid="last-read">{lastRead()}</output>
        <output data-testid="excluded">
          {JSON.stringify(lastExclusions())}
        </output>
        <pre data-testid="selected">{JSON.stringify(selected())}</pre>
      </main>
    </QuickAccessContextProvider>
  );
}
