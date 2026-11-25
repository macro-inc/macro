import { describe, expect, it } from 'vitest';
import { labelNamesOf, shownLabelsOf } from './label-names';

const made = (id: string, linkId: string, name: string) => ({
  id,
  linkId,
  name,
});

const carried = (
  id: string,
  name: string,
  overrides: { type?: string; messageListVisibility?: string } = {}
) => ({
  id,
  linkId: 'gmail',
  name,
  type: 'user',
  messageListVisibility: 'show',
  ...overrides,
});

const PROVIDERS: Record<string, 'GMAIL' | 'OUTLOOK'> = {
  gmail: 'GMAIL',
  outlook: 'OUTLOOK',
};

describe('labelNamesOf', () => {
  it('names a nested Gmail label by its own name and its whole path', () => {
    const names = labelNamesOf(
      [
        made('customers', 'gmail', 'Customers'),
        made('larkspur', 'gmail', 'Customers/Larkspur'),
      ],
      (linkId) => PROVIDERS[linkId]
    );
    expect(names.get('larkspur')).toEqual({
      name: 'Larkspur',
      fullName: 'Customers / Larkspur',
    });
    expect(names.get('customers')).toEqual({
      name: 'Customers',
      fullName: 'Customers',
    });
  });

  it('keeps the slash of an Outlook category and of a Gmail label with no parent', () => {
    const names = labelNamesOf(
      [
        made('q3', 'outlook', 'Plans/Q3'),
        made('orphan', 'gmail', 'Archive/2024'),
      ],
      (linkId) => PROVIDERS[linkId]
    );
    expect(names.get('q3')).toEqual({ name: 'Plans/Q3', fullName: 'Plans/Q3' });
    expect(names.get('orphan')).toEqual({
      name: 'Archive/2024',
      fullName: 'Archive/2024',
    });
  });

  it('nests each inbox only under its own labels', () => {
    const names = labelNamesOf(
      [
        made('parent', 'gmail', 'Customers'),
        made('other-child', 'gmail-2', 'Customers/Larkspur'),
      ],
      () => 'GMAIL'
    );
    expect(names.get('other-child')?.name).toBe('Customers/Larkspur');
  });
});

describe('shownLabelsOf', () => {
  it('shows only labels people made that Gmail does not hide from the list', () => {
    const shown = shownLabelsOf(
      [
        carried('inbox', 'INBOX', { type: 'System' }),
        carried('hidden', 'Receipts', { messageListVisibility: 'Hide' }),
        carried('orders', 'Orders'),
      ],
      new Map()
    );
    expect(shown.map((label) => label.id)).toEqual(['orders']);
  });

  it('uses the inbox names once known, and the stored name until then', () => {
    const labels = [carried('larkspur', 'Customers/Larkspur')];
    expect(shownLabelsOf(labels, new Map())[0]).toMatchObject({
      name: 'Customers/Larkspur',
      fullName: 'Customers/Larkspur',
    });
    expect(
      shownLabelsOf(
        labels,
        new Map([
          ['larkspur', { name: 'Larkspur', fullName: 'Customers / Larkspur' }],
        ])
      )[0]
    ).toMatchObject({ name: 'Larkspur', fullName: 'Customers / Larkspur' });
  });
});
