import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ContactEmailChange } from '../core/contact';
import { ContactEmailRow } from './contact-email-row';
import { RecordValueEditor } from './record-value-editor';
import type { ValueChange } from './value-change';

export type ChangeContactEmail = (
  email: string,
  change: ContactEmailChange
) => Promise<void>;

/**
 * Every address with its actions, under a field that adds another. The field
 * stays for the next address while the contact can take one; once it can't
 * (a server without the address list), the editor closes after the add.
 */
export function ContactEmailEditor(props: {
  emails: string[];
  primary: string | null | undefined;
  manageable: boolean;
  companyEmail: string | undefined;
  /** Owned by the editor's host, which keeps it open while a change saves. */
  request: ValueChange<ContactEmailChange>;
  onClose(): void;
}) {
  const run = async (
    email: string,
    kind: 'remove' | 'primary',
    refocus: () => void
  ) => {
    if (await props.request.run(email, kind)) refocus();
  };

  return (
    <RecordValueEditor
      values={props.emails}
      canAdd={props.manageable || props.emails.length === 0}
      field={{
        label: t('crm.email'),
        formLabel: t('crm.addEmail'),
        placeholder: t('crm.addEmailPlaceholder'),
        type: 'email',
        private: true,
      }}
      listLabel={t('crm.email')}
      saving={props.request.saving()}
      error={props.request.error()}
      clearError={props.request.clearError}
      add={(email) => props.request.run(email, 'add')}
      onClose={props.onClose}
      row={(email, refocus) => (
        <ContactEmailRow
          size="editor"
          email={email}
          primary={email === props.primary}
          linksCompany={email === props.companyEmail}
          manageable={props.manageable}
          busy={props.request.saving()}
          onMakePrimary={() =>
            fireAndForget(run(email, 'primary', refocus), 'crm')
          }
          onRemove={() => fireAndForget(run(email, 'remove', refocus), 'crm')}
        />
      )}
    />
  );
}
