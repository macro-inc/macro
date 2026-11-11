import { expect, it } from 'vitest';
import { preserveOrderedWindow, preservePersonOrder } from './ordered-window';

it('preserves a matched window across local scoring and missing local matches without moving other source slots', () => {
  const exact = { id: 'exact', personOrder: 0 };
  const prefix = { id: 'prefix', personOrder: 1 };
  const contains = { id: 'contains', personOrder: 2 };
  const document = { id: 'document' };
  const result = preservePersonOrder(
    [contains, document, prefix],
    [prefix, document, exact, contains]
  );
  expect(result.map((item) => item.id)).toEqual([
    'exact',
    'document',
    'prefix',
    'contains',
  ]);
});
it('keeps the complete source window when a local matcher rejects reversed query words', () => {
  const personal = [{ id: 'john-smith' }, { id: 'smith-johnson' }];
  expect(
    preserveOrderedWindow([{ id: 'channel' }], personal, (item) => item.id)
  ).toEqual([{ id: 'channel' }, ...personal]);
});
