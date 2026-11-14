import { t } from '@app/lib/i18n';
import { SidePanel } from '@components/app/side-panel';
import { EntityMetadataRow } from '@components/app/side-panel/EntityMetadata';
import { For, Show } from 'solid-js';
import type { CrmCompany } from '../core/company';
import type { CrmContact } from '../core/contact';
import { ContactCompanyField, ContactEmailField } from './contact-properties';

/** Both records begin with factual details and References in the same order. */
export function RecordDetailsSection(props: {
  company?: CrmCompany;
  contact?: CrmContact;
  onOpenCompany?: (id: string) => boolean;
}) {
  return (
    <SidePanel.Section
      id="crm-record-details"
      title="Record details"
      order={10}
      defaultOpen
    >
      <div class="flex min-w-0 flex-col gap-2">
        <EntityMetadataRow label="Name">
          {props.company?.name ?? props.contact?.name ?? '—'}
        </EntityMetadataRow>
        <Show when={props.company}>
          {(company) => (
            <EntityMetadataRow label="Website">
              <For each={company().domains}>
                {(domain) => <div>{domain.domain}</div>}
              </For>
            </EntityMetadataRow>
          )}
        </Show>
        <Show when={props.contact}>
          {(contact) => (
            <>
              <EntityMetadataRow label={t('crm.email')}>
                <ContactEmailField contact={contact()} />
              </EntityMetadataRow>
              <EntityMetadataRow label={t('crm.company')}>
                <ContactCompanyField
                  contact={contact()}
                  onOpenCompany={props.onOpenCompany}
                />
              </EntityMetadataRow>
            </>
          )}
        </Show>
      </div>
    </SidePanel.Section>
  );
}
