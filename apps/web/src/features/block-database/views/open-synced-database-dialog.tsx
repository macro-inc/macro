import { lazyNamed } from '@core/util/lazyNamed';
import { type ManagedDialogProps, openDialog } from '@ui';
import { type ComponentProps, Suspense } from 'solid-js';

// The dialog loads as its own chunk; the launcher that opens it is on the startup path.
const SyncedDatabaseDialog = lazyNamed(
  () => import('./SyncedDatabaseDialog'),
  'SyncedDatabaseDialog'
);

type SyncedDatabaseDialogProps = ComponentProps<typeof SyncedDatabaseDialog> &
  ManagedDialogProps;

/** Ask for a source, then create a database whose table mirrors it. */
export function openSyncedDatabaseDialog(options: {
  createdFrom: string;
  onCreated: (databaseId: string) => void;
}) {
  return openDialog<SyncedDatabaseDialogProps>(
    (props) => (
      <Suspense>
        <SyncedDatabaseDialog {...props} />
      </Suspense>
    ),
    options,
    { key: 'synced-database' }
  );
}
