import { expect, it } from 'vitest';
import { formsKeys, myResponseKeyOf } from './keys';

it('names one form’s own-response queries, for any viewer, and no other form’s', () => {
  const prefix = myResponseKeyOf('form-1');
  const mine = formsKeys.mine('form-1', 'macro|me@example.com').queryKey;
  const other = formsKeys.mine('form-2', 'macro|me@example.com').queryKey;
  expect(mine.slice(0, prefix.length)).toEqual(prefix);
  expect(other.slice(0, prefix.length)).not.toEqual(prefix);
});
