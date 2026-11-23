import { t } from '@app/lib/i18n';
import { SidePanel } from '@components/app/side-panel';
import { For, Show } from 'solid-js';
import type { CrmCompany } from '../core/company';
import type { CrmContact } from '../core/contact';
import { RECORD_PANEL_ORDER } from '../core/record';
import { ContactCompanyField, ContactEmailField } from './contact-properties';

/** Factual details, laid out like the Properties rows below them. */
export function RecordDetailsSection(props: {
  company?: CrmCompany;
  contact?: CrmContact;
  onOpenCompany?: (id: string) => boolean;
}) {
  return (
    <SidePanel.Section
      id="crm-record-details"
      title="Record details"
      order={RECORD_PANEL_ORDER.details}
      defaultOpen
    >
      <SidePanel.Grid class="auto-rows-[minmax(1.75rem,auto)] gap-y-1">
        <SidePanel.Row label="Name">
          <span class="min-w-0 wrap-break-word">
            {props.company?.name ?? props.contact?.name ?? '—'}
          </span>
        </SidePanel.Row>
        <Show when={props.company}>
          {(company) => (
            <SidePanel.Row label="Website">
              <div class="flex min-w-0 flex-col">
                <For each={company().domains}>
                  {(domain) => (
                    <span class="wrap-break-word">{domain.domain}</span>
                  )}
                </For>
              </div>
            </SidePanel.Row>
          )}
        </Show>
        <Show when={props.contact}>
          {(contact) => (
            <>
              <SidePanel.Row label={t('crm.email')}>
                <ContactEmailField contact={contact()} />
              </SidePanel.Row>
              <SidePanel.Row label={t('crm.company')}>
                <ContactCompanyField
                  contact={contact()}
                  onOpenCompany={props.onOpenCompany}
                />
              </SidePanel.Row>
            </>
          )}
        </Show>
      </SidePanel.Grid>
    </SidePanel.Section>
  );
}
