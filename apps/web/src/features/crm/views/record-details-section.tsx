import { SidePanel } from '@components/app/side-panel';
import { EntityMetadataRow } from '@components/app/side-panel/EntityMetadata';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { useCrmContext } from '../context/crm-context';
import type { CrmCompany } from '../core/company';
import type { CrmContact } from '../core/contact';
import { useCompanyQuery } from './use-crm';

function ContactCompany(props: {
  id: string;
  onOpen?: (id: string) => boolean;
}) {
  const { company } = useCompanyQuery(() => props.id);
  const navigation = useCrmContext().createNavigation();
  return (
    <EntityMetadataRow label="Company">
      <Button
        variant="link"
        size="sm"
        onClick={() => {
          if (!props.onOpen?.(props.id))
            navigation.openWithSplit(
              { type: 'company', id: props.id },
              { activate: true }
            );
        }}
      >
        {company()?.name ?? 'Open company'}
      </Button>
    </EntityMetadataRow>
  );
}

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
              <Show when={contact().email}>
                {(email) => (
                  <EntityMetadataRow label="Email">{email()}</EntityMetadataRow>
                )}
              </Show>
              <Show when={contact().companyId}>
                {(id) => (
                  <ContactCompany id={id()} onOpen={props.onOpenCompany} />
                )}
              </Show>
            </>
          )}
        </Show>
      </div>
    </SidePanel.Section>
  );
}
