import { useFocusLock } from '@core/util/createControlledOpenSignal';
import { createSignal } from 'solid-js';

// App-level launchers connect global create actions to the one mounted dialog host.
const [companyOpen, setCompanyOpen] = createSignal(false);
type ContactCreationTarget = {
  company?: { companyId: string; domain: string };
};
const [contactTarget, setContactTarget] = createSignal<ContactCreationTarget>();
const companyLock = useFocusLock('create-company');
const contactLock = useFocusLock('create-contact');
export function openCreateCompanyModal() {
  companyLock.acquire();
  setCompanyOpen(true);
}
export function openCreateContactModal(company?: {
  companyId: string;
  domain: string;
}) {
  contactLock.acquire();
  setContactTarget({ company });
}
export const companyCreation = {
  open: companyOpen,
  close() {
    companyLock.release();
    setCompanyOpen(false);
  },
};
export const contactCreation = {
  target: contactTarget,
  close() {
    contactLock.release();
    setContactTarget(undefined);
  },
};
