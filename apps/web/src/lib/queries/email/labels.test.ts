import { describe, expect, it } from 'vitest';
import { listedLabelNames, shownLabelNames } from './labels';

const label = (
  name: string,
  overrides: Partial<{
    type: string;
    labelListVisibility: string;
    messageListVisibility: string;
  }> = {}
) => ({
  name,
  type: 'User',
  labelListVisibility: 'LabelShow',
  messageListVisibility: 'Show',
  ...overrides,
});

describe('provider label names', () => {
  it('lists user labels once by name across inboxes, sorted', () => {
    expect(
      listedLabelNames([
        label('Receipts'),
        label('INBOX', { type: 'System' }),
        label('Clients/Acme'),
        label('Receipts'),
        label('Archive/2019', { labelListVisibility: 'LabelHide' }),
      ])
    ).toEqual(['Clients/Acme', 'Receipts']);
  });

  it('reads GraphQL spellings like REST ones', () => {
    const graphqlLabels = [
      label('Receipts', { type: 'user' }),
      label('CATEGORY_UPDATES', { type: 'system' }),
      label('Muted', { type: 'user', messageListVisibility: 'hide' }),
      label('Unlisted', { type: 'user', labelListVisibility: 'label_hide' }),
    ];

    expect(listedLabelNames(graphqlLabels)).toEqual(['Muted', 'Receipts']);
    expect(shownLabelNames(graphqlLabels)).toEqual(['Receipts', 'Unlisted']);
  });

  it('shows only the user labels Gmail shows on messages', () => {
    expect(
      shownLabelNames([
        label('Clients/Acme'),
        label('Muted', { messageListVisibility: 'Hide' }),
        label('STARRED', { type: 'System' }),
      ])
    ).toEqual(['Clients/Acme']);
  });
});
