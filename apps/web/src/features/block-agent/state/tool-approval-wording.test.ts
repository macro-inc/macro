import { describe, expect, it } from 'vitest';
import { describeToolCall, possessive } from './tool-approval-wording';

const macro = { slug: 'macro', name: 'Macro' };

describe('describeToolCall', () => {
  it("says what one of Macro's tools does with the owner's data", () => {
    expect(describeToolCall(macro, 'GetThread', 'your')).toBe(
      'read your email'
    );
    expect(describeToolCall(macro, 'CreateCalendarEvent', "Alice's")).toBe(
      "add an event to Alice's calendar"
    );
  });

  it('falls back to the tool name in words', () => {
    expect(describeToolCall(macro, 'QueryDatabase', 'your')).toBe(
      'use your Macro workspace (query database)'
    );
    expect(
      describeToolCall(
        { slug: 'linear', name: 'Linear' },
        'linear-create-issue',
        'your'
      )
    ).toBe('use your Linear account (linear create issue)');
  });
});

describe('possessive', () => {
  it('adds an apostrophe s, or just an apostrophe after an s', () => {
    expect(possessive('Alice Seed')).toBe("Alice Seed's");
    expect(possessive('James')).toBe("James'");
  });
});
