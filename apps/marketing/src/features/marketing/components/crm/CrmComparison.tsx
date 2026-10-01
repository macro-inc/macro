import CaretDown from '@phosphor/caret-down.svg';
import {
  ComparisonLegend,
  type ComparisonRow,
  ComparisonTable,
} from '../../../../app/components/sections/ComparisonTable';

const comparisonRows: ComparisonRow[] = [
  {
    feature: 'Builds itself from your email (no data entry)',
    cells: [true, false, 'partial', 'partial'],
  },
  {
    feature: 'Automatic company enrichment',
    cells: [true, 'partial', true, true],
  },
  {
    feature: 'Discussion threads on every record',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: '@mention records in docs, tasks & chat',
    cells: [true, false, false, false],
  },
  {
    feature: 'One customer view across email, calls, docs & tasks',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: 'Built-in email, calls, docs & tasks',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: 'Agents with full-workspace context',
    cells: [true, 'partial', 'partial', 'partial'],
  },
  {
    feature: 'Unified search across everything',
    cells: [true, false, false, false],
  },
  { feature: 'Open source (AGPLv3)', cells: [true, false, false, false] },
];

export function CrmComparison() {
  return (
    <details class="feature-page-comparison">
      <summary>
        <span>Compare CRM tools</span>
        <CaretDown aria-hidden="true" />
      </summary>
      <div class="feature-page-comparison-content">
        <ComparisonTable
          columns={['Macro', 'Salesforce', 'HubSpot', 'Attio'].map((label) => ({
            label,
          }))}
          rows={comparisonRows}
        />
        <ComparisonLegend />
        <p>
          Availability varies by product and plan. See{' '}
          <a href="/pricing">Macro pricing</a> for current plans and limits.
        </p>
      </div>
    </details>
  );
}
