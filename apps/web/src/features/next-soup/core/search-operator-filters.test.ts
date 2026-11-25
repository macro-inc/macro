import { describe, expect, it } from 'vitest';
import { PROPERTY_OPTION_IDS } from '../../property/identifiers';
import {
  type SearchOperatorLookup,
  searchFiltersOperatorText,
  searchOperatorFilters,
  searchOperatorQuery,
  withSearchOperatorQuery,
} from './search-operator-filters';
import { readSearchOperators, splitSearchTerms } from './search-operators';

const LOOKUP: SearchOperatorLookup = {
  userId: 'macro|Me@Example.com',
  tags: (name) =>
    (
      ({
        finance: [{ propertyId: 'tags-1', optionId: 'finance-1' }],
        legal: [{ propertyId: 'tags-1', optionId: 'legal-1' }],
        q3: [{ propertyId: 'tags-1', optionId: 'q3-1' }],
      }) as Record<string, { propertyId: string; optionId: string }[]>
    )[name.toLowerCase()] ?? [],
  inboxes: (address) => (address === 'ana@example.com' ? ['link-ana'] : []),
  channels: (name) =>
    name.toLowerCase() === 'launch' ? ['channel-launch'] : [],
};

const compile = (query: string) =>
  searchOperatorFilters(readSearchOperators(splitSearchTerms(query)), LOOKUP);

describe('searchOperatorFilters', () => {
  it('sets the task facets and narrows to tasks', () => {
    const filters = compile(
      'status:in_progress OR status:completed assignee:me'
    );

    expect(filters.state.type).toBe('task');
    expect(filters.indexes).toEqual(['task']);
    expect(filters.state.task.status).toEqual([
      PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
      PROPERTY_OPTION_IDS.STATUS.COMPLETED,
    ]);
    expect(filters.state.task.assignees).toEqual(['macro|me@example.com']);
    expect(filters.matchesNothing).toBe(false);
  });

  it('matches nothing when repeated operators can not all hold', () => {
    expect(compile('status:in_progress status:completed').matchesNothing).toBe(
      true
    );
    expect(compile('type:task type:email').matchesNothing).toBe(true);
  });

  it('matches nothing when a name reaches nothing', () => {
    expect(compile('tag:travel').matchesNothing).toBe(true);
    expect(compile('inbox:bo@example.com').matchesNothing).toBe(true);
    expect(compile('in:#ops').matchesNothing).toBe(true);
  });

  it('requires each tag, or any of tags joined by OR', () => {
    const each = compile('tag:finance tag:legal');
    expect(each.state.tagMode).toBe('all');
    expect(each.state.tags.map((tag) => tag.value)).toEqual([
      'finance-1',
      'legal-1',
    ]);

    const any = compile('tag:finance OR tag:legal');
    expect(any.state.tagMode).toBe('any');
    expect(any.indexes).not.toContain('channels');

    expect(compile('tag:finance OR tag:legal tag:q3').matchesNothing).toBe(
      true
    );
  });

  it('keeps every condition, whichever types are left', () => {
    const channels = compile('in:#launch');
    expect(channels.indexes).toEqual(['channels', 'calls']);
    const channelQuery = searchOperatorQuery(channels);
    expect(channelQuery.include?.channelId).toEqual(['channel-launch']);
    expect(channelQuery.include?.callChannelId).toEqual(['channel-launch']);

    const docs = compile('type:doc author:ana@example.com');
    expect(docs.state.type).toBe('document-or-file');
    expect(searchOperatorQuery(docs).include?.documentOwnerId).toEqual([
      'macro|ana@example.com',
    ]);

    const inbox = compile('inbox:ana@example.com');
    expect(inbox.state.type).toBe('email');
    expect(searchOperatorQuery(inbox).include?.emailLinkId).toEqual([
      'link-ana',
    ]);
  });
});

describe('withSearchOperatorQuery', () => {
  it('lays the operators over the view, keeping the view exclusions', () => {
    const merged = withSearchOperatorQuery(
      {
        include: { tagFilters: [], fileType: ['pdf'] },
        exclude: { subType: ['template'] },
      } as unknown as Parameters<typeof withSearchOperatorQuery>[0],
      { include: { subType: ['task'] }, exclude: { subType: ['draft'] } }
    );

    expect(merged.include.fileType).toEqual(['pdf']);
    expect(merged.include.subType).toEqual(['task']);
    expect(merged.exclude.subType).toEqual(['template', 'draft']);
  });
});

describe('searchFiltersOperatorText', () => {
  const NAMES = {
    userId: 'macro|me@example.com',
    tag: (id: string) =>
      ({ 'finance-1': 'Finance', 'offsite-1': 'Team offsite' })[id],
    channel: (id: string) => ({ 'channel-1': 'Q3 launch' })[id],
    inbox: (id: string) => ({ 'link-1': 'ana@example.com' })[id],
  };

  it('writes what picked filters ask for as operators', () => {
    const text = searchFiltersOperatorText(
      {
        ...compile('').state,
        type: 'task',
        task: {
          status: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
          priority: [],
          assignees: ['macro|me@example.com', 'macro|bo@example.com'],
          createdBy: [],
        },
        tags: [
          { propertyId: 'tags-1', type: 'select', value: 'finance-1' },
          { propertyId: 'tags-1', type: 'select', value: 'offsite-1' },
        ],
        tagMode: 'any',
      },
      NAMES
    );

    expect(text).toBe(
      'type:task status:in_progress assignee:me OR assignee:bo@example.com tag:Finance OR tag:"Team offsite"'
    );
  });

  it('reads back as the same filters', () => {
    const state = {
      ...compile('').state,
      type: 'channels' as const,
      channels: { in: ['channel-1'], from: ['macro|ana@example.com'] },
    };
    const text = searchFiltersOperatorText(state, NAMES);
    expect(text).toBe('type:channel in:#"Q3 launch" from:ana@example.com');
    const read = searchOperatorFilters(
      readSearchOperators(splitSearchTerms(text)),
      {
        ...LOOKUP,
        channels: (name) => (name === 'Q3 launch' ? ['channel-1'] : []),
      }
    );
    expect(read.state.channels).toEqual(state.channels);
  });
});
