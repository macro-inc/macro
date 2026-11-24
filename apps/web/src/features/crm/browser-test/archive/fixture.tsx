import '../../../../index.css';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { SidePanel } from '@components/app/side-panel';
import { ChannelDirectoryProvider } from '@core/context/channels';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { staticChannelDirectory } from '@queries/channel/directory';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { storageServiceClient as Storage } from '@service-storage/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, Show, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { match } from 'ts-pattern';
// The fixture aliases `@core/context/user` to its picker stub; the company
// picker's entity display reads the real context.
import { UserContextProvider } from '../../../../lib/core/context/user';
import { RecordOverview } from '../../components/record-overview';
import { RecordTabs } from '../../components/record-tabs';
import {
  COMPANY_SECTIONS,
  CONTACT_SECTIONS,
  type CrmRecordSection,
  RECORD_PANEL_ORDER,
} from '../../core/record';
import { useCompanyQuery } from '../../queries/companies';
import { useContactQuery } from '../../queries/contacts';
import { CompanyContactsSection } from '../../views/company-contacts-section';
import { CompanyHeader } from '../../views/company-header';
import { CompanySharingSection } from '../../views/company-sharing-section';
import { ContactHeader } from '../../views/contact-header';
import { RecordReferencesSection } from '../../views/record-associations';
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
applyTheme(params.get('theme') === 'light' ? 'Macro Light' : 'Macro Dark');
const kind = params.get('kind') === 'company' ? 'company' : 'contact';
const selectorType: EntityType | EntityType[] | null | undefined = match(
  params.get('selector')
)
  .with('TASK', () => 'TASK' as const)
  .with('CONTACT', () => 'CONTACT' as const)
  .with('MIXED', () => ['TASK' as const, 'CONTACT' as const])
  .with('THREAD', () => 'THREAD' as const)
  .with('GENERIC', () => null)
  .otherwise(() => undefined);
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
  if (selectorType !== undefined) {
    return (
      <main class="flex h-dvh min-w-0 flex-col bg-panel text-ink">
        <PropertyEntitySelector
          config={{
            specificEntityType: selectorType,
            isMultiSelect: true,
            placeholder: 'Search options',
            fillHeight: isTouchDevice(),
          }}
          selectedOptions={() => new Set<string>()}
          setSelectedOptions={() => {}}
        />
      </main>
    );
  }
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
                <CompanyContactsSection company={source.company()} />
              </Show>
              <RecordDetailsSection
                company={kind === 'company' ? source.company() : undefined}
                contact={kind === 'contact' ? contact.data : undefined}
              />
              <SidePanel.Section
                id="properties"
                title="Properties"
                order={RECORD_PANEL_ORDER.properties}
                defaultOpen
              >
                <SidePanel.Grid class="auto-rows-[minmax(1.75rem,auto)] gap-y-1">
                  <SidePanel.Row label="Phone">+1 555 0100</SidePanel.Row>
                </SidePanel.Grid>
              </SidePanel.Section>
              <SidePanel.Section
                id="references"
                title="References"
                order={RECORD_PANEL_ORDER.references}
              >
                <RecordReferencesSection
                  scope={
                    kind === 'company'
                      ? { type: 'company', id: record.id, domains: [] }
                      : { type: 'contact', id: record.id, emails: [] }
                  }
                />
              </SidePanel.Section>
              <Show when={kind === 'company'}>
                <SidePanel.Section
                  id="sharing"
                  title="Email sharing"
                  order={RECORD_PANEL_ORDER.sharing}
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
      {/* The company picker shows channel and user names. */}
      <ChannelDirectoryProvider directory={staticChannelDirectory(() => [])}>
        <UserContextProvider>
          <Fixture />
        </UserContextProvider>
      </ChannelDirectoryProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);
