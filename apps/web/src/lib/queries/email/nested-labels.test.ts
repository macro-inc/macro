import { describe, expect, test } from 'vitest';
import { formatLabelPath, nestLabels } from './nested-labels';

const named = (...names: string[]) => names.map((name) => ({ name }));
const paths = (...args: Parameters<typeof nestLabels>) =>
  nestLabels(...args).map(({ path }) => formatLabelPath(path));

describe('nestLabels', () => {
  test('puts Gmail children right after their parent', () => {
    expect(
      paths(
        named(
          'Finance/Receipts',
          'Customers/Larkspur',
          'Finance',
          'Customers-old',
          'Customers',
          'Finance/Invoices'
        ),
        'GMAIL'
      )
    ).toEqual([
      'Customers',
      'Customers / Larkspur',
      'Customers-old',
      'Finance',
      'Finance / Invoices',
      'Finance / Receipts',
    ]);
  });

  test('nests only under a Gmail label that exists', () => {
    expect(
      nestLabels(named('A/B/C', 'A', 'X/Y'), 'GMAIL').map(({ leaf, path }) => ({
        leaf,
        path,
      }))
    ).toEqual([
      { leaf: 'A', path: ['A'] },
      { leaf: 'B/C', path: ['A', 'B/C'] },
      { leaf: 'X/Y', path: ['X/Y'] },
    ]);
  });

  test.each(['OUTLOOK', 'IMAP'] as const)(
    'keeps a %s label with a slash whole',
    (provider) => {
      expect(paths(named('Board', 'Board/Minutes'), provider)).toEqual([
        'Board',
        'Board/Minutes',
      ]);
    }
  );
});
