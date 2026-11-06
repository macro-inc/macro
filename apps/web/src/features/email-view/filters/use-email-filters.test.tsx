import { normalizeFacetSelection } from '@app/features/soup/filters/facets/selection';
import { createRoot } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailListFilters } from '../email-view-context';
import type { EmailTab, EmailViewState } from '../types';
import { emailTabFilterState } from './email-saved-view';
import { useEmailFilters } from './use-email-filters';

const mocks = vi.hoisted(() => ({
  view: undefined as unknown,
}));

vi.mock('../email-view-context', () => ({ useEmailView: () => mocks.view }));
vi.mock('@property/tags/use-tag-filter-group', () => ({
  useTagFilterGroup: () => () => ({ id: 'tags', label: 'Tags', options: [] }),
}));
vi.mock('../queries/use-email-participant-suggestions', () => ({
  useEmailParticipantSuggestions: () => () => [
    { type: 'address', email: 'ada@example.com', name: 'Ada' },
  ],
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

/** A list on `tab` with the view's filter writes, and two linked inboxes. */
function mountFilters(tab: EmailTab) {
  const [state, setState] = createStore<EmailViewState>({
    tab,
    search: '',
    inboxIds: undefined,
    focusSort: 'importance',
    collapsedSidebarSectionIds: [],
    ...emailTabFilterState(tab),
  });
  mocks.view = {
    state,
    filterBaseline: () => emailTabFilterState(state.tab),
    inboxOptions: () => [
      { id: 'inbox-a', label: 'a@example.com' },
      { id: 'inbox-b', label: 'b@example.com' },
    ],
    setFilters: (filters: Partial<EmailListFilters>) => {
      if (filters.facets)
        setState('facets', reconcile(normalizeFacetSelection(filters.facets)));
      if (filters.conditions)
        setState('conditions', reconcile(filters.conditions));
      if ('inboxIds' in filters) setState('inboxIds', filters.inboxIds);
    },
  };
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return { filters: useEmailFilters(), state };
  });
}

const groupIds = (filters: ReturnType<typeof useEmailFilters>) =>
  filters.groups().map((group) => group.id);

describe('useEmailFilters', () => {
  it('shows a tab’s own restrictions as selected without counting them', () => {
    const { filters } = mountFilters('important');

    expect(groupIds(filters)).toEqual([
      'people',
      'importance',
      'read',
      'done',
      'received',
      'inboxes',
      'has',
      'attachments',
    ]);
    expect(filters.isSelected('importance', 'signal')).toBe(true);
    expect(filters.isSelected('done', 'not-done')).toBe(true);
    expect(filters.activeCount()).toBe(0);
  });

  it('counts a changed restriction and clears back to the tab’s own', () => {
    const { filters, state } = mountFilters('important');

    filters.setSelected('done', 'all', true);
    filters.setSelected('received', '7', true);

    expect(state.facets).toEqual({});
    expect(state.conditions?.receivedWithinDays).toBe(7);
    expect(filters.isGroupActive('done')).toBe(true);
    expect(filters.activeCount()).toBe(2);

    filters.clear();

    expect(state.facets).toEqual({ done: ['not-done'] });
    expect(state.conditions?.receivedWithinDays).toBeUndefined();
    expect(filters.activeCount()).toBe(0);
  });

  it('adds typed people and offers Match from once someone is chosen', () => {
    const { filters, state } = mountFilters('all');
    const people = filters.groups().find((group) => group.id === 'people');
    const typed = people?.createOption?.('@Vendor.example');

    expect(people?.createOption?.('not a domain')).toBeUndefined();
    expect(typed?.id).toBe('domain:vendor.example');
    expect(groupIds(filters)).not.toContain('matchFrom');

    filters.setGroupSelection('people', ['person:ada@example.com', typed!.id]);

    expect(state.conditions?.participants).toEqual([
      { type: 'address', email: 'ada@example.com' },
      { type: 'domain', domain: 'vendor.example' },
    ]);
    expect(groupIds(filters)).toContain('matchFrom');

    filters.setGroupSelection('matchFrom', []);
    expect(state.conditions?.participantFields).toEqual(['from', 'to', 'cc']);
  });

  it('keeps Starred and calendar invites in one Has list', () => {
    const { filters, state } = mountFilters('favorites');
    const has = filters.groups().find((group) => group.id === 'has');

    expect(has?.options.map((option) => option.id)).toEqual([
      'starred',
      'has-calendar-invite',
    ]);
    expect(filters.isSelected('has', 'starred')).toBe(true);
    expect(filters.isGroupActive('has')).toBe(false);

    filters.setSelected('has', 'has-calendar-invite', true);
    filters.setSelected('has', 'starred', false);
    filters.setSelected('attachments', 'attachment-pdf', true);

    expect(state.facets).toEqual({
      attachments: ['attachment-pdf'],
      calendar: ['has-calendar-invite'],
    });
    expect(state.conditions?.starred).toBe(false);
    expect(filters.selectedIds('has')).toEqual(['has-calendar-invite']);
    expect(filters.activeCount()).toBe(2);
  });

  it('picks several inboxes and keeps the facets alone where no view applies', () => {
    const { filters, state } = mountFilters('sent');

    expect(groupIds(filters)).toEqual([
      'read',
      'done',
      'has',
      'attachments',
      'inboxes',
    ]);

    filters.setSelected('inboxes', 'inbox-a', true);
    filters.setSelected('inboxes', 'inbox-b', true);

    expect(state.inboxIds).toEqual(['inbox-a', 'inbox-b']);
    expect(filters.activeCount()).toBe(1);
  });
});
