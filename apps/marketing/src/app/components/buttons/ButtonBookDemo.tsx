import SvgBookDemo from '../../../assets/designs/design-book-demo.svg';
import { buildCalLinkWithAttribution } from '../../utils/utilAnalytic';

export function ButtonBookDemo() {
  return (
    <a
      style={{
        transition: 'background-color var(--transition)',
        'text-decoration': 'none',
        'border-radius': '3px',
        width: 'min-content',
        overflow: 'hidden',
        color: 'var(--c2)',
        cursor: 'pointer',
        display: 'block',
      }}
      href={buildCalLinkWithAttribution(
        'https://cal.com/jacob-beckerman-b56mrn'
      )}
      class="hover-relaunch"
      target="_blank"
      rel="noopener"
    >
      <SvgBookDemo
        style={{
          display: 'block',
          height: '28px',
        }}
      />
    </a>
  );
}
