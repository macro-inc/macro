import { expect, test } from 'vitest';
import { excludePrivateFixtures, privateFixtureNames } from '../privacy';

test('repository scanner excludes contact payloads and retains safe examples', () => {
  const phone = '+' + [1202, 555, 1234].join('');
  const files = new Map([
    ['safe.json', JSON.stringify({ args: ['test@example.com'] })],
    ['contact.json', JSON.stringify({ args: [phone] })],
  ]);
  expect(privateFixtureNames(files)).toEqual(['contact.json']);
});

test('private test names remain indexed only by opaque identity', () => {
  const phone = '+' + [1202, 555, 1234].join('');
  const files = new Map([['case.json', '{}']]);
  const index = [
    {
      id: `package/test.ts::${phone}`,
      file: 'case.json',
      tier: 'A-rec',
      reasons: [],
    },
  ];
  excludePrivateFixtures(files, index);
  expect(files.size).toBe(0);
  expect(index[0]).toMatchObject({
    file: null,
    tier: 'B-only',
    reasons: ['repository-privacy-filter'],
  });
  expect(index[0].id).toMatch(
    /^package\/test.ts::<privacy-filtered:[a-f0-9]{16}>$/
  );
  expect(
    privateFixtureNames(new Map([['index.json', JSON.stringify(index)]]))
  ).toEqual([]);
});
