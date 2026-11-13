import type { FilterContext } from '@app/features/next-soup/filters/configs/base';
import type { PredicateConfig } from '@app/features/next-soup/filters/filter-store/predicates-store';
import type { EntityData } from '@entity';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { createPredicatesStore } from '../../next-soup/filters/filter-store/predicates-store';
import { createQueryStore } from '../../next-soup/filters/filter-store/query-store';
import {
  crmCompanyActiveFilter,
  crmCompanyHiddenFilter,
  crmContactActiveFilter,
  crmContactHiddenFilter,
} from '../collection-filters';
import {
  bindPeopleVisibility,
  createPeopleVisibility,
} from './people-visibility';

afterEach(cleanup);

function mount() {
  let result!: ReturnType<typeof setup>;
  render(() => {
    result = setup();
    return null;
  });
  return result;
}

function setup() {
  const [userId, setUserId] = createSignal<string | undefined>('user-1');
  const [teamId, setTeamId] = createSignal<string | undefined>('team-1');
  const [isAdmin, setAdmin] = createSignal(true);
  const [activeTab, setActiveTab] = createSignal('people');
  const queryFilters = createQueryStore({
    initial: {
      include: {
        crmContactHidden: true,
        crmContactTeamId: ['other-team'],
        crmContactSearch: 'example',
      },
      exclude: { crmContactHidden: false },
    },
  });
  const predicates = createPredicatesStore<
    EntityData,
    FilterContext,
    PredicateConfig<EntityData, string, FilterContext>
  >({
    configs: [
      crmContactActiveFilter,
      crmContactHiddenFilter,
      crmCompanyActiveFilter,
      crmCompanyHiddenFilter,
    ],
    initial: { or: ['crm-contact-hidden'] },
  });
  const visibility = createPeopleVisibility({
    userId,
    teamId,
    isAdmin,
    activeTab,
  });
  bindPeopleVisibility(visibility, {
    activeTab,
    queryFilters,
    soup: { predicates },
  });
  return {
    visibility,
    queryFilters,
    predicates,
    setUserId,
    setTeamId,
    setAdmin,
    setActiveTab,
  };
}

it('requires an explicit choice, compiles a real hidden/team/search request, and preserves search on return', () => {
  const { visibility, queryFilters, predicates } = mount();
  expect(visibility.showRemoved()).toBe(false);
  expect(queryFilters.state.include.crmContactHidden).toBe(false);
  expect(queryFilters.state.exclude.crmContactHidden).toBeUndefined();
  expect(predicates.andIds()).toEqual(['crm-contact-active']);
  visibility.setShowRemoved(true);
  const request = makeGraphqlSoupInput({
    params: { limit: 25 },
    body: queryFilters.compile(),
  });
  expect(request.initial?.filters?.crmContactFilter).toEqual({
    and: {
      left: { literal: { hidden: true } },
      right: {
        and: {
          left: { literal: { teamId: 'team-1' } },
          right: { literal: { search: 'example' } },
        },
      },
    },
  });
  expect(predicates.andIds()).toEqual(['crm-contact-hidden']);
  visibility.setShowRemoved(false);
  expect(queryFilters.state.include.crmContactHidden).toBe(false);
  expect(queryFilters.state.include.crmContactTeamId).toBeUndefined();
  expect(queryFilters.state.include.crmContactSearch).toBe('example');
});

it('cannot enable hidden reads by injecting filters or predicates for a member', () => {
  const { visibility, queryFilters, predicates, setAdmin } = mount();
  setAdmin(false);
  visibility.setShowRemoved(true);
  queryFilters.set({
    include: { crmContactHidden: true, crmContactTeamId: ['other-team'] },
    exclude: { crmContactHidden: false },
  });
  predicates.set({ or: ['crm-contact-hidden'] });
  expect(visibility.canShowRemoved()).toBe(false);
  expect(visibility.showRemoved()).toBe(false);
  expect(queryFilters.state.include.crmContactHidden).toBe(false);
  expect(queryFilters.state.include.crmContactTeamId).toBeUndefined();
  expect(predicates.andIds()).toEqual(['crm-contact-active']);
  expect(predicates.orIds()).toEqual([]);
});

it('resets on role, account, team and tab transitions without resurrecting an old selection', () => {
  const { visibility, setAdmin, setUserId, setTeamId, setActiveTab } = mount();
  const transitions = [
    [() => setAdmin(false), () => setAdmin(true)],
    [() => setUserId('user-2'), () => setUserId('user-1')],
    [() => setTeamId('team-2'), () => setTeamId('team-1')],
    [() => setTeamId(undefined), () => setTeamId('team-1')],
    [() => setActiveTab('active'), () => setActiveTab('people')],
  ];
  for (const [leave, back] of transitions) {
    visibility.setShowRemoved(true);
    expect(visibility.showRemoved()).toBe(true);
    leave();
    expect(visibility.showRemoved()).toBe(false);
    back();
    expect(visibility.showRemoved()).toBe(false);
  }
});

it('rejects retained hidden rows from another scope and preserves unfiled and effectively hidden rows', () => {
  const { visibility, predicates, setAdmin, setTeamId } = mount();
  const contact: EntityData = {
    type: 'crm_contact',
    id: 'removed',
    name: 'Removed',
    ownerId: 'team-1',
    teamId: 'team-1',
    companyId: null,
    hidden: true,
  };
  const matches = (entity: EntityData) =>
    predicates.test(entity, {
      crmRemovedPeopleTeamId: visibility.removedTeamId(),
    });
  expect(matches(contact)).toBe(false);
  visibility.setShowRemoved(true);
  expect(matches(contact)).toBe(true);
  expect(matches({ ...contact, companyId: 'hidden-company' })).toBe(true);
  expect(matches({ ...contact, teamId: 'team-2' })).toBe(false);
  expect(matches({ ...contact, hidden: false })).toBe(false);
  setTeamId('team-2');
  expect(matches(contact)).toBe(false);
  visibility.setShowRemoved(true);
  expect(matches(contact)).toBe(false);
  setAdmin(false);
  expect(matches({ ...contact, teamId: 'team-2' })).toBe(false);
  expect(crmContactHiddenFilter.predicate(contact, {})).toBe(false);
});

it('does not opt contacts into a company request after leaving removed People', () => {
  const { visibility, queryFilters, setActiveTab } = mount();
  visibility.setShowRemoved(true);
  queryFilters.set({ include: { crmContactSearch: undefined } });
  setActiveTab('active');
  expect(queryFilters.compile().crmf).toBeUndefined();
});

it('keeps an explicitly selected removed view scoped when a shared filter replaces its team', () => {
  const { visibility, queryFilters } = mount();
  visibility.setShowRemoved(true);
  queryFilters.replace({
    include: { crmContactHidden: true, crmContactTeamId: ['other-team'] },
  });
  expect(queryFilters.state.include.crmContactTeamId).toEqual(['team-1']);
  expect(visibility.showRemoved()).toBe(true);
});

it('selects archived-only companies without changing search or unrelated filters', () => {
  const { visibility, queryFilters, predicates, setActiveTab, setAdmin } =
    mount();
  setActiveTab('active');
  queryFilters.set({ include: { crmCompanyId: ['company-1'] } });
  visibility.setShowRemoved(true);
  expect(queryFilters.state.include.crmCompanyHidden).toBe(true);
  expect(queryFilters.state.include.crmCompanyId).toEqual(['company-1']);
  expect(predicates.andIds()).toEqual(['crm-company-hidden']);
  visibility.setShowRemoved(false);
  expect(queryFilters.state.include.crmCompanyHidden).toBe(false);
  expect(predicates.andIds()).toEqual(['crm-company-active']);
  visibility.setShowRemoved(true);
  setAdmin(false);
  setAdmin(true);
  expect(visibility.showRemoved()).toBe(false);
});
