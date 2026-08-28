import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  remindersEnabled: true,
  calendarUiEnabled: true,
  calendarSearchEnabled: true,
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_CALENDAR_UI: () => mocks.calendarUiEnabled,
  ENABLE_CALENDAR_SEARCH_UI: () => mocks.calendarSearchEnabled,
  ENABLE_REMINDERS: () => mocks.remindersEnabled,
  ENABLE_SNIPPETS: () => true,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE: false,
}));

afterEach(() => {
  mocks.remindersEnabled = true;
  mocks.calendarUiEnabled = true;
  mocks.calendarSearchEnabled = true;
});

import { SYSTEM_PROPERTY_IDS } from '@property/constants';
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
      getViewPreset('inbox', 'all')?.filters.include?.calendarEventId
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
  it('opts the signal tab into reminders', () => {
    const filters = getViewPreset('inbox', 'signal')?.filters;
    const ast = compileToAst(queryStateFrom(filters!));

    // Reminders are off server-side unless a query names them; this is the ask.
    expect(ast.remf).toEqual({ l: 'inc' });
  });

  it('leaves the signal tab alone when the reminders flag is off', () => {
    mocks.remindersEnabled = false;

    const filters = getViewPreset('inbox', 'signal')?.filters;
    const ast = compileToAst(queryStateFrom(filters!));

    // No `remf` at all, so an unflagged user never hits the reminders service.
    expect(ast.remf).toBeUndefined();
  });

  it('opts the signal tab into alarmed calendar events', () => {
    const filters = getViewPreset('inbox', 'signal')?.filters;
    const ast = compileToAst(queryStateFrom(filters!));

    // Referencing `calf` lifts the nil-id exclusion; only events with a
    // not-done notification come back.
    expect(ast.calf).toEqual({ l: { nd: false } });
  });

  it('keeps calendar events nil-scoped when the calendar flag is off', () => {
    mocks.calendarUiEnabled = false;

    const filters = getViewPreset('inbox', 'signal')?.filters;
    const ast = compileToAst(queryStateFrom(filters!));

    expect(ast.calf).toEqual({
      l: { id: '00000000-0000-0000-0000-000000000000' },
    });
  });

  it('leaves every other inbox tab without reminders', () => {
    for (const tab of ['noise', 'all']) {
      const filters = getViewPreset('inbox', tab)?.filters;
      const ast = compileToAst(queryStateFrom(filters!));
      expect(ast.remf, `${tab} should not request reminders`).toBeUndefined();
    }
  });
});

describe('reminders view presets', () => {
  const astFor = (tab: string) => {
    const preset = getViewPreset('reminders', tab);
    if (!preset) throw new Error(`no reminders preset for tab "${tab}"`);
    return compileToAst(queryStateFrom(preset.filters));
  };

  it('defaults to the active tab', () => {
    expect(VIEW_TAB_PRESETS.reminders.default).toBe('active');
  });

  // Active and Scheduled split on `fired` server-side rather than in a client
  // predicate: they would otherwise share one `comp:false` query whose row
  // limit is spent on whichever end the sort direction favours.
  it('asks for fired, uncompleted reminders on the active tab', () => {
    expect(astFor('active').remf).toEqual({
      '&': [
        { l: { comp: false } },
        { '&': [{ l: { fired: true } }, { l: 'inc' }] },
      ],
    });
  });

  it('asks for not-yet-fired reminders on the scheduled tab', () => {
    expect(astFor('scheduled').remf).toEqual({
      '&': [
        { l: { comp: false } },
        { '&': [{ l: { fired: false } }, { l: 'inc' }] },
      ],
    });
  });

  it('asks for completed reminders on the done tab', () => {
    expect(astFor('done').remf).toEqual({
      '&': [{ l: { comp: true } }, { l: 'inc' }],
    });
  });

  // `comp: false` is what `soupQueryExcludesDone` matches to drop a row
  // optimistically when it is marked done; losing it regresses that silently.
  it.each(['active', 'scheduled'])(
    'keeps the not-completed filter on the %s tab',
    (tab) => {
      expect(
        JSON.stringify(getViewPreset('reminders', tab)?.filters)
      ).toContain('reminderCompleted');
    }
  );

  // Active is an inbox, so newest-fired first like every other feed. Scheduled
  // points at future dates, where newest-first would mean furthest-away first.
  it('reads only the scheduled tab soonest-first', () => {
    expect(getViewPreset('reminders', 'active')?.sortDirection).toBeUndefined();
    expect(getViewPreset('reminders', 'scheduled')?.sortDirection).toBe('asc');
    expect(getViewPreset('reminders', 'done')?.sortDirection).toBeUndefined();
  });

  // defineQueryFilters NIL-excludes every target a query does not name, which
  // is the only thing keeping other entity types out of this view.
  it.each(['active', 'scheduled', 'done'])(
    'excludes every other entity type on the %s tab',
    (tab) => {
      const ast = astFor(tab);

      expect(ast.df, 'documents').toBeDefined();
      expect(ast.ef, 'emails').toBeDefined();
      expect(ast.chanf, 'channels').toBeDefined();
      expect(ast.cf, 'chats').toBeDefined();
    }
  );
});

// The tab bar's labels and the filter presets are two separate tables keyed by
// the same ids, so a renamed tab can leave the UI showing the old one while the
// new preset is unreachable. That is exactly what happened when Reminders went
// from Upcoming/All to Active/Scheduled/Done.
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
