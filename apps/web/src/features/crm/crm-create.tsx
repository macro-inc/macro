import { useSplitLayout } from '@components/app/split-layout/layout';
import { crmAccessAllowed } from '@service-storage/crm-access-authority';
import { createEffect, on } from 'solid-js';
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
  createEffect(
    on(crmAccessAllowed, (allowed) => {
      if (!allowed) companyCreation.close();
    })
  );
  return (
    <CrmProvider value={createAppCrmContext()}>
      <CompanyDialog
        open={companyCreation.open()}
        onClose={companyCreation.close}
        onCreated={(id) => {
          if (crmAccessAllowed()) replaceOrInsertSplit({ type: 'company', id });
        }}
      />
    </CrmProvider>
  );
}
export function CreateContactModal() {
  const { replaceOrInsertSplit } = useSplitLayout();
  createEffect(
    on(crmAccessAllowed, (allowed) => {
      if (!allowed) contactCreation.close();
    })
  );
  return (
    <CrmProvider value={createAppCrmContext()}>
      <ContactDialog
        target={contactCreation.target()}
        onClose={contactCreation.close}
        onCreated={(id) => {
          if (crmAccessAllowed()) replaceOrInsertSplit({ type: 'contact', id });
        }}
      />
    </CrmProvider>
  );
}
