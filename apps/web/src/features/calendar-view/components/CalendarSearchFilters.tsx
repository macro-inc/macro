import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import { useContacts, useContactsQuery } from '@queries/contacts/contacts';
import { Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { CalendarPeopleFilterSubmenu } from './CalendarPeopleFilterSubmenu';

export interface CalendarSearchFilterValues {
  searchOn: 'name_content' | 'name' | 'content';
  matchType: 'partial' | 'exact';
  statuses: Array<'confirmed' | 'tentative' | 'cancelled'>;
  organizers: string[];
  attendees: string[];
}

export const DEFAULT_CALENDAR_SEARCH_FILTERS: CalendarSearchFilterValues = {
  searchOn: 'name_content',
  matchType: 'partial',
  statuses: [],
  organizers: [],
  attendees: [],
};

const SEARCH_FIELDS: Array<{
  value: CalendarSearchFilterValues['searchOn'];
  label: string;
}> = [
  { value: 'name_content', label: 'Title and description' },
  { value: 'name', label: 'Title only' },
  { value: 'content', label: 'Description only' },
];

const STATUSES: Array<{
  value: CalendarSearchFilterValues['statuses'][number];
  label: string;
}> = [
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'tentative', label: 'Tentative' },
  { value: 'cancelled', label: 'Cancelled' },
];

function SubmenuLabel(props: { label: string; active: boolean }) {
  return (
    <>
      <span class="flex-1 text-ink">{props.label}</span>
      <Show when={props.active}>
        <span aria-hidden="true" class="size-1.5 rounded-full bg-accent" />
      </Show>
      <CaretRightIcon class="size-3 shrink-0 text-ink-muted" />
    </>
  );
}

export function CalendarSearchFilters(props: {
  value: CalendarSearchFilterValues;
  onChange: (value: CalendarSearchFilterValues) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const contacts = useContacts(open);
  const contactsQuery = useContactsQuery(open);
  const updateFilters = (change: Partial<CalendarSearchFilterValues>) =>
    props.onChange({ ...props.value, ...change });
  const hasFilters = () =>
    props.value.searchOn !== DEFAULT_CALENDAR_SEARCH_FILTERS.searchOn ||
    props.value.statuses.length > 0 ||
    props.value.organizers.length > 0 ||
    props.value.attendees.length > 0;

  return (
    <Dropdown placement="bottom-end" onOpenChange={setOpen}>
      <Dropdown.Trigger
        type="button"
        variant="plain"
        size="icon-sm"
        square
        label={hasFilters() ? 'Filter events (active)' : 'Filter events'}
        class="rounded-full"
        classList={{ 'text-accent': hasFilters() }}
      >
        <FilterIcon class="size-4" />
        <Show when={hasFilters()}>
          <span
            aria-hidden="true"
            class="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent"
          />
        </Show>
      </Dropdown.Trigger>
      <Dropdown.Content
        portalScope="local"
        data-calendar-search-filters=""
        class="w-44 max-w-[90vw]"
      >
        <Dropdown.Group>
          <Dropdown.Sub>
            <Dropdown.SubTrigger>
              <SubmenuLabel
                label="Search in"
                active={props.value.searchOn !== DEFAULT_CALENDAR_SEARCH_FILTERS.searchOn}
              />
            </Dropdown.SubTrigger>
            <Dropdown.SubContent
              portalScope="local"
              data-calendar-search-filters=""
              class="min-w-44"
            >
              <Dropdown.Group>
                <Dropdown.RadioGroup
                  value={props.value.searchOn}
                  onChange={(value) =>
                    updateFilters({
                      searchOn: value as CalendarSearchFilterValues['searchOn'],
                    })
                  }
                >
                  <For each={SEARCH_FIELDS}>
                    {(option) => (
                      <Dropdown.RadioItem closeOnSelect={false} value={option.value}>
                        <span class="flex-1">{option.label}</span>
                        <Dropdown.ItemIndicator>
                          <CheckIcon class="size-3.5 text-accent" />
                        </Dropdown.ItemIndicator>
                      </Dropdown.RadioItem>
                    )}
                  </For>
                </Dropdown.RadioGroup>
              </Dropdown.Group>
            </Dropdown.SubContent>
          </Dropdown.Sub>
          <Dropdown.Sub>
            <Dropdown.SubTrigger>
              <SubmenuLabel label="Status" active={props.value.statuses.length > 0} />
            </Dropdown.SubTrigger>
            <Dropdown.SubContent
              portalScope="local"
              data-calendar-search-filters=""
              class="min-w-40"
            >
              <Dropdown.Group>
                <For each={STATUSES}>
                  {(option) => (
                    <Dropdown.CheckboxItem
                      closeOnSelect={false}
                      checked={props.value.statuses.includes(option.value)}
                      onChange={(checked) =>
                        updateFilters({
                          statuses: checked
                            ? [...props.value.statuses, option.value]
                            : props.value.statuses.filter(
                                (status) => status !== option.value
                              ),
                        })
                      }
                    >
                      <span class="flex-1">{option.label}</span>
                    </Dropdown.CheckboxItem>
                  )}
                </For>
              </Dropdown.Group>
            </Dropdown.SubContent>
          </Dropdown.Sub>
          <CalendarPeopleFilterSubmenu
            label="Organizer"
            contacts={contacts}
            loading={() => contactsQuery.isPending}
            error={() => contactsQuery.isError}
            values={() => props.value.organizers}
            onChange={(organizers) => updateFilters({ organizers })}
          />
          <CalendarPeopleFilterSubmenu
            label="Attendee"
            contacts={contacts}
            loading={() => contactsQuery.isPending}
            error={() => contactsQuery.isError}
            values={() => props.value.attendees}
            onChange={(attendees) => updateFilters({ attendees })}
          />
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
