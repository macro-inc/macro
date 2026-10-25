import { SETTINGS_TAB_GROUPS } from '@core/constant/settingsTabsConfig';
import { describe, expect, it } from 'vitest';
import { searchSettings } from './settings-search';

const search = (query: string) => searchSettings(SETTINGS_TAB_GROUPS, query);
describe('individual settings search', () => {
  it('finds agent tools on the unified Integrations page', () => {
    expect(
      search('agent apps').find(
        (result) => result.title === 'Agent apps and tools'
      )
    ).toMatchObject({ tab: 'Connected' });
  });
  it('keeps calendar connections searchable without removed booking settings', () => {
    expect(
      search('calendar color').find(
        (result) => result.title === 'Connected calendars'
      )
    ).toMatchObject({
      tab: 'Calendar',
      target: 'connected-calendars',
    });
    expect(search('working hours')).toEqual([]);
    expect(search('reschedule')).toEqual([]);
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
  it('finds the team members page for inviting people', () => {
    for (const query of ['invite', 'members', 'team members', 'teammates']) {
      expect(search(query)[0]).toMatchObject({
        tab: 'Team Members',
        group: 'Team',
      });
    }
    expect(search('pending invites')[0]).toMatchObject({
      tab: 'Team Members',
      target: 'pending-invites',
    });
  });
  it('finds team connections apart from personal integrations', () => {
    expect(search('slack import')[0].tab).toBe('Team Connections');
    expect(search('team github')[0].tab).toBe('Team Connections');
  });
  it('has no results for empty or unrelated queries', () => {
    expect(search('  ')).toEqual([]);
    expect(search('xyz123')).toEqual([]);
  });
});
