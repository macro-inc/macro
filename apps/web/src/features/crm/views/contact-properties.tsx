import { t } from '@app/lib/i18n';
import { thrownResultErrorHasCode } from '@core/util/result';
import { Show } from 'solid-js';
import { ContactCompanyProperty } from '../components/contact-company-property';
import { ContactEmailProperty } from '../components/contact-email-property';
import { useCrmContext } from '../context/crm-context';
import { type CrmContact, contactEmails } from '../core/contact';
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
  // The one address on the company's domain is what links the contact to it.
  const companyEmail = () => {
    const linking = props.contact.companyDomainEmails;
    return linking?.length === 1 ? linking[0] : undefined;
  };
  return (
    <Show when={props.contact.id} keyed>
      {(_id) => (
        <ContactEmailProperty
          emails={contactEmails(props.contact)}
          primary={props.contact.email}
          manageable={props.contact.emails !== undefined}
          companyEmail={companyEmail()}
          errorMessage={(error, change) =>
            change === 'add' && thrownResultErrorHasCode(error, 'CONFLICT')
              ? t('crm.contactEmailConflict')
              : editError(error)
          }
          change={async (email, change) => {
            await mutation.mutateAsync({
              contact: props.contact,
              email,
              change,
            });
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
  // Older servers omit the classification; the relation then stays read-only.
  const independent = () => props.contact.companyDomain === false;
  return (
    <Show when={props.contact.id} keyed>
      {(_id) => (
        <ContactCompanyProperty
          editable={props.contact.personalEmail === true && independent()}
          removable={independent()}
          lockedReason={
            props.contact.companyDomain
              ? t('crm.contactCompanyLinkedByEmail')
              : undefined
          }
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
