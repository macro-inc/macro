import {
  CalendarSearchFilters,
  type CalendarSearchFilterValues,
  DEFAULT_CALENDAR_SEARCH_FILTERS,
} from '@app/features/calendar-view/components/CalendarSearchFilters';
import type { ContactDirectoryPage } from '@queries/contacts/directory';
import { createContactFilterSource } from '@queries/contacts/filter-source';
import { createSignal } from 'solid-js';

export function CalendarFilterFixture() {
  const [value, setValue] = createSignal<CalendarSearchFilterValues>({
    ...DEFAULT_CALENDAR_SEARCH_FILTERS,
    organizers: ['selected@example.com', 'external@example.com'],
  });
  return (
    <main class="portal-scope p-6 min-h-screen bg-page text-ink">
      <CalendarSearchFilters
        value={value()}
        onChange={setValue}
        createPeopleSource={(selected, enabled) => {
          const source = createContactFilterSource(
            () => ({ userId: 'account-a' }),
            selected,
            enabled,
            async (
              viewer,
              _host,
              request,
              signal
            ): Promise<ContactDirectoryPage> => {
              signal.throwIfAborted();
              const second = request.cursor?.source === 'people';
              let users: ContactDirectoryPage['users'] = [];
              if (!request.query)
                users = Array.from({ length: 50 }, (_, index) => ({
                  id: `macro|person${index + (second ? 50 : 0)}@example.com`,
                  email: `person${index + (second ? 50 : 0)}@example.com`,
                  name: `Person ${index + (second ? 50 : 0)}`,
                }));
              else if (request.query.toLowerCase() === 'rare')
                users = [
                  {
                    id: 'macro|rare@example.com',
                    email: 'rare@example.com',
                    name: 'Rare Person',
                  },
                ];
              else if (request.query.toLowerCase() === 'slt')
                users = [
                  {
                    id: 'macro|selected@example.com',
                    email: 'selected@example.com',
                    name: 'Selected Person',
                  },
                ];
              return {
                users,
                query: request.query,
                source: 'cache',
                sync: 'partial',
                offline: false,
                nextCursor:
                  request.query || second
                    ? null
                    : {
                        source: 'people',
                        generation: 'fixture',
                        policyKey: '',
                        userId: viewer,
                        query: '',
                        after: 'next',
                      },
              };
            }
          );
          return source;
        }}
      />
      <pre data-testid="selected-emails">
        {JSON.stringify(value().organizers)}
      </pre>
    </main>
  );
}
