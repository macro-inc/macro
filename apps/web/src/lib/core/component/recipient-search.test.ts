import type { CombinedRecipientItem } from '@core/user/combinedRecipient';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  getRecipientOptionFields,
  type RecipientOptionFields,
} from './recipient-options';
import { listRecipients, suggestRecipients } from './recipient-search';

const NOW = new Date('2026-11-18T12:00:00Z');
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const user = (name: string, email: string): CombinedRecipientItem => ({
  kind: 'user',
  id: `macro|${email}`,
  data: { id: `macro|${email}`, email, name },
});
const group = (id: string, name: string): CombinedRecipientItem =>
  ({
    kind: 'channel',
    id,
    data: {
      id,
      name,
      channel_type: 'private',
      updated_at: NOW.toISOString(),
      participants: [],
    },
  }) as unknown as CombinedRecipientItem;
const custom = (email: string): CombinedRecipientItem => ({
  kind: 'custom',
  id: email,
  data: { id: email, email, invalid: false },
});

function listed(
  options: CombinedRecipientItem[],
  personal: CombinedRecipientItem[] = [],
  senderDomain?: string
) {
  const fields = new Map<CombinedRecipientItem, RecipientOptionFields>(
    options.map((option) => [option, getRecipientOptionFields(option)])
  );
  return listRecipients(options, personal, senderDomain, fields);
}
it('ranks an empty field once per list, people on the sending domain first', () => {
  const outside = user('Ana Outside', 'ana@elsewhere.example');
  const colleague = user('Bo Colleague', 'bo@macro.com');
  const list = listed([outside, colleague], [], 'macro.com');
  const first = suggestRecipients(list, '', [], []);
  expect(first[0]).toBe(colleague);
  // Reopening the menu or clearing the field reuses that order.
  expect(list.sorted()).toBe(list.sorted());
  expect(suggestRecipients(list, '', [], [])).toEqual(first);
});

it('matches typed text against names and addresses', () => {
  const sarah = user('Sarah Chen', 'schen@example.com');
  const design = group('g2', 'design');
  const list = listed([group('g1', 'Sales'), sarah, design]);
  expect(suggestRecipients(list, 'schen@', [], [])).toEqual([sarah]);
  expect(suggestRecipients(list, 'chen', [], [])).toEqual([sarah]);
  expect(suggestRecipients(list, 'desi', [], [])).toEqual([design]);
});

it('keeps the personal window order and the representation a chip shows', () => {
  const first = user('Sam First', 'sam.first@example.com');
  const second = user('Sam Second', 'sam.second@example.com');
  const list = listed([second, first], [first, second]);
  expect(suggestRecipients(list, 'sam', [], [])).toEqual([first, second]);

  // A selected thread address keeps its chip's kind over the directory user.
  const chip: CombinedRecipientItem = {
    kind: 'contact',
    id: 'thread-sam',
    data: {
      id: 'thread-sam',
      type: 'extracted',
      email: 'SAM.FIRST@example.com',
      name: 'Sam',
    },
  } as CombinedRecipientItem;
  expect(suggestRecipients(list, 'sam', [], [chip])[0]).toBe(chip);
});

it('ranks a typed address that no option lists by its own fields', () => {
  const typed = custom('new.person@example.com');
  const list = listed([user('Nina', 'nina@example.com')]);
  expect(list.fields(typed)).toEqual(getRecipientOptionFields(typed));
  expect(
    suggestRecipients(list, 'new.person@example.com', [typed], [])
  ).toEqual([typed]);
});
