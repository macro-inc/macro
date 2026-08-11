import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  remindersEnabled: true,
  calendarUiEnabled: true,
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_CALENDAR_UI: () => mocks.calendarUiEnabled,
  ENABLE_NEW_INBOX: () => false,
  ENABLE_REMINDERS: () => mocks.remindersEnabled,
  ENABLE_SNIPPETS: () => true,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE: false,
}));

afterEach(() => {
  mocks.remindersEnabled = true;
  mocks.calendarUiEnabled = true;
});

import { compileToAst, queryStateFrom } from '../filters/filter-store/compile';
import { VIEW_TAB_LISTS } from '../soup-view/tab-lists';
import { getViewPreset, VIEW_TAB_PRESETS } from './soup-filter-presets';

const mailTabs = Object.keys(VIEW_TAB_PRESETS.mail.tabs);

describe('mail view presets', () => {
  it('groups every mail tab by date independently of the new inbox flag', () => {
    for (const tab of mailTabs) {
      expect(getViewPreset('mail', tab)?.groupBy).toBe('date');
    }
  });
});

describe('calendar event scoping', () => {
  it('excludes calendar events from views that do not render them', () => {
    const nilId = '00000000-0000-0000-0000-000000000000';

    expect(
      getViewPreset('mail', 'important')?.filters.include?.calendarEventId
    ).toEqual([nilId]);
    expect(
      getViewPreset('inbox', 'all')?.filters.include?.calendarEventId
    ).toEqual([nilId]);
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
