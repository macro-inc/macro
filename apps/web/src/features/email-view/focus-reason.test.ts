import type { EmailFocus } from '@entity';
import { describe, expect, it } from 'vitest';
import { emailFocusReason } from './focus-reason';

const label = (focus: Partial<EmailFocus>) =>
  emailFocusReason({
    category: 'OTHER',
    needsReply: false,
    needsFollowUp: false,
    ...focus,
  })?.label;

describe('emailFocusReason', () => {
  it('puts what the owner owes ahead of the category', () => {
    expect(label({ category: 'CALENDAR', needsReply: true })).toBe(
      'Reply needed'
    );
    expect(label({ category: 'CUSTOMER', needsFollowUp: true })).toBe(
      'Follow up'
    );
  });

  it('shows one reason for an older row with both flags set', () => {
    expect(label({ needsReply: true, needsFollowUp: true })).toBe(
      'Reply needed'
    );
  });

  it('names the category when nothing is owed', () => {
    expect(label({ category: 'CALENDAR' })).toBe('Calendar change');
    expect(label({ category: 'CUSTOMER' })).toBe('Customer');
    expect(label({ category: 'TEAM' })).toBe('Teammate');
    expect(label({ category: 'KNOWN' })).toBe('Contact');
  });

  it('shows no reason for a category that explains nothing', () => {
    expect(label({ category: 'OTHER' })).toBeUndefined();
    expect(label({ category: 'OUTREACH' })).toBeUndefined();
    expect(label({ category: 'AUTOMATED' })).toBeUndefined();
    expect(label({ category: 'LOW_RELEVANCE' })).toBeUndefined();
  });

  it('shows no reason for a category this build does not know', () => {
    const fromNewerServer = JSON.parse('{"category":"NEWLY_ADDED"}');
    expect(label({ category: fromNewerServer.category })).toBeUndefined();
  });

  it('keeps a flag working when the category is unknown', () => {
    const fromNewerServer = JSON.parse('{"category":"NEWLY_ADDED"}');
    expect(label({ category: fromNewerServer.category, needsReply: true })).toBe(
      'Reply needed'
    );
  });
});
