import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/lib/i18n', () => ({
  t: (key: string, values?: Record<string, string>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

import {
  searchStarterLabel,
  searchStarterValue,
  startSearchOperator,
} from './search-starters';

describe('startSearchOperator', () => {
  it('writes the operator at the end, for its suggestions to open', () => {
    expect(startSearchOperator('', 'from')).toBe('from:');
    expect(startSearchOperator('launch', 'tag')).toBe('launch tag:');
    expect(startSearchOperator('launch', 'date')).toBe('launch newer_than:');
  });

  it('takes the set operator out to edit it', () => {
    expect(startSearchOperator('type:task launch', 'type')).toBe(
      'launch type:'
    );
    expect(startSearchOperator('tag:a OR tag:b launch', 'tag')).toBe(
      'launch tag:'
    );
    expect(startSearchOperator('after:2026/06/01 launch', 'date')).toBe(
      'launch newer_than:'
    );
  });

  it('toggles Unread', () => {
    expect(startSearchOperator('launch', 'unread')).toBe('launch is:unread');
    expect(startSearchOperator('is:unread launch', 'unread')).toBe('launch');
  });
});

describe('searchStarterLabel', () => {
  const label = (
    text: string,
    starter: Parameters<typeof startSearchOperator>[1]
  ) => searchStarterLabel(starter, searchStarterValue(text, starter));

  it('names the starter until the text sets a value', () => {
    expect(label('launch', 'from')).toBe('searchOperators.starterFrom');
    expect(label('launch from:', 'from')).toBe('searchOperators.starterFrom');
  });

  it('shows the value the text sets', () => {
    expect(label('from:me', 'from')).toBe('searchOperators.you');
    expect(label('from:ana@example.com', 'from')).toBe('ana@example.com');
    expect(label('type:task', 'type')).toBe('searchOperators.typeTask');
    expect(label('tag:"Q3 launch"', 'tag')).toBe('Q3 launch');
    expect(label('newer_than:7d', 'date')).toBe('searchOperators.lastWeek');
    expect(label('after:2026/06/01', 'date')).toBe(
      'searchOperators.after {"date":"2026/06/01"}'
    );
  });
});
