import '../../../../index.css';
import { SidePanel } from '@components/app/side-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { storageServiceClient as Storage } from '@service-storage/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, Show, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { RecordOverview } from '../../components/record-overview';
import { RecordTabs } from '../../components/record-tabs';
import {
  COMPANY_SECTIONS,
  CONTACT_SECTIONS,
  type CrmRecordSection,
} from '../../core/record';
import { useCompanyQuery } from '../../queries/companies';
import { useContactQuery } from '../../queries/contacts';
import { CompanyContactsSection } from '../../views/company-contacts-section';
import { CompanyHeader } from '../../views/company-header';
import { CompanySharingSection } from '../../views/company-sharing-section';
import { ContactHeader } from '../../views/contact-header';
import { RecordDetailsSection } from '../../views/record-details-section';
import { RecordHeaderActions } from '../../views/record-header-actions';
import {
  client,
  message,
  selectedContact,
  storageServiceClient,
} from './preview-adapters';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const params = new URLSearchParams(location.search);
const kind = params.get('kind') === 'company' ? 'company' : 'contact';
const record = { type: kind, id: `${kind}-1`, name: '' } as const;
function Fixture() {
  const [section, setSection] = createSignal<CrmRecordSection>(
    params.has('team') ? 'team' : 'overview'
  );
  const deps = {
    client,
    storage: storageServiceClient as unknown as typeof Storage,
  };
  const source = useCompanyQuery(deps, () => 'company-1');
  const contact = useContactQuery(deps, selectedContact);
  return (
    <main class="flex h-dvh min-w-0 flex-col bg-panel text-ink">
      <SidePanel.Root floating defaultOpen={false}>
        <header class="flex min-h-12 min-w-0 shrink-0 items-center gap-2 px-3 mobile:flex-wrap">
          <span class="min-w-0 truncate text-sm">
            {kind === 'company' ? 'Companies' : 'People'}
          </span>
          <RecordTabs
            sections={kind === 'company' ? COMPANY_SECTIONS : CONTACT_SECTIONS}
            value={section()}
            onChange={setSection}
          />
          <RecordHeaderActions record={record} />
        </header>
        <div class="min-h-0 flex-1">
          <SidePanel.Layout floating headerToggle={false}>
            <Suspense fallback={<p>Loading record</p>}>
              <Show
                when={section() === 'team'}
                fallback={
                  <RecordOverview>
                    <Show
                      when={kind === 'company'}
                      fallback={<ContactHeader contact={contact.data} />}
                    >
                      <CompanyHeader company={source.company()} />
                    </Show>
                  </RecordOverview>
                }
              >
                <CompanyContactsSection
                  company={source.company()}
                  contacts={source.contacts()}
                />
              </Show>
              <RecordDetailsSection
                company={kind === 'company' ? source.company() : undefined}
                contact={kind === 'contact' ? contact.data : undefined}
              />
              <SidePanel.Section id="references" title="References" order={20}>
                <p>No references</p>
              </SidePanel.Section>
              <Show when={kind === 'company'}>
                <SidePanel.Section
                  id="sharing"
                  title="Email sharing"
                  order={50}
                >
                  <CompanySharingSection company={source.company()} />
                </SidePanel.Section>
              </Show>
            </Suspense>
          </SidePanel.Layout>
        </div>
      </SidePanel.Root>
      <output class="sr-only" aria-live="polite">
        {message()}
      </output>
    </main>
  );
}
render(
  () => (
    <QueryClientProvider client={client}>
      <Fixture />
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);
