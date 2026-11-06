import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { Dialog } from '@ui/components/Dialog';
import { createSignal } from 'solid-js';
import { createDummyWorkspace } from '../primitives/createDummyWorkspace';
import { CrmRecordWorkspace } from './crm/CrmRecordWorkspace';
import type { CompanySection } from './workspace/WorkspaceCompanies';

/** Linked sheet cells resolve to a local CRM record, preserving the sheet behind it. */
export default function SpreadsheetRecordPreview(props: {
  company: string;
  person: string;
  email: string;
  kind: 'company' | 'person';
  onClose: () => void;
}) {
  const w = createDummyWorkspace('crm');
  const [section, setSection] = createSignal<CompanySection>(
    props.kind === 'person' ? 'team' : 'overview'
  );
  w.setData('companies', [
    {
      id: 'sheet-company',
      name: props.company,
      domain: props.email.split('@')[1] ?? '',
      description: '',
      stage: 'Customer',
      owner: '',
      revenue: '',
      comments: [],
      emailIds: [],
      contacts: [{ name: props.person, email: props.email }],
    },
  ]);
  w.open('crm', 'sheet-company');
  w.setCompanyFilter('Customers to reach');
  const linked = { ...w, open: () => props.onClose() };
  return (
    <Dialog
      open
      position="center"
      class="homepage-sheet-record workspace-demo portal-scope"
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <header class="homepage-sheet-record-header">
        <Dialog.Title>
          {props.kind === 'person'
            ? `${props.person} · ${props.company}`
            : props.company}
        </Dialog.Title>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Close linked record"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </header>
      <Dialog.Description class="sr-only">
        Linked record from Customers to reach
      </Dialog.Description>
      <CrmRecordWorkspace
        workspace={linked}
        hideCopyLink
        section={section()}
        onSectionChange={setSection}
      />
    </Dialog>
  );
}
