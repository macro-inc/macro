import { createSignal } from 'solid-js';

// Keep the full adapter surface available when Vite scans other CRM views.
export * from '../../views/use-crm';

export const [created, setCreated] = createSignal('');
export const useCreateCompanyMutation = () => ({
  isPending: false,
  async mutateAsync(input: { name: string; domain?: string }) {
    setCreated(JSON.stringify(input));
    return { id: 'new-company' };
  },
});
export const useCreateContactMutation = () => ({
  isPending: false,
  async mutateAsync(input: { companyId: string; name: string; email: string }) {
    setCreated(JSON.stringify(input));
    return { id: 'new-contact' };
  },
});
export const useQuickAccessCrmCompaniesQuery = () => ({
  companies: () => [
    { id: 'acme', name: 'Acme', domains: [{ domain: 'acme.com' }] },
    { id: 'name-only', name: 'Community group', domains: [] },
  ],
  query: { isLoading: false },
});
export const useQuickAccessCrmContactsQuery = () => ({
  contacts: () => [],
  query: { isLoading: false },
});
