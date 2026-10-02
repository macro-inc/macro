import { useSplitLayout } from '@components/app/split-layout/layout';
import { CrmProvider } from './context/crm-context';
import { companyCreation, contactCreation } from './creation-adapter';
import { createAppCrmContext } from './crm-adapter';
import { CreateCompanyModal as CompanyDialog } from './views/create-company';
import { CreateContactModal as ContactDialog } from './views/create-contact';

export {
  openCreateCompanyModal,
  openCreateContactModal,
} from './creation-adapter';
export function CreateCompanyModal() {
  const { replaceOrInsertSplit } = useSplitLayout();
  return (
    <CrmProvider value={createAppCrmContext()}>
      <CompanyDialog
        open={companyCreation.open()}
        onClose={companyCreation.close}
        onCreated={(id) => replaceOrInsertSplit({ type: 'company', id })}
      />
    </CrmProvider>
  );
}
export function CreateContactModal() {
  const { replaceOrInsertSplit } = useSplitLayout();
  return (
    <CrmProvider value={createAppCrmContext()}>
      <ContactDialog
        target={contactCreation.target()}
        onClose={contactCreation.close}
        onCreated={(id) => replaceOrInsertSplit({ type: 'contact', id })}
      />
    </CrmProvider>
  );
}
