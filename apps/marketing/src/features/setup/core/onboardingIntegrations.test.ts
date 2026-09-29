import { describe, expect, it } from 'vitest';
import {
  readOnboardingIntegrations,
  writeOnboardingIntegrations,
} from './onboardingIntegrations';

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('onboarding integration persistence', () => {
  it('preserves OAuth step order and scopes selections to the account', () => {
    const store = storage();
    const selected = [
      { id: 'github', name: 'GitHub' },
      {
        id: 'notion',
        name: 'Notion',
        iconUrl: 'https://example.com/notion.svg',
      },
    ];
    writeOnboardingIntegrations(store, 'first@example.com', selected);
    expect(readOnboardingIntegrations(store, 'first@example.com')).toEqual(
      selected
    );
    expect(readOnboardingIntegrations(store, 'second@example.com')).toEqual([]);
  });
  it('rejects corrupt items and duplicates without losing valid steps', () => {
    const store = {
      getItem: () =>
        JSON.stringify([
          null,
          1,
          { id: '../notion', name: 'Notion' },
          { id: 'linear', name: '' },
          { id: 'notion', name: 'Notion' },
          { id: 'notion', name: 'Duplicate' },
          {
            id: 'github',
            name: 'GitHub',
            url: 'https://untrusted.example/mcp',
          },
        ]),
    };
    expect(readOnboardingIntegrations(store, 'user')).toEqual([
      { id: 'notion', name: 'Notion' },
      { id: 'github', name: 'GitHub' },
    ]);
  });
  it('tolerates unavailable or corrupt storage', () => {
    expect(
      readOnboardingIntegrations({ getItem: () => '{invalid' }, 'user')
    ).toEqual([]);
    expect(
      readOnboardingIntegrations(
        {
          getItem: () => {
            throw new Error('blocked');
          },
        },
        'user'
      )
    ).toEqual([]);
    expect(() =>
      writeOnboardingIntegrations(
        {
          setItem: () => {
            throw new Error('quota');
          },
        },
        'user',
        []
      )
    ).not.toThrow();
  });
  it('drops removed onboarding connectors when resuming an older selection', () => {
    const store = {
      getItem: () =>
        JSON.stringify([
          { id: 'gmail', name: 'Gmail' },
          { id: 'google_sheets', name: 'Google Sheets' },
          { id: 'google_calendar', name: 'Google Calendar' },
          { id: 'microsoft_outlook', name: 'Microsoft Outlook' },
          { id: 'google_drive', name: 'Google Drive' },
          { id: 'linear', name: 'Linear' },
        ]),
    };
    expect(readOnboardingIntegrations(store, 'user')).toEqual([
      { id: 'google_drive', name: 'Google Drive' },
      { id: 'linear', name: 'Linear' },
    ]);
  });
});
