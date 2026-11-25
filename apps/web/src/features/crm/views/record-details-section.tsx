import { t } from '@app/lib/i18n';
import { SidePanel } from '@components/app/side-panel';
import { Show } from 'solid-js';
import type { CrmCompany } from '../core/company';
import type { CrmContact } from '../core/contact';
import { RECORD_PANEL_ORDER } from '../core/record';
import { CompanyDomainField } from './company-domain-field';
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
            <>
              {/* Several domains run over several lines; the label sits on
                  the first, as on the Email row. */}
              <span class="self-start truncate pt-1.5 text-ink-muted touch:pt-3">
                Website
              </span>
              <div class="min-w-0 self-start py-0.5">
                <Show when={company().id} keyed>
                  {(_id) => (
                    <CompanyDomainField company={company()} surface="details" />
                  )}
                </Show>
              </div>
            </>
          )}
        </Show>
        <Show when={props.contact}>
          {(contact) => (
            <>
              {/* Several addresses run over several lines, so the label sits
                  on the first, as the side panel's multi-line values do,
                  rather than centred like a SidePanel.Row's. */}
              <span class="self-start truncate pt-1.5 text-ink-muted touch:pt-3">
                {t('crm.email')}
              </span>
              <div class="min-w-0 self-start py-0.5">
                <ContactEmailField contact={contact()} surface="details" />
              </div>
              <SidePanel.Row label={t('crm.company')}>
                <ContactCompanyField
                  contact={contact()}
                  surface="details"
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
