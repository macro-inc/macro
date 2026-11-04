import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { parseSearchFilters } from '../../../core/search-filters';
import { useSearchFacets } from './search-facets';
import { createSearchFiltersController } from './search-filters-state';

vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarSearchUiFlag: () => () => false,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  usePosthog: () => ({ flagsLoaded: () => true }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@example.com',
}));
vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: (...buckets: string[]) => ({
      items: () =>
        buckets.includes('person')
          ? [
              { id: 'macro|outside@example.com', data: { name: 'Outside' } },
              { id: 'macro|another@example.com', data: { name: 'Another' } },
            ]
          : [],
    }),
  }),
}));
vi.mock('@queries/contacts/contacts', () => ({
  useContacts: () => () => [
    {
      id: 'macro|outside@example.com',
      name: 'Outside',
      email: 'outside@example.com',
    },
    {
      id: 'macro|another@example.com',
      name: 'Another',
      email: 'another@example.com',
    },
  ],
}));
vi.mock('@property/queries/team-members', () => ({
  useTeamMembers: (enabled: () => boolean) => ({
    users: () =>
      enabled()
        ? [
            {
              id: 'macro|member@example.com',
              name: 'Member',
              email: 'member@example.com',
            },
          ]
        : [],
    isLoading: () => false,
    isError: () => false,
  }),
}));
vi.mock('../inbox-picker', () => ({
  useInboxPicker: () => ({ hasMultiple: () => false }),
}));
vi.mock('@property/component/propertyValue/PropertyValueIcon', () => ({
  PropertyValueIcon: () => null,
}));
vi.mock('@entity/extractors/entity-icon', () => ({ EntityIcon: () => null }));

it('scopes only global Search assignees and retains discovered selections in the compiled filter', () => {
  createRoot((dispose) => {
    const [state, setState] = createSignal(
      parseSearchFilters('{"type":"task"}')
    );
    const controller = createSearchFiltersController({
      state,
      onChange: setState,
    });
    const facets = useSearchFacets(controller, {
      hasTags: () => false,
      options: () => [],
      defByOption: () => new Map(),
    });
    const assignee = facets().find((facet) => facet.id === 'task-assignee');
    const creator = facets().find((facet) => facet.id === 'task-created-by');
    if (assignee?.kind !== 'multi' || creator?.kind !== 'multi')
      throw new Error('Missing people facets');

    expect(assignee.options().map(({ id }) => id)).toEqual([
      'macro|viewer@example.com',
      'macro|member@example.com',
    ]);
    expect(creator.options().map(({ id }) => id)).toContain(
      'macro|outside@example.com'
    );
    assignee.action?.().onSelect();
    expect(assignee.options().map(({ id }) => id)).toContain(
      'macro|another@example.com'
    );
    assignee.onChange(['macro|outside@example.com']);
    expect(state().task.assignees).toEqual(['macro|outside@example.com']);
    assignee.onPickerClose?.();
    expect(assignee.options().map(({ id }) => id)).toContain(
      'macro|outside@example.com'
    );
    expect(assignee.options().map(({ id }) => id)).not.toContain(
      'macro|another@example.com'
    );
    assignee.onChange([]);
    expect(state().task.assignees).toEqual([]);
    expect(assignee.options().map(({ id }) => id)).not.toContain(
      'macro|outside@example.com'
    );

    controller.setType('calls');
    const speaker = facets().find((facet) => facet.id === 'call-from');
    if (speaker?.kind !== 'multi') throw new Error('Missing speaker facet');
    expect(speaker.options().map(({ id }) => id)).toContain(
      'macro|outside@example.com'
    );
    expect(speaker.action).toBeUndefined();
    dispose();
  });
});
