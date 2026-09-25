import { describe, expect, it } from 'vitest';
import {
  onboardingIntegrationAvailable,
  onboardingIntegrationEntries,
} from './onboardingIntegrationCatalog';

describe('onboarding catalog curation', () => {
  it('excludes requested apps and their auth variants without excluding Drive', () => {
    for (const slug of [
      'google_sheets',
      'google_calendar',
      'google_calendar_custom_oauth',
      'google-calendar',
      'google-sheets',
      'google_sheets_custom_oauth',
      'gmail',
      'gmail_custom_oauth',
      'microsoft_outlook',
      'microsoft_outlook_calendar',
    ]) {
      expect(onboardingIntegrationAvailable(slug), slug).toBe(false);
    }
    for (const slug of ['google_drive', 'google_docs', 'microsoft_excel']) {
      expect(onboardingIntegrationAvailable(slug), slug).toBe(true);
    }
  });

  it('folds the directory Slack variant into native Slack and respects hidden natives', () => {
    const native = { id: 'slack', name: 'Slack' };
    const catalog = [{ id: 'slack_v2', name: 'Slack' }];
    expect(
      onboardingIntegrationEntries([native], catalog, new Set(), '')
    ).toEqual([native]);
    expect(
      onboardingIntegrationEntries([], catalog, new Set(['slack']), '')
    ).toEqual([]);
  });

  it('keeps native integrations first across pages and search, preserving catalog order', () => {
    const featured = [
      { id: 'posthog', name: 'PostHog' },
      { id: 'github', name: 'GitHub' },
      { id: 'linear', name: 'Linear' },
    ];
    const catalog = [
      { id: 'google_drive', name: 'Google Drive' },
      { id: 'github', name: 'GitHub' },
      { id: 'figma', name: 'Figma' },
      { id: 'google_drive', name: 'Google Drive' },
      { id: 'gmail', name: 'Gmail' },
    ];
    expect(
      onboardingIntegrationEntries(featured, catalog, new Set(), '').map(
        (entry) => entry.id
      )
    ).toEqual(['github', 'linear', 'posthog', 'google_drive', 'figma']);
    expect(
      onboardingIntegrationEntries(
        featured,
        catalog,
        new Set(['github']),
        'GitHub'
      )
    ).toEqual([]);
    expect(
      onboardingIntegrationEntries(featured, catalog, new Set(), '  DRIVE  ')
    ).toEqual([{ id: 'google_drive', name: 'Google Drive' }]);
    expect(
      onboardingIntegrationEntries(featured, catalog, new Set(), 'no results')
    ).toEqual([]);
  });
});
