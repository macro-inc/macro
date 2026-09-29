import CaretDown from '@phosphor/caret-down.svg';
import {
  type ComparisonColumn,
  ComparisonLegend,
  type ComparisonRow,
  ComparisonTable,
} from '../../../../app/components/sections/ComparisonTable';
import LogoGmail from '../../../../assets/icons/logo-gmail.svg';
import LogoOutlook from '../../../../assets/icons/logo-outlook.svg';
import LogoSuperhuman from '../../../../assets/icons/logo-superhuman.svg';

const comparisonColumns: ComparisonColumn[] = [
  { label: 'Macro Mail' },
  { label: 'Superhuman', logo: LogoSuperhuman },
  { label: 'Outlook', logo: LogoOutlook },
  { label: 'Gmail', logo: LogoGmail },
];

const comparisonRows: ComparisonRow[] = [
  {
    feature: 'Multiple accounts in one inbox',
    cells: [true, true, 'partial', 'partial'],
  },
  {
    feature: 'Keyboard-first design',
    cells: [true, true, 'partial', 'partial'],
  },
  {
    feature: 'Agents draft & send for you',
    cells: [true, 'partial', 'partial', 'partial'],
  },
  { feature: 'Free plan', cells: [true, false, true, true] },
  {
    feature: 'Email, chat & tasks in one place',
    cells: [true, false, 'partial', false],
  },
  {
    feature: 'Share email threads with your team',
    cells: [true, false, 'partial', false],
  },
  { feature: 'Split-screen multitasking', cells: [true, false, true, false] },
  {
    feature: 'AI with your whole workspace as context',
    cells: [true, false, false, false],
  },
  {
    feature: '@mention docs, people & tasks',
    cells: [true, false, false, false],
  },
  { feature: 'Shared team memory', cells: [true, false, false, false] },
  { feature: 'Open source', cells: [true, false, false, false] },
];

export function EmailComparison() {
  return (
    <details class="feature-page-comparison">
      <summary>
        <span>Compare email clients</span>
        <CaretDown aria-hidden="true" />
      </summary>
      <div class="feature-page-comparison-content">
        <ComparisonTable columns={comparisonColumns} rows={comparisonRows} />
        <ComparisonLegend />
        <p>
          For current plans and limits, see <a href="/pricing">Macro pricing</a>
          .
        </p>
      </div>
    </details>
  );
}
