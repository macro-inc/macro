import { describe, expect, it } from 'vitest';
import {
  isCrmListConfig,
  matchesInteractionWindow,
  needsCompanyFollowUp,
} from './crm-navigation';

const now = Date.parse('2026-09-16T12:00:00Z');
const daysAgo = (days: number) => new Date(now - days * 86400000).toISOString();
describe('CRM interaction views', () => {
  it('follow-up requires a non-churned stage as well as inactivity', () => {
    for (const stage of [undefined, '', 'Churned', ' churned ']) {
      expect(needsCompanyFollowUp(daysAgo(30), stage, now)).toBe(false);
    }
    for (const stage of ['Lead', 'Demo', 'Customer', 'Custom evaluation']) {
      expect(needsCompanyFollowUp(daysAgo(14), stage, now)).toBe(true);
      expect(needsCompanyFollowUp(daysAgo(13), stage, now)).toBe(false);
      expect(needsCompanyFollowUp(null, stage, now)).toBe(true);
    }
  });
  it('includes the follow-up boundary and excludes recent interactions', () => {
    expect(matchesInteractionWindow(daysAgo(14), 'needs-follow-up', now)).toBe(
      true
    );
    expect(matchesInteractionWindow(daysAgo(13), 'needs-follow-up', now)).toBe(
      false
    );
    expect(matchesInteractionWindow(null, 'needs-follow-up', now)).toBe(true);
  });
  it('recent activity excludes missing, invalid, future and older timestamps', () => {
    for (const value of [null, 'invalid', daysAgo(-1), daysAgo(8)]) {
      expect(matchesInteractionWindow(value, 'recently-active', now)).toBe(
        false
      );
    }
    expect(matchesInteractionWindow(daysAgo(7), 'recently-active', now)).toBe(
      true
    );
  });
});
describe('CRM collection storage', () => {
  it('accepts empty collections without mistaking saved filters for lists', () => {
    expect(
      isCrmListConfig({ kind: 'crm-list', teamId: 'team', companyIds: [] })
    ).toBe(true);
    expect(isCrmListConfig({ kind: 'crm', filters: {} })).toBe(false);
  });
  it('rejects malformed membership and missing team scope', () => {
    expect(
      isCrmListConfig({
        kind: 'crm-list',
        teamId: 'team',
        companyIds: ['id', 2],
      })
    ).toBe(false);
    expect(isCrmListConfig({ kind: 'crm-list', companyIds: ['id'] })).toBe(
      false
    );
  });
});
