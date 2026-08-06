import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ remindersEnabled: true }));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_NEW_INBOX: () => false,
  ENABLE_REMINDERS: () => mocks.remindersEnabled,
  ENABLE_SNIPPETS: () => true,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE: false,
}));

afterEach(() => {
  mocks.remindersEnabled = true;
});

import { compileToAst, queryStateFrom } from '../filters/filter-store/compile';
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

  it('defaults to the upcoming tab', () => {
    expect(VIEW_TAB_PRESETS.reminders.default).toBe('upcoming');
  });

  it('asks for reminders that have not fired on the upcoming tab', () => {
    expect(astFor('upcoming').remf).toEqual({
      '&': [{ l: { comp: false } }, { l: 'inc' }],
    });
  });

  it('asks for every reminder on the all tab', () => {
    expect(astFor('all').remf).toEqual({ l: 'inc' });
  });

  // defineQueryFilters NIL-excludes every target a query does not name, which
  // is the only thing keeping other entity types out of this view.
  it.each(['upcoming', 'all'])(
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
