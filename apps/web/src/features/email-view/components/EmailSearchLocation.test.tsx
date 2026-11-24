import type { EmailEntity } from '@entity';
import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { EmailSearchLocation } from './EmailSearchLocation';

const thread = (fields: Partial<EmailEntity>): EmailEntity => ({
  type: 'email',
  id: '019a1f40-2c7e-7d10-9a4b-6f2b0c1d2e3f',
  name: 'Quarterly invoice',
  ownerId: 'macro|owner@example.com',
  isRead: true,
  isDraft: false,
  isImportant: false,
  done: true,
  ...fields,
});

describe('EmailSearchLocation', () => {
  it('labels a search result that was archived out of the inbox', () => {
    render(() => (
      <EmailSearchLocation
        entity={thread({ hasReceivedMail: true })}
        reachesArchived
      />
    ));

    expect(screen.getByText('Archived')).toBeTruthy();
  });

  it('leaves a thread of only sent mail unlabelled: it was never in the inbox', () => {
    render(() => (
      <EmailSearchLocation
        entity={thread({ hasReceivedMail: false })}
        reachesArchived
      />
    ));

    expect(screen.queryByText('Archived')).toBeNull();
  });

  it('labels nothing when the search cannot reach archived mail', () => {
    render(() => (
      <EmailSearchLocation
        entity={thread({ hasReceivedMail: true })}
        reachesArchived={false}
      />
    ));

    expect(screen.queryByText('Archived')).toBeNull();
  });
});
