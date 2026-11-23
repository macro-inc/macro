import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { ProductIntroduction } from './ProductIntroduction';

afterEach(cleanup);

it('links a marked product and italicizes a marked word', () => {
  const view = render(() => <ProductIntroduction product="Workspace events" />);
  const routines = view.getByRole('link', { name: 'Routines' });
  expect(routines.getAttribute('href')).toBe('/routines');
  expect(view.getByText('unified').tagName).toBe('EM');
  expect(view.container.textContent).not.toMatch(/\[\[|\]\]|\*/);
});

it('leaves a product’s own name in its introduction as plain text', () => {
  const view = render(() => <ProductIntroduction product="Tasks" />);
  expect(view.queryByRole('link')).toBeNull();
  expect(view.getByText(/^Macro Tasks are auto-created/)).toBeTruthy();
});
