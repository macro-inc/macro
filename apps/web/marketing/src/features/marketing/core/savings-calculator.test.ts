import { describe, expect, it } from 'vitest';
import {
  formatUsd,
  initialChoices,
  macroAnnualCost,
  parseSeats,
  type SavingsToolId,
  summarizeSavings,
  type ToolChoice,
} from './savings-calculator';

const choices = (
  overrides: Partial<Record<SavingsToolId, Partial<ToolChoice>>> = {}
): Record<SavingsToolId, ToolChoice> => {
  const result = initialChoices();
  for (const [id, override] of Object.entries(overrides)) {
    result[id as SavingsToolId] = {
      ...result[id as SavingsToolId],
      ...override,
    };
  }
  return result;
};

const unselected = (...ids: SavingsToolId[]) =>
  Object.fromEntries(ids.map((id) => [id, { selected: false }]));

describe('savings calculator', () => {
  it('multiplies every selected entry plan by seats and months', () => {
    const monthly = 1000 + 1000 + 791 + 1099 + 700 + 700 + 2500 + 725 + 2500;
    expect(summarizeSavings(choices(), 5)).toEqual({
      toolsCents: monthly * 12 * 5,
      macroCents: 4000 * 12 * 5,
    });
  });

  it('uses the chosen plan and skips tools that are not selected', () => {
    const summary = summarizeSavings(
      choices({
        ...unselected(
          'jira',
          'asana',
          'clickup',
          'hubspot',
          'salesforce',
          'slack'
        ),
        notion: { planId: 'business' },
      }),
      1
    );
    expect(summary.toolsCents).toBe((2000 + 1000 + 2500) * 12);
  });

  it('charges Macro $40 a seat for the first 5 seats, then $80', () => {
    expect(macroAnnualCost(1)).toBe(4000 * 12);
    expect(macroAnnualCost(5)).toBe(4000 * 12 * 5);
    expect(macroAnnualCost(8)).toBe((4000 * 5 + 8000 * 3) * 12);
  });

  it('keeps seats a whole number between 1 and the maximum', () => {
    expect(parseSeats('12')).toBe(12);
    expect(parseSeats('0')).toBe(1);
    expect(parseSeats('-4')).toBe(1);
    expect(parseSeats('999999')).toBe(10_000);
    expect(parseSeats('')).toBeNull();
  });

  it('formats whole dollars without cents', () => {
    expect(formatUsd(14700)).toBe('$147');
    expect(formatUsd(5225)).toBe('$52.25');
    expect(formatUsd(4689000)).toBe('$46,890');
  });
});
