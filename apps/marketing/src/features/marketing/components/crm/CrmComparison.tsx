import CaretDown from '@phosphor/caret-down.svg';
import {
  ComparisonLegend,
  type ComparisonRow,
  ComparisonTable,
} from '../../../../app/components/sections/ComparisonTable';

const comparisonRows: ComparisonRow[] = [
  {
    feature: 'Companies and contacts created from your email',
    cells: [true, false, 'partial', 'partial'],
  },
  {
    feature: 'Company descriptions filled in automatically',
    cells: [true, 'partial', true, true],
  },
  {
    feature: 'Threaded discussion on every company',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: '@mention companies in docs, tasks, and chat',
    cells: [true, false, false, false],
  },
  {
    feature: 'Emails, calls, files, and tasks on the record',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: 'Email, calls, docs, and tasks in the same app',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: 'Agents can also read your email, calls, and docs',
    cells: [true, 'partial', 'partial', 'partial'],
  },
  {
    feature: 'One search across email, chat, docs, and customers',
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
