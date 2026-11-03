import '@app/index.css';
import { CallSourceBadge } from '@block-call/component/CallSourceBadge';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { CallProviderBadge } from '../../entity/components/Badges';
import { type CrmContext, CrmProvider } from '../context/crm-context';
import type { CrmContact, CrmContactPhone } from '../core/contact';
import { ContactHeader } from '../views/contact-header';

const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const contact: CrmContact = {
  id: id(1),
  companyId: id(2),
  name: 'Jane Doe',
  email: 'jane@acme.example',
  hidden: false,
  firstInteraction: '2026-10-01T00:00:00Z',
  lastInteraction: '2026-11-01T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};
const [phones, setPhones] = createSignal<CrmContactPhone[]>([
  { phone: '+1555010', source: 'call' },
]);

function query<T>(data: () => T) {
  return {
    get data() {
      return data();
    },
    isPending: false,
    isSuccess: true,
    isLoading: false,
    isError: false,
    refetch: async () => undefined,
  };
}

function mutation<Input, Output>(run: (input: Input) => Promise<Output>) {
  return { isPending: false, mutate: () => undefined, mutateAsync: run };
}

// The server normalizes numbers and refuses one without its country code.
const savePhones = mutation(
  async ({ phones: next }: { contactId: string; phones: string[] }) => {
    if (next.some((phone) => !phone.trim().startsWith('+'))) {
      throw new Error('not a phone number with its country code');
    }
    const saved = next.map((phone) => ({
      phone: phone.replace(/[^+\d]/g, ''),
      source: 'manual' as const,
    }));
    setPhones(saved);
    return saved;
  }
);

// Only what the contact header reads; the rest of the CRM is not mounted.
const crm = {
  contactInitials: (name: string | null | undefined, email: string) =>
    (name ?? email).slice(0, 2).toUpperCase(),
  createNavigation: () => ({ openWithSplit: () => undefined }),
  createCompanySource: () => ({
    query: query(() => undefined),
    company: () => ({ id: contact.companyId, name: 'Acme' }),
    contacts: () => [],
  }),
  createContactPhones: () => query(phones),
  setContactPhones: () => savePhones,
  renameContact: () => mutation(async () => undefined),
} as unknown as CrmContext;

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <CrmProvider value={crm}>
        <main class="p-6 flex flex-col gap-6">
          <ContactHeader contact={contact} />
          <section aria-label="Call sources" class="flex items-center gap-2">
            <CallSourceBadge
              source={{
                provider: 'dialpad',
                externalUrl: 'https://dialpad.example/shared/call/1',
              }}
            />
            <CallSourceBadge source={{ provider: 'granola' }} />
            <CallSourceBadge source={{ provider: 'macro' }} />
            <CallProviderBadge provider="dialpad" />
          </section>
        </main>
      </CrmProvider>
    ),
    root
  );
