import type { SettingsTabItem } from '@core/constant/settingsTabsConfig';
import { describe, expect, it } from 'vitest';
import { buildSettingsSearchIndex, searchSettings } from './settingsSearch.ts';

// A stand-in icon: the index only carries icons through, it never renders them.
const Icon = () => null;

const TABS: SettingsTabItem[] = [
  { tab: 'Account', label: 'Account', icon: Icon },
  { tab: 'Notifications', label: 'Notifications', icon: Icon },
  { tab: 'Billing', label: 'Billing', icon: Icon },
  { tab: 'Appearance', label: 'Appearance', icon: Icon },
  { tab: 'Shortcuts', label: 'Shortcuts', icon: Icon },
  { tab: 'Team', label: 'Team', icon: Icon },
  { tab: 'Tags', label: 'Tags', icon: Icon },
  { tab: 'Connected', label: 'Connections', icon: Icon },
  { tab: 'Agent', label: 'MCP server', icon: Icon },
  { tab: 'Bots', label: 'Bots', icon: Icon },
];

const index = buildSettingsSearchIndex(TABS);

const search = (query: string) => searchSettings(query, index);
const titles = (query: string) => search(query).map((r) => r.entry.title);
const tabs = (query: string) =>
  Array.from(new Set(search(query).map((r) => r.entry.tab)));

describe('buildSettingsSearchIndex', function () {
  it('creates a page entry per tab followed by its inner items', function () {
    const entries = buildSettingsSearchIndex([TABS[7]!]);
    expect(entries[0]).toMatchObject({
      tab: 'Connected',
      title: 'Connections',
      isPage: true,
    });
    expect(
      entries.slice(1).every((e) => !e.isPage && e.tab === 'Connected')
    ).toBe(true);
    expect(entries.map((e) => e.title)).toContain('Gmail');
  });

  it('only indexes the tabs it is given, so gating carries over to search', function () {
    const entries = buildSettingsSearchIndex(
      TABS.filter((t) => t.tab !== 'Connected')
    );
    expect(entries.some((e) => e.tab === 'Connected')).toBe(false);
    expect(searchSettings('gmail', entries)).toEqual([]);
  });
});

describe('searchSettings', function () {
  it('returns nothing for an empty or punctuation-only query', function () {
    expect(search('')).toEqual([]);
    expect(search('   ')).toEqual([]);
    expect(search('-- !!')).toEqual([]);
  });

  it('finds top-level pages by their sidebar label, best match first', function () {
    expect(titles('team')[0]).toBe('Team');
    expect(titles('Billing')[0]).toBe('Billing');
    expect(titles('short')[0]).toBe('Shortcuts');
  });

  it('finds inner content that is not a sidebar item', function () {
    expect(titles('gmail')).toContain('Gmail');
    expect(titles('linear')).toContain('Linear');
    expect(titles('delete account')).toContain('Delete account');
    expect(titles('slug')).toContain('Team slug');
  });

  it('matches intuitive synonyms rather than only UI labels', function () {
    expect(tabs('google')).toContain('Connected');
    expect(tabs('integrations')).toContain('Connected');
    expect(tabs('dark mode')).toContain('Appearance');
    expect(tabs('payment')).toContain('Billing');
    expect(tabs('hotkeys')).toContain('Shortcuts');
    expect(tabs('avatar')).toContain('Account');
    expect(tabs('invite')).toContain('Team');
    expect(tabs('webhook')).toContain('Bots');
  });

  it('surfaces both MCP pages for "mcp"', function () {
    const found = tabs('mcp');
    expect(found).toContain('Agent');
    expect(found).toContain('Connected');
  });

  it('is case-insensitive and ignores surrounding whitespace', function () {
    expect(titles('  GMAIL ')).toEqual(titles('gmail'));
  });

  it('requires every word of a multi-word query to match', function () {
    expect(titles('github app')).toContain('GitHub App');
    expect(titles('github app')).not.toContain('Gmail');
    expect(search('github zzzz')).toEqual([]);
  });

  it('matches prefixes and joined words', function () {
    expect(tabs('notif')).toContain('Notifications');
    expect(tabs('darkmode')).toContain('Appearance');
    expect(tabs('hub')).toContain('Connected');
  });

  it('forgives a single typo in longer words', function () {
    expect(tabs('conection')).toContain('Connected');
    expect(tabs('apearance')).toContain('Appearance');
    expect(tabs('biling')).toContain('Billing');
  });

  it('does not fuzz short words into unrelated matches', function () {
    // "tea" is a prefix of Team; "tem" is neither a prefix nor long enough
    // to be forgiven as a typo.
    expect(tabs('tea')).toContain('Team');
    expect(tabs('tem')).not.toContain('Team');
  });

  it('ranks page entries above inner entries on equal scores', function () {
    const results = search('team');
    expect(results[0]!.entry.isPage).toBe(true);
    expect(results[0]!.entry.tab).toBe('Team');
    // Inner "Team tags" / "Team slug" are exact title-word hits too, but the
    // page comes first.
    expect(titles('team')).toContain('Team tags');
  });

  it('keeps sidebar order as the final tie-break', function () {
    // Both are exact keyword hits on the page ("integrations" appears in the
    // Connections and Bots page keywords), so the earlier tab wins.
    const pages = search('integrations')
      .filter((r) => r.entry.isPage)
      .map((r) => r.entry.tab);
    expect(pages.indexOf('Connected')).toBeLessThan(pages.indexOf('Bots'));
  });
});
