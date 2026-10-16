import type { BaseListEntityProps } from '@entity/composed/list-entity/shared';
import { CompanyGridLayout } from './company-grid-layout';
import { CrmListRow } from './record-row';

/** Customers-list row with the editable Stage, Owner, and Revenue columns. */
export function CompanyListEntity(props: BaseListEntityProps) {
  return <CrmListRow {...props} layout={CompanyGridLayout} />;
}
