import { RecordSection } from '../components/record-section';
import { useCrmContext } from '../context/crm-context';
import type { CrmRecordScope } from '../core/record';
import { RecordItemList } from './record-item-list';

/**
 * Documents associated with the record, plus attachments of emails
 * exchanged with its people.
 */
export function RecordFilesSection(props: { scope?: CrmRecordScope }) {
  const files = useCrmContext().createRecordFiles(() => props.scope);
  return (
    <RecordSection title="Files">
      <RecordItemList
        source={files}
        pending={!props.scope}
        empty={`No files with this ${props.scope?.type ?? 'record'} yet.`}
      />
    </RecordSection>
  );
}

/** Calls associated with the record, including calls with its people. */
export function RecordCallsSection(props: { scope?: CrmRecordScope }) {
  const calls = useCrmContext().createRecordCalls(() => props.scope);
  return (
    <RecordSection title="Calls">
      <RecordItemList
        source={calls}
        pending={!props.scope}
        empty={`No calls with this ${props.scope?.type ?? 'record'} yet.`}
      />
    </RecordSection>
  );
}
