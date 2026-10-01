import DummyWorkspace from '../workspace/DummyWorkspace';

/** The actual sample record, including linked email, discussion, and properties. */
export function CrmRecordDemo() {
  return (
    <div class="crm-record-demo glass-input">
      <DummyWorkspace initialView="crm" initialCompany="meadow" embedded />
    </div>
  );
}
