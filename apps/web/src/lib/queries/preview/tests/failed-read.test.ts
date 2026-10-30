import { expect, it } from 'vitest';
import { failedReadAccess } from '../failed-read';

const failure = (code: string, refusal?: { code: string }) => ({
  name: 'ResultError',
  code,
  message: code,
  refusal,
});

it('reads an item the service reports missing as deleted', () => {
  expect(failedReadAccess([failure('NOT_FOUND')])).toBe('does_not_exist');
  expect(failedReadAccess([failure('GONE')])).toBe('does_not_exist');
  expect(failedReadAccess([failure('FORBIDDEN', { code: 'notFound' })])).toBe(
    'does_not_exist'
  );
});

it('reads any other failure as hidden from the viewer', () => {
  expect(failedReadAccess([failure('FORBIDDEN')])).toBe('no_access');
  expect(failedReadAccess([failure('UNAUTHORIZED')])).toBe('no_access');
  expect(failedReadAccess([failure('NETWORK_ERROR')])).toBe('no_access');
});
