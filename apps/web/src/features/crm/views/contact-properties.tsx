import { t } from '@app/lib/i18n';
import { thrownResultErrorHasCode } from '@core/util/result';
import { Show } from 'solid-js';
import { ContactCompanyProperty } from '../components/contact-company-property';
import { ContactEmailProperty } from '../components/contact-email-property';
import { ContactPhonesProperty } from '../components/contact-phones-property';
import { useCrmContext } from '../context/crm-context';
import type { CrmContact } from '../core/contact';
import { useCompanyQuery } from './use-crm';

function editError(error: unknown): string {
  if (thrownResultErrorHasCode(error, 'CONFLICT'))
    return t('crm.contactEditConflict');
  if (
    ['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND'].some((code) =>
      thrownResultErrorHasCode(error, code)
    )
  )
    return t('crm.contactEditUnavailable');
  if (thrownResultErrorHasCode(error, 'BAD_REQUEST'))
    return t('crm.contactEditInvalid');
  return t('crm.contactEditFailed');
}

/** Key editor state by record identity so navigation cannot reuse an old draft. */
export function ContactEmailField(props: { contact: CrmContact }) {
  const mutation = useCrmContext().editContactEmail();
  return (
    <Show when={props.contact.id} keyed>
      {(_id) => (
        <ContactEmailProperty
          email={props.contact.email}
          errorMessage={(error) =>
            thrownResultErrorHasCode(error, 'CONFLICT')
              ? t('crm.contactEmailConflict')
              : editError(error)
          }
          save={async (email) => {
            await mutation.mutateAsync({ contact: props.contact, email });
          }}
        />
      )}
    </Show>
  );
}

/** The contact's phone numbers; keyed like the other fields, so an open editor closes on navigation. */
export function ContactPhonesField(props: { contact: CrmContact }) {
  const context = useCrmContext();
  const phones = context.createContactPhones(() => props.contact.id);
  const mutation = context.setContactPhones();
  return (
    <Show when={props.contact.id} keyed>
      {(contactId) => (
        <ContactPhonesProperty
          phones={phones.data?.map((phone) => phone.phone)}
          errorMessage={(error) =>
            thrownResultErrorHasCode(error, 'BAD_REQUEST')
              ? t('crm.contactPhonesInvalid')
              : editError(error)
          }
          save={async (next) => {
            await mutation.mutateAsync({ contactId, phones: next });
          }}
        />
      )}
    </Show>
  );
}

export function ContactCompanyField(props: {
  contact: CrmContact;
  onOpenCompany?: (id: string) => boolean;
}) {
  const context = useCrmContext();
  const mutation = context.editContactCompany();
  const { company } = useCompanyQuery(() => props.contact.companyId ?? '');
  const navigation = context.createNavigation();
  return (
    <Show when={props.contact.id} keyed>
      {(_id) => (
        <ContactCompanyProperty
          editable={props.contact.personalEmail === true}
          companyId={props.contact.companyId}
          companyName={company()?.name}
          errorMessage={editError}
          save={async (companyId) => {
            await mutation.mutateAsync({ contact: props.contact, companyId });
          }}
          openCompany={(event) => {
            const id = props.contact.companyId;
            if (!id) return;
            if (!event.shiftKey && props.onOpenCompany?.(id)) return;
            navigation.openWithSplit(
              { type: 'company', id },
              { activate: true, preferNewSplit: event.shiftKey }
            );
          }}
        />
      )}
    </Show>
  );
}
