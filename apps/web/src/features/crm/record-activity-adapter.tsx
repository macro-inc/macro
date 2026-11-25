import { EntityActivitySectionConditional } from '@app/features/activity/views/entity-activity-section';

/** A record's Activity section, as other entities' side panels show theirs. */
export function CrmRecordActivity(props: {
  record: { type: 'company' | 'contact'; id: string };
  order: number;
}) {
  return (
    <EntityActivitySectionConditional
      entityId={props.record.id}
      entityType={props.record.type === 'company' ? 'COMPANY' : 'CONTACT'}
      order={props.order}
    />
  );
}
