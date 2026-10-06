import { SETTINGS_TAB_GROUPS } from '@core/constant/settingsTabsConfig';
import { describe, expect, it } from 'vitest';
import { searchSettings } from './settings-search';

const search = (query: string) => searchSettings(SETTINGS_TAB_GROUPS, query);
describe('individual settings search', () => {
  it('routes calendar connections and scheduling controls to separate pages', () => {
    expect(
      search('calendar color').find(
        (result) => result.title === 'Connected calendars'
      )
    ).toMatchObject({
      tab: 'Calendar',
      target: 'connected-calendars',
    });
    expect(search('working hours')[0]).toMatchObject({
      tab: 'Booking links',
      target: 'availability',
    });
    expect(search('reschedule')[0]).toMatchObject({
      tab: 'Booking links',
      target: 'bookings',
    });
  });
  it('finds and targets a signature without knowing its page', () => {
    expect(search('signatre')[0]).toMatchObject({
      tab: 'Email',
      title: 'Email signatures',
      target: 'signatures',
    });
  });
  it('tolerates transposed and wrong letters', () => {
    expect(search('singature')[0].title).toBe('Email signatures');
    expect(search('signoture')[0].title).toBe('Email signatures');
  });
  it('requires every word and combines page and setting terms', () => {
    expect(search('calendar color').map((item) => item.title)).toContain(
      'Connected calendars'
    );
    expect(search('email digest')[0].target).toBe('email-digest');
    expect(search('signature xyz123')).toEqual([]);
  });
  it('ranks a specific control above a broad keyword match', () => {
    expect(search('theme')[0].title).toBe('Color theme');
    expect(search('replies').some((item) => item.tab === 'Notifications')).toBe(
      true
    );
  });
  it('never returns pages excluded by feature or permission gates', () => {
    const groups = SETTINGS_TAB_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.tab !== 'Email'),
    }));
    expect(searchSettings(groups, 'signature')).toEqual([]);
  });
  it('keeps runtime credentials separate from Macro API keys', () => {
    expect(search('cursor')[0].tab).toBe('Harness');
    expect(search('cursor').some((item) => item.tab === 'API Keys')).toBe(
      false
    );
  });
  it('omits disabled signature controls', () => {
    expect(
      searchSettings(SETTINGS_TAB_GROUPS, 'signature', {
        emailSignatures: false,
      }).some((result) => result.title === 'Email signatures')
    ).toBe(false);
  });
  it('has no results for empty or unrelated queries', () => {
    expect(search('  ')).toEqual([]);
    expect(search('xyz123')).toEqual([]);
  });
});
