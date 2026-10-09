import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calendarUiEnabled: true,
  calendarSearchEnabled: true,
  snippetsEnabled: true,
}));

vi.mock('@core/constant/featureFlags', () => ({
  enableCalendarUi: { key: 'enable-calendar-ui' },
  enableSnippets: { key: 'enable-snippets' },
  enableSupportedSoupForeignEntities: {
    key: 'enable-supported-soup-foreign-entities',
  },
  isCalendarSearchUiEnabled: () => mocks.calendarSearchEnabled,
  isFeatureEnabled: (flag: { key?: string }) => {
    switch (flag.key) {
      case 'enable-calendar-ui':
        return mocks.calendarUiEnabled;
      case 'enable-snippets':
        return mocks.snippetsEnabled;
      case 'enable-supported-soup-foreign-entities':
        return false;
      default:
        return false;
    }
  },
}));

afterEach(() => {
  mocks.calendarUiEnabled = true;
  mocks.calendarSearchEnabled = true;
  mocks.snippetsEnabled = true;
});

import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { compileToAst, queryStateFrom } from '../filters/filter-store/compile';
import { VIEW_TAB_LISTS } from '../soup-view/tab-lists';
import { getViewPreset, VIEW_TAB_PRESETS } from './soup-filter-presets';

const mailTabs = Object.keys(VIEW_TAB_PRESETS.mail.tabs);

describe('mail view presets', () => {
  it('groups every mail tab by date', () => {
    for (const tab of mailTabs) {
      expect(getViewPreset('mail', tab)?.groupBy).toBe('date');
    }
  });

  it('keeps threads with saved drafts in every thread-listing tab', () => {
    // A saved draft becomes the thread's latest message, flipping the
    // entity's isDraft on. Filtering on 'no-drafts' would eject the whole
    // conversation from its tab, leaving it visible only under Drafts.
    for (const tab of mailTabs.filter((tab) => tab !== 'drafts')) {
      expect(
        getViewPreset('mail', tab)?.clientFilters.and,
        `mail '${tab}' tab must not exclude drafted threads`
      ).not.toContain('no-drafts');
    }
  });
});

describe('documents view GraphQL input contract', () => {
  const context = { userId: 'macro|phase-0@example.com', isTeamAdmin: false };
  const tabs = ['owned', 'shared', 'attachments', 'all'] as const;

  it.each([true, false])(
    'captures every production tab with snippets enabled=%s',
    (snippetsEnabled) => {
      mocks.snippetsEnabled = snippetsEnabled;

      const inputs = Object.fromEntries(
        tabs.map((tab) => {
          const preset = getViewPreset('documents', tab, context);
          if (!preset) throw new Error(`missing documents/${tab} preset`);

          return [
            tab,
            makeGraphqlSoupInput({
              params: {
                limit: 100,
                sort_method: preset.sortMethod ?? 'updated_at',
                ...(preset.sortDirection
                  ? { sort_direction: preset.sortDirection }
                  : {}),
              },
              body: compileToAst(queryStateFrom(preset.filters)),
            }),
          ];
        })
      );

      expect(inputs).toMatchSnapshot();
    }
  );
});

describe('task view presets', () => {
  const context = { userId: 'user-1', isTeamAdmin: false };

  it('uses one My tasks tab for tasks owned by or assigned to the user', () => {
    const preset = getViewPreset('tasks', 'my-tasks', context);

    expect(VIEW_TAB_PRESETS.tasks.default).toBe('my-tasks');
    expect(Object.keys(VIEW_TAB_PRESETS.tasks.tabs)).toEqual([
      'my-tasks',
      'all',
    ]);
    expect(preset?.clientFilters).toEqual({
      and: ['task', 'my-tasks'],
      or: ['task-not-started', 'task-in-progress', 'task-in-review'],
    });
    expect(preset?.groupBy).toBe(`property:${SYSTEM_PROPERTY_IDS.PRIORITY}`);
    expect(compileToAst(queryStateFrom(preset?.filters ?? {})).df).toEqual({
      '&': [
        { l: { dst: 'task' } },
        {
          '|': [{ l: { o: 'user-1' } }, { l: { imp: true } }],
        },
      ],
    });
  });
});

describe('calendar event scoping', () => {
  const nilId = '00000000-0000-0000-0000-000000000000';

  it('excludes calendar events from feeds that do not render them', () => {
    expect(
      getViewPreset('mail', 'important')?.filters.include?.calendarEventId
    ).toEqual([nilId]);
    expect(
      getViewPreset('home', 'all')?.filters.include?.calendarEventId
    ).toEqual([nilId]);
  });

  it('searches calendar events, which carry a title index of their own', () => {
    expect(
      getViewPreset('search', 'all')?.filters.include?.calendarEventId
    ).toBeUndefined();
  });

  it('excludes them from search when calendar search is off', () => {
    // Opening a hit needs the calendar block, which the flag gates, so
    // without it a result would render an inert row.
    mocks.calendarSearchEnabled = false;

    expect(
      getViewPreset('search', 'all')?.filters.include?.calendarEventId
    ).toEqual([nilId]);
  });
});

describe('inbox view presets', () => {
  it('opts the signal tab into alarmed calendar events', () => {
    const filters = getViewPreset('home', 'signal')?.filters;
    const ast = compileToAst(queryStateFrom(filters!));

    // Referencing `calf` lifts the nil-id exclusion; only events with a
    // not-done notification come back.
    expect(ast.calf).toEqual({
      '|': [{ l: { ns: 'unseen' } }, { l: { ns: 'seen' } }],
    });
  });

  it('keeps calendar events nil-scoped when the calendar flag is off', () => {
    mocks.calendarUiEnabled = false;

    const filters = getViewPreset('home', 'signal')?.filters;
    const ast = compileToAst(queryStateFrom(filters!));

    expect(ast.calf).toEqual({
      l: { id: '00000000-0000-0000-0000-000000000000' },
    });
  });
});

describe('tab lists and filter presets agree', () => {
  const tabbedViews = Object.keys(
    VIEW_TAB_LISTS
  ) as (keyof typeof VIEW_TAB_LISTS)[];

  it.each(tabbedViews)('every %s tab in the tab bar has a preset', (view) => {
    const presetIds = Object.keys(VIEW_TAB_PRESETS[view].tabs);
    for (const tab of VIEW_TAB_LISTS[view]) {
      expect(presetIds, `${view}/${tab.value}`).toContain(tab.value);
    }
  });

  it.each(tabbedViews)(
    'every %s preset is reachable from the tab bar',
    (view) => {
      const shownIds = VIEW_TAB_LISTS[view].map((tab) => tab.value);
      for (const tabId of Object.keys(VIEW_TAB_PRESETS[view].tabs)) {
        expect(shownIds, `${view}/${tabId}`).toContain(tabId);
      }
    }
  );

  it.each(tabbedViews)('the %s default tab is one of its tabs', (view) => {
    expect(VIEW_TAB_LISTS[view].map((tab) => tab.value)).toContain(
      VIEW_TAB_PRESETS[view].default
    );
  });
});

describe('recent view preset', () => {
  it('forces the touched-by-me server sort', () => {
    expect(getViewPreset('recent')?.sortMethod).toBe('touched_by_me');
  });
});

describe('inbox view presets', () => {
  // `getViewPreset` falls back to the first compatible tab when the requested
  // one does not resolve, so each check also pins the tab's own predicate.
  it('orders the notification tabs by latest notification', () => {
    // The sort is also a filter (rows without a notification are absent),
    // which matches what Signal and Noise already mean.
    const signal = getViewPreset('home', 'signal');
    expect(signal?.clientFilters).toEqual({ and: ['inbox'] });
    expect(signal?.sortMethod).toBe('notified_at');
    const noise = getViewPreset('home', 'noise');
    expect(noise?.clientFilters).toEqual({ and: ['noise'] });
    expect(noise?.sortMethod).toBe('notified_at');
  });

  it('never compiles channel or email filter trees', () => {
    // The touched-by-me query rejects channel/email trees with a 400, so
    // even the NIL-id opt-in trees other views send must be absent.
    const filters = getViewPreset('recent')?.filters;
    const ast = compileToAst(queryStateFrom(filters!));
    expect(ast.chanf).toBeUndefined();
    expect(ast.ef).toBeUndefined();
    expect(ast.emailView).toBeUndefined();
  });

  it('keeps documents, chats, and folders unrestricted', () => {
    const filters = getViewPreset('recent')?.filters;
    expect(filters?.include?.documentId).toBeUndefined();
    expect(filters?.include?.chatId).toBeUndefined();
    expect(filters?.include?.folderId).toBeUndefined();
  });

  it('excludes the types the touched feed can never return', () => {
    const filters = getViewPreset('recent')?.filters;
    const ast = compileToAst(queryStateFrom(filters!));
    // Calendar events, CRM companies, foreign entities, and channel threads
    // keep their match-nothing trees; the touched query ignores them.
    expect(ast.calf).toBeDefined();
    expect(ast.ccf).toBeDefined();
    expect(ast.fef).toBeDefined();
    expect(ast.cthf).toBeDefined();
  });
});
