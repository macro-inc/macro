import { Tabs } from '@ui/components/Tabs';
import {
  CRM_RECORD_SECTION_LABELS,
  type CrmRecordSection,
} from '../core/record';

/** Content navigation below the company or contact header. */
export function RecordTabs<S extends CrmRecordSection>(props: {
  sections: readonly S[];
  value: S;
  onChange: (section: S) => void;
}) {
  return (
    <div class="min-w-0 shrink-0 overflow-x-auto scrollbar-hidden px-4 py-2">
      <Tabs
        list={props.sections.map((section) => ({
          value: section,
          label: CRM_RECORD_SECTION_LABELS[section],
        }))}
        value={props.value}
        onChange={(value) => props.onChange(value as S)}
        aria-label="Record sections"
        class="w-max whitespace-nowrap"
      />
    </div>
  );
}
