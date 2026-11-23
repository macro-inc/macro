import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { useEmailParticipantSuggestions } from './use-email-participant-suggestions';

const contact = (email: string, name = email) => ({
  kind: 'user' as const,
  id: email,
  data: { id: email, email, name },
});

vi.mock('@queries/contacts/recipient-source', () => ({
  useContactRecipientSource: () => ({
    items: () => [
      contact('a@example.org', 'Zed'),
      contact('b@example.org', 'Amy'),
      contact('c@example.net'),
      contact('D@Globex.example', 'Dee'),
      contact('not-an-address'),
    ],
  }),
}));
vi.mock('@app/features/crm/crm-search', () => ({
  useQuickAccessCrmCompaniesQuery: () => ({
    companies: () => [
      { name: 'Globex', domains: [{ domain: 'globex.example' }] },
      { name: 'No domains', domains: [] },
    ],
  }),
}));

describe('useEmailParticipantSuggestions', () => {
  it('lists companies first, then contact domains by use, then people', () => {
    const suggestions = createRoot((dispose) => {
      const value = useEmailParticipantSuggestions()();
      dispose();
      return value;
    });

    expect(suggestions).toEqual([
      { type: 'domain', domain: 'globex.example', company: 'Globex' },
      { type: 'domain', domain: 'example.org', contacts: 2 },
      { type: 'domain', domain: 'example.net', contacts: 1 },
      { type: 'address', email: 'b@example.org', name: 'Amy' },
      { type: 'address', email: 'c@example.net', name: undefined },
      { type: 'address', email: 'd@globex.example', name: 'Dee' },
      { type: 'address', email: 'a@example.org', name: 'Zed' },
    ]);
  });
});
