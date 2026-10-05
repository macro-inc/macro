import { queryReadyGate } from '@queries/gate';
import { useDatabaseTemplatesQuery } from '@queries/storage/databases';
import {
  type DialogHandle,
  type ManagedDialogProps,
  openDialog,
} from '@ui/components/ImperativeDialog';
import { Suspense } from 'solid-js';
import { DatabaseTemplatePicker } from '../components/database-template-picker';
import type {
  DatabaseCreation,
  DatabaseTemplates,
} from '../core/database-creation';

function DatabaseTemplatePickerDialog(
  props: ManagedDialogProps & {
    onChoose: (creation: DatabaseCreation) => void;
  }
) {
  const query = useDatabaseTemplatesQuery();
  const templates = (): DatabaseTemplates => {
    if (queryReadyGate(query))
      return { status: 'ready', templates: query.data };
    return query.isError ? { status: 'failed' } : { status: 'loading' };
  };
  return (
    <DatabaseTemplatePicker
      open={props.open}
      onOpenChange={props.onOpenChange}
      templates={templates()}
      onChoose={props.onChoose}
    />
  );
}

/** The templates read is gated and never suspends; this boundary keeps any later read inside the dialog. */
function SuspendedDatabaseTemplatePickerDialog(
  props: ManagedDialogProps & {
    onChoose: (creation: DatabaseCreation) => void;
  }
) {
  return (
    <Suspense>
      <DatabaseTemplatePickerDialog {...props} />
    </Suspense>
  );
}

/** Asks what a new database starts from; `onChoose` runs once, after the picker closes, and never on dismissal. */
export function openDatabaseTemplatePicker(
  onChoose: (creation: DatabaseCreation) => void
): DialogHandle {
  const handle = openDialog(SuspendedDatabaseTemplatePickerDialog, {
    onChoose: (creation) => {
      if (!handle.close({ restoreFocus: false })) return;
      onChoose(creation);
    },
  });
  return handle;
}
