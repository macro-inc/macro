import CompanyIcon from '@icon/system/regular/building-office.svg';
import NumberIcon from '@icon/system/regular/calculator.svg';
import DateIcon from '@icon/system/regular/calendar-blank.svg';
import CheckboxIcon from '@icon/system/regular/check-square.svg';
import DatabaseIcon from '@icon/system/regular/database.svg';
import FormulaIcon from '@icon/system/regular/function.svg';
import FilterIcon from '@icon/system/regular/funnel.svg';
import SelectIcon from '@icon/system/regular/list-bullets.svg';
import TextIcon from '@icon/system/regular/pencil.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SortIcon from '@icon/system/regular/sort-ascending.svg';
import PeopleIcon from '@icon/system/regular/user-circle.svg';
import { For } from 'solid-js';
import type { DealStage } from '../../core/workspace-fixtures';
import { StageIcon } from '../workspace/CompanyRecord';
import '../paper/database-views-graphic.css';
import './crm-pipeline-database.css';

const deals: {
  company: string;
  stage: DealStage;
  revenue: string;
  renewal: string;
}[] = [
  {
    company: 'Parlor Studio',
    stage: 'Demo',
    revenue: '$18,000',
    renewal: 'Mar 2027',
  },
  {
    company: 'Orbit Labs',
    stage: 'Qualified',
    revenue: '$6,000',
    renewal: 'Jan 2027',
  },
  {
    company: 'Copperleaf',
    stage: 'Customer',
    revenue: '$24,000',
    renewal: 'Jun 2027',
  },
  {
    company: 'Fernway Travel',
    stage: 'Trial',
    revenue: '$9,500',
    renewal: 'Feb 2027',
  },
  { company: 'Northstar Design', stage: 'Lead', revenue: '', renewal: '' },
];

/** The database's column types, named and drawn as its type menu does. */
const fieldTypes = [
  { label: 'Text', icon: TextIcon },
  { label: 'Number', icon: NumberIcon },
  { label: 'Select', icon: SelectIcon },
  { label: 'Date', icon: DateIcon },
  { label: 'Checkbox', icon: CheckboxIcon },
  { label: 'People', icon: PeopleIcon },
  { label: 'Formula', icon: FormulaIcon },
];

/**
 * A sales pipeline drawn as the database it is: its table of deals, a field
 * the team added, and the menu for adding another field of any type.
 */
export function CrmPipelineDatabaseGraphic() {
  return (
    <div class="database-views crm-pipeline-db">
      <div class="database-views-bar">
        <DatabaseIcon class="database-views-mark" aria-hidden="true" />
        <strong>Sales pipeline</strong>
        <div class="database-views-tabs" aria-hidden="true">
          <span class="database-views-pill" aria-pressed="true">
            All deals
          </span>
          <span class="database-views-pill">Board</span>
        </div>
        <span
          class="database-views-pill database-views-extra"
          aria-hidden="true"
        >
          <FilterIcon />
          <SortIcon />
        </span>
      </div>
      <div class="database-views-body" data-view="table">
        <div class="database-views-row database-views-columns">
          <span>#</span>
          <span>
            <CompanyIcon aria-hidden="true" />
            Company
          </span>
          <span>
            <SelectIcon aria-hidden="true" />
            Stage
          </span>
          <span class="crm-pipeline-db-wide">
            <NumberIcon aria-hidden="true" />
            Revenue
          </span>
          <span class="crm-pipeline-db-wide">
            <DateIcon aria-hidden="true" />
            Renewal
          </span>
          <span class="crm-pipeline-db-add">
            <PlusIcon aria-hidden="true" />
          </span>
        </div>
        <For each={deals}>
          {(deal, index) => (
            <div class="database-views-row">
              <span class="database-views-number">{index() + 1}</span>
              <span class="database-views-name">{deal.company}</span>
              <span>
                <StageIcon stage={deal.stage} />
                <span class="truncate">{deal.stage}</span>
              </span>
              <span class="crm-pipeline-db-wide crm-pipeline-db-value">
                {deal.revenue}
              </span>
              <span class="crm-pipeline-db-wide crm-pipeline-db-value">
                {deal.renewal}
              </span>
              <span />
            </div>
          )}
        </For>
        <p class="database-views-count">{deals.length} records in view</p>
      </div>
      <div class="crm-pipeline-db-menu">
        <For each={fieldTypes}>
          {(type, index) => (
            <span data-active={index() === 3 ? '' : undefined}>
              <type.icon aria-hidden="true" />
              {type.label}
            </span>
          )}
        </For>
      </div>
    </div>
  );
}
