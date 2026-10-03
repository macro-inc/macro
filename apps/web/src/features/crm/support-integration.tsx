import { SupportHistory } from '@app/features/support/support-history';
import type { CrmRecordScope } from './core/record';
export function CrmRecordSupport(props: { scope: CrmRecordScope }) {
  return (
    <SupportHistory
      companyId={props.scope.type === 'company' ? props.scope.id : undefined}
      contactId={props.scope.type === 'contact' ? props.scope.id : undefined}
    />
  );
}
