import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { describe, expect, it } from 'vitest';
import {
  searchFiltersSchema,
  searchNeedsKeywords,
} from '../../next-soup/core/search-filters';
import { compileSearchQuery } from '../../next-soup/core/search-query';
import { resolveSearchFilters } from '../core/search';
import { extractedSearchFields } from './extracted-search';

const julia = {
  id: 'macro|julia@macro.com',
  label: 'Julia Jones',
  email: 'julia@macro.com',
  kind: 'user' as const,
};
const sales = { id: 'sales-channel', label: 'sales', kind: 'channel' as const };

describe('model-owned search fields', () => {
  it('keeps the extracted channel while retaining ordinary in/from phrases in the topic', () => {
    const fields = extractedSearchFields({
      query: 'growth in 2026',
      type: 'channels',
      from: ['Julia'],
      in: ['sales'],
    });
    expect(fields.query).toBe('growth in 2026');
    const resolved = resolveSearchFilters(
      JSON.stringify(fields.searchFilters),
      [julia],
      [sales]
    );
    expect(resolved.state.channels).toEqual({
      from: [julia.id],
      in: [sales.id],
    });
    expect(compileSearchQuery(resolved.state).include?.channelSenderId).toEqual(
      [julia.id]
    );
  });
  it('does not split a model-selected name containing commas or and into multiple people', () => {
    const person = { ...julia, label: 'Julia, Alex and Co' };
    const fields = extractedSearchFields({
      query: 'budget',
      type: 'channels',
      from: [person.label],
      in: [],
    });
    const resolved = resolveSearchFilters(
      JSON.stringify(fields.searchFilters),
      [person],
      []
    );
    expect(resolved.unresolved).toEqual([]);
    expect(resolved.state.channels.from).toEqual([person.id]);
  });
  it('keeps filter-only and all-type queries empty when there are no keywords', () => {
    expect(
      extractedSearchFields({
        query: null,
        type: 'channels',
        from: ['Julia'],
        in: [],
      }).query
    ).toBe('');
    expect(extractedSearchFields({ query: null, type: 'all' }).query).toBe('');
  });
  it('maps task status and priority while distinguishing assignees from creators', () => {
    const fields = extractedSearchFields({
      type: 'task',
      query: 'android',
      status: ['in progress'],
      priority: ['high'],
      assignees: ['Julia'],
      created_by: ['creator@example.com'],
    });
    const creator = {
      id: 'creator-user',
      label: 'Creator',
      email: 'creator@example.com',
      kind: 'user' as const,
    };
    const resolved = resolveSearchFilters(
      JSON.stringify(fields.searchFilters),
      [julia, creator],
      []
    );
    const query = compileSearchQuery(resolved.state);
    expect(fields.query).toBe('android');
    expect(resolved.unresolved).toEqual([]);
    expect(query.include?.documentOwnerId).toEqual([creator.id]);
    expect(query.include?.properties).toEqual([
      {
        propertyId: SYSTEM_PROPERTY_IDS.STATUS,
        type: 'select',
        value: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
      },
      {
        propertyId: SYSTEM_PROPERTY_IDS.PRIORITY,
        type: 'select',
        value: PROPERTY_OPTION_IDS.PRIORITY.HIGH,
      },
      {
        propertyId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
        type: 'entity',
        value: julia.id,
      },
    ]);
    expect(() =>
      extractedSearchFields({
        type: 'task',
        query: null,
        status: ['invented'],
        priority: [],
        assignees: [],
        created_by: [],
      })
    ).toThrow();
  });
  it('resolves email inboxes and preserves explicit unimportant email filtering', () => {
    const fields = extractedSearchFields({
      type: 'email',
      query: 'budget',
      importance: 'unimportant',
      inboxes: ['me@example.com'],
    });
    const resolved = resolveSearchFilters(
      JSON.stringify(fields.searchFilters),
      [],
      [],
      [{ id: 'inbox-id', email_address: 'me@example.com' }]
    );
    expect(compileSearchQuery(resolved.state).include).toMatchObject({
      emailImportance: false,
      emailLinkId: ['inbox-id'],
    });
    expect(
      resolveSearchFilters(JSON.stringify(fields.searchFilters), [], [], [])
        .unresolved
    ).toEqual(['me@example.com']);
  });
  it('maps call attendance alongside channel and speaker fields', () => {
    const fields = extractedSearchFields({
      type: 'calls',
      query: 'budget',
      status: 'missed',
      from: ['Julia'],
      in: ['sales'],
    });
    const resolved = resolveSearchFilters(
      JSON.stringify(fields.searchFilters),
      [julia],
      [sales]
    );
    expect(compileSearchQuery(resolved.state).include).toMatchObject({
      callStatus: 'MISSED',
      callSpeakerId: [julia.id],
      callChannelId: [sales.id],
    });
  });
  it('does not silently discard unknown or ambiguous identities', () => {
    const filters = JSON.stringify(
      searchFiltersSchema.parse({
        type: 'channels',
        channels: { in: [], from: ['Julia'] },
      })
    );
    for (const people of [
      [],
      [julia, { ...julia, id: 'other', label: 'Julia Smith' }],
    ]) {
      const result = resolveSearchFilters(filters, people, []);
      expect(result.unresolved).toEqual(['Julia']);
      expect(result.state.channels.from).toEqual(['Julia']);
    }
  });
  it('requires keywords for message sender and call speaker constraints', () => {
    for (const type of ['channels', 'calls'] as const) {
      const state = searchFiltersSchema.parse({
        type,
        [type]: { in: [], from: [julia.id] },
      });
      expect(searchNeedsKeywords(state, '')).toBe(true);
      expect(searchNeedsKeywords(state, 'budget')).toBe(false);
    }
  });
});
