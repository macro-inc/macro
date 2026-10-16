import { createSignal } from 'solid-js';
import { RecordSection } from '../components/record-section';
import { useCrmContext } from '../context/crm-context';
import type { CrmRecordScope } from '../core/record';
import { RecordItemList } from './record-item-list';

/**
 * Documents associated with the record through its properties or references,
 * plus attachments of emails exchanged with its people.
 */
export function RecordFilesSection(props: { scope?: CrmRecordScope }) {
  const [search, setSearch] = createSignal('');
  const files = useCrmContext().createRecordFiles(() => props.scope);
  return (
    <RecordSection title="Files" search={search()} onSearchChange={setSearch}>
      <RecordItemList
        source={files}
        search={search()}
        pending={!props.scope}
        empty={`No files with this ${props.scope?.type ?? 'record'} yet.`}
      />
    </RecordSection>
  );
}

/**
 * Calls associated with the record: linked to it or (for a company) to one of
 * its contacts when the call ended, or referencing it in the call thread.
 */
export function RecordCallsSection(props: { scope?: CrmRecordScope }) {
  const [search, setSearch] = createSignal('');
  const calls = useCrmContext().createRecordCalls(() => props.scope);
  return (
    <RecordSection title="Calls" search={search()} onSearchChange={setSearch}>
      <RecordItemList
        source={calls}
        search={search()}
        pending={!props.scope}
        empty={`No calls with this ${props.scope?.type ?? 'record'} yet.`}
      />
    </RecordSection>
  );
}

/**
 * Items of any type associated with the record: what names it in a
 * Companies or Contacts property and what references it, including through a
 * company's contacts. Lives in the floating information panel.
 */
export function RecordReferencesSection(props: { scope?: CrmRecordScope }) {
  const references = useCrmContext().createRecordReferences(() => props.scope);
  return (
    <RecordItemList
      source={references}
      pending={!props.scope}
      empty={`Nothing references this ${props.scope?.type ?? 'record'} yet.`}
      narrowLayout="condensed"
    />
  );
}
