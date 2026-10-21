import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { DEMO_BOOKING_URL } from '../../../features/marketing/core/navigation';
import { DocsMarkdownScene, REST_T } from './DocsMarkdownScene';

afterEach(cleanup);

it('renders a named scheduling link instead of exposing its raw URL', () => {
  const view = render(() => <DocsMarkdownScene t={() => REST_T} />);
  const booking = view.getByRole('link', { name: 'Team check-in' });
  expect(booking.getAttribute('href')).toBe(DEMO_BOOKING_URL);
  expect(view.queryByText(DEMO_BOOKING_URL)).toBeNull();
});

it('anchors the date-check comment to the launch date and keeps the checklist heading plain', () => {
  const view = render(() => <DocsMarkdownScene t={() => REST_T} />);
  const badge = view.getByRole('img', {
    name: '1 comment on the launch date: Please check the date against Valentina’s email.',
  });
  expect(badge.parentElement?.textContent).toContain('Launch date:');
  expect(badge.parentElement?.querySelector('.mds-mark')).toBeTruthy();
  const heading = view.getByText('Launch checklist');
  expect(heading.closest('.mds-line')?.querySelector('.mds-mark')).toBeNull();
});
