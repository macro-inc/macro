import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { useEmailDomainSuggestions } from './use-email-domain-suggestions';

const contact = (email: string) => ({
  kind: 'user' as const,
  id: email,
  data: { id: email, email, name: email },
});

vi.mock('@core/signal/useCombinedRecipient', () => ({
  useCombinedRecipients: () => ({
    users: () =>
      [
        'a@example.org',
        'b@example.org',
        'c@example.net',
        'd@Globex.example',
        'not-an-address',
      ].map(contact),
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
vi.mock('@app/lib/i18n', () => ({
  t: (_key: string, values: { count: number }) => `${values.count} contacts`,
}));

describe('useEmailDomainSuggestions', () => {
  it('names CRM companies first, then contact domains by how many use them', () => {
    const options = createRoot((dispose) => {
      const value = useEmailDomainSuggestions()();
      dispose();
      return value;
    });

    expect(options).toEqual([
      { value: 'globex.example', label: 'Globex', detail: 'globex.example' },
      { value: 'example.org', label: 'example.org', detail: '2 contacts' },
      { value: 'example.net', label: 'example.net', detail: '1 contacts' },
    ]);
  });
});
