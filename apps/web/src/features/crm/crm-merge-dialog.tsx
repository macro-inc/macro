import type { ManagedDialogProps } from '@ui/components/ImperativeDialog';
import { CrmProvider } from './context/crm-context';
import type { MergeCompany } from './core/merge';
import { createAppCrmContext } from './crm-adapter';
import {
  type MergeCandidate,
  MergeCompaniesDialog,
} from './views/merge-companies-dialog';

/** The merge dialog with the app's CRM wiring, for menus outside CRM views. */
export function AppMergeCompaniesDialog(
  props: ManagedDialogProps & {
    companies: MergeCandidate[];
    onMerged: (merge: {
      survivor: MergeCompany;
      merged: MergeCompany[];
    }) => void;
  }
) {
  return (
    <CrmProvider value={createAppCrmContext()}>
      <MergeCompaniesDialog {...props} />
    </CrmProvider>
  );
}
