import CaretDown from '@phosphor/caret-down.svg';
import {
  type ComparisonColumn,
  ComparisonLegend,
  type ComparisonRow,
  ComparisonTable,
} from '../../../../app/components/sections/ComparisonTable';
import LogoAsana from '../../../../assets/icons/logo-asana.svg';
import LogoClickUp from '../../../../assets/icons/logo-clickup.svg';
import LogoJira from '../../../../assets/icons/logo-jira.svg';
import LogoLinear from '../../../../assets/icons/logo-linear.svg';

const comparisonColumns: ComparisonColumn[] = [
  { label: 'Macro' },
  { label: 'Linear', logo: LogoLinear },
  { label: 'Asana', logo: LogoAsana },
  { label: 'Jira', logo: LogoJira },
  { label: 'ClickUp', logo: LogoClickUp },
];

const comparisonRows: ComparisonRow[] = [
  {
    feature: 'Status, priority & assignee',
    cells: [true, true, true, true, true],
  },
  {
    feature: 'Create a task from an email',
    cells: [true, true, true, true, true],
  },
  {
    feature: 'Keyboard-first workflows',
    cells: [true, true, 'partial', 'partial', true],
  },
  {
    feature: 'Custom properties when you want them',
    cells: [true, 'partial', true, true, true],
  },
  {
    feature: 'Agents that can complete tasks',
    cells: [true, 'partial', true, 'partial', true],
  },
  {
    feature: 'GitHub: branch, PR & merge move the task',
    cells: [true, true, false, 'partial', 'partial'],
  },
  {
    feature: '@mention a task in docs & channels',
    cells: [true, 'partial', false, false, 'partial'],
  },
  {
    feature: 'Tasks in the same app as email & chat',
    cells: [true, false, false, false, true],
  },
  {
    feature: 'Open source (AGPLv3)',
    cells: [true, false, false, false, false],
  },
];

export function TasksComparison() {
  return (
    <details class="feature-page-comparison">
      <summary>
        <span>Compare task managers</span>
        <CaretDown aria-hidden="true" />
      </summary>
      <div class="feature-page-comparison-content">
        <ComparisonTable columns={comparisonColumns} rows={comparisonRows} />
        <ComparisonLegend />
        <p>
          Read more about{' '}
          <a href="/posts/linear-alternative">Macro and Linear</a>, or see{' '}
          <a href="/pricing">plans and limits</a>.
        </p>
      </div>
    </details>
  );
}
