import { t } from '@app/lib/i18n';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import { RecordValueRow } from './record-value-row';

/**
 * One address and the actions it can take: Remove, unless the address links
 * the contact to its company, then Make primary, unless it is the primary.
 */
export function ContactEmailRow(props: {
  email: string;
  primary: boolean;
  linksCompany: boolean;
  /** Whether the server listed the addresses, so they can be changed. */
  manageable: boolean;
  busy: boolean;
  size: 'details' | 'editor';
  /** Record details opens the email editor from the address. */
  onOpen?: (anchor: HTMLButtonElement) => void;
  /** The address's button, where focus goes once it becomes primary. */
  addressRef?: (element: HTMLButtonElement) => void;
  /** Whether the email editor is open from this address. */
  expanded?: boolean;
  onMakePrimary(): void;
  onRemove(): void;
}) {
  return (
    <RecordValueRow
      value={props.email}
      icon={EnvelopeIcon}
      primary={props.primary}
      primaryLabel={t('crm.primaryEmail')}
      manageable={props.manageable}
      busy={props.busy}
      size={props.size}
      private
      openLabel={t('crm.manageContactEmail', { email: props.email })}
      onOpen={props.onOpen}
      valueRef={props.addressRef}
      expanded={props.expanded}
      remove={
        props.linksCompany
          ? undefined
          : {
              label: t('crm.removeContactEmailNamed', { email: props.email }),
              tooltip: t('crm.removeContactEmail'),
              run: () => props.onRemove(),
            }
      }
      makePrimary={
        props.primary
          ? undefined
          : {
              label: t('crm.makeContactEmailPrimaryNamed', {
                email: props.email,
              }),
              tooltip: t('crm.makePrimaryContactEmail'),
              run: () => props.onMakePrimary(),
            }
      }
    />
  );
}
