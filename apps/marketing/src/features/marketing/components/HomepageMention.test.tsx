import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { HomepageMention } from './HomepageMention';

afterEach(cleanup);
it('opens the linked source on click without producing a hover popup', () => {
  const open = vi.fn();
  const view = render(() => (
    <HomepageMention
      kind="md"
      label="Setup plan"
      description="The shared setup steps."
      href="/documents"
      onOpen={open}
    />
  ));
  const link = view.getByRole('link', { name: 'Setup plan' });
  fireEvent.pointerEnter(link);
  fireEvent.focus(link);
  expect(view.queryByText('The shared setup steps.')).toBeNull();
  fireEvent.click(link);
  expect(open).toHaveBeenCalledExactlyOnceWith(link);
});
it('keeps normal navigation available for links without a local source', () => {
  const view = render(() => (
    <HomepageMention
      kind="pdf"
      label="Macro overview.pdf"
      description="Learn about documents in Macro."
      href="/documents"
    />
  ));
  const link = view.getByRole('link', { name: 'Macro overview.pdf' });
  expect(link.getAttribute('href')).toBe('/documents');
  expect(link.getAttribute('target')).toBe('_blank');
});
