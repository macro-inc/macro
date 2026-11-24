import { t } from '@app/lib/i18n';
import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { Dialog } from '@ui/components/Dialog';
import type { ManagedDialogProps } from '@ui/components/ImperativeDialog';
import type { JSX } from 'solid-js';
import type { TimeEntryValues } from '../core/entry-values';
import { EntryForm } from './entry-form';

export type EditEntryDialogProps = ManagedDialogProps & {
  entry: TimeEntryFieldsFragment;
  onSave: (values: TimeEntryValues) => void;
};

/** One entry's form in a dialog, for an entry just saved from a toast's Edit. */
export function EditEntryDialog(props: EditEntryDialogProps): JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} class="w-96">
      <div class="flex flex-col gap-1 p-3">
        <Dialog.Title class="px-2 pt-2 text-base font-semibold text-ink">
          {t('timeTracking.editEntry')}
        </Dialog.Title>
        <EntryForm
          initial={props.entry}
          submitLabel={t('timeTracking.save')}
          onCancel={() => props.onOpenChange(false)}
          onSubmit={(values) => {
            props.onOpenChange(false);
            props.onSave(values);
          }}
        />
      </div>
    </Dialog>
  );
}
