import type { CrmContactEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import { mergeDiscoveredContacts } from './contact-discovery';

const contact = (
  id: string,
  overrides: Partial<CrmContactEntity> = {}
): CrmContactEntity => ({
  type: 'crm_contact',
  id,
  ownerId: 'team',
  teamId: 'team',
  companyId: 'company',
  name: id,
  email: `${id}@example.com`,
  hidden: false,
  lastInteraction: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('contact discovery merging', () => {
  it('collapses cross-team records by normalized full email, keeping plus aliases and original IDs', () => {
    const cached = [
      contact('team-a-asher', {
        email: 'Asher@HackerNoon.com',
        teamId: 'a',
        lastInteraction: '2026-02-01T00:00:00Z',
      }),
    ];
    const server = [
      contact('team-b-asher', {
        email: '  asher@hackernoon.com ',
        teamId: 'b',
        lastInteraction: '2026-03-01T00:00:00Z',
      }),
      contact('alias', { email: 'asher+press@hackernoon.com' }),
    ];
    expect(mergeDiscoveredContacts(cached, server).map(({ id }) => id)).toEqual(
      ['team-b-asher', 'alias']
    );
  });

  it('picks the same representative regardless of which source or page delivered it', () => {
    const tied = '2026-03-01T00:00:00Z';
    const low = contact('0190-a', {
      email: 'pat@x.com',
      lastInteraction: tied,
    });
    const high = contact('0190-b', {
      email: 'PAT@x.com',
      lastInteraction: tied,
    });
    expect(mergeDiscoveredContacts([low], [high])).toEqual([high]);
    expect(mergeDiscoveredContacts([high], [low])).toEqual([high]);
    expect(mergeDiscoveredContacts([], [high, low])).toEqual([high]);
  });

  it('takes the server facts for a contact the cache also holds', () => {
    const stale = contact('pat', { name: 'Pat (old)' });
    const fresh = contact('pat', {
      name: 'Pat Doe',
      lastInteraction: '2026-05-01T00:00:00Z',
    });
    expect(mergeDiscoveredContacts([stale], [fresh])).toEqual([fresh]);
  });

  it('drops hidden records and orders by latest interaction', () => {
    const merged = mergeDiscoveredContacts(
      [
        contact('older', { lastInteraction: '2025-01-01T00:00:00Z' }),
        contact('hidden', {
          hidden: true,
          lastInteraction: '2027-01-01T00:00:00Z',
        }),
      ],
      [contact('newer', { lastInteraction: '2026-06-01T00:00:00Z' })]
    );
    expect(merged.map(({ id }) => id)).toEqual(['newer', 'older']);
  });
});
