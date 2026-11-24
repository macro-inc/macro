import { t } from '@app/lib/i18n';
import { thrownResultErrorHasCode } from '@core/util/result';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ContactCompanyProperty } from '../components/contact-company-property';
import {
  ContactEmailList,
  ContactEmailPill,
} from '../components/contact-email-property';
import { useCrmContext } from '../context/crm-context';
import {
  type CrmContact,
  contactCompanyName,
  contactCompanySummary,
  contactEmails,
} from '../core/contact';
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

/** Where a contact's properties are drawn: the record header or Record details. */
type ContactPropertySurface = 'header' | 'details';

/** Key editor state by record identity so navigation cannot reuse an old draft. */
export function ContactEmailField(props: {
  contact: CrmContact;
  surface: ContactPropertySurface;
}) {
  const mutation = useCrmContext().editContactEmail();
  // The one address on the company's domain is what links the contact to it.
  const companyEmail = () => {
    const linking = props.contact.companyDomainEmails;
    return linking?.length === 1 ? linking[0] : undefined;
  };
  return (
    <Show when={props.contact.id} keyed>
      {(_id) => (
        <Dynamic
          component={
            props.surface === 'header' ? ContactEmailPill : ContactEmailList
          }
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
            // Without the address list only a blank contact can add, and the
            // primary route is the one every server has for that.
            const listed = props.contact.emails !== undefined;
            await mutation.mutateAsync({
              contact: props.contact,
              email,
              change: change === 'add' && !listed ? 'primary' : change,
            });
          }}
        />
      )}
    </Show>
  );
}

export function ContactCompanyField(props: {
  contact: CrmContact;
  surface: ContactPropertySurface;
  onOpenCompany?: (id: string) => boolean;
}) {
  const context = useCrmContext();
  const mutation = context.editContactCompany();
  // The contact detail names its company; read the company only without it.
  const summary = () => contactCompanySummary(props.contact);
  const { company } = useCompanyQuery(() =>
    summary() ? '' : (props.contact.companyId ?? '')
  );
  const companyName = () => {
    const known = summary();
    return known ? contactCompanyName(known) : company()?.name;
  };
  const navigation = context.createNavigation();
  const openCompany = useSplitNavigationHandler<HTMLButtonElement>((event) => {
    const id = props.contact.companyId;
    if (!id) return;
    if (!event.shiftKey && props.onOpenCompany?.(id)) return;
    navigation.openWithSplit(
      { type: 'company', id },
      { activate: true, preferNewSplit: event.shiftKey }
    );
  });
  // Older servers omit the classification; the relation then stays read-only.
  const independent = () => props.contact.companyDomain === false;
  return (
    <Show when={props.contact.id} keyed>
      {(_id) => (
        <ContactCompanyProperty
          surface={props.surface}
          editable={
            independent() &&
            (props.contact.personalEmail === true || !props.contact.companyId)
          }
          removable={independent()}
          lockedReason={
            props.contact.companyDomain
              ? t('crm.contactCompanyLinkedByEmail')
              : undefined
          }
          companyId={props.contact.companyId}
          companyName={companyName()}
          errorMessage={editError}
          save={async (companyId) => {
            await mutation.mutateAsync({ contact: props.contact, companyId });
          }}
          openCompany={openCompany}
        />
      )}
    </Show>
  );
}
