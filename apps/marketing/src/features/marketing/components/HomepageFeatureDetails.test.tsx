import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import {
  HomepageFeatureDetails,
  type ProductPagePath,
} from './HomepageFeatureDetails';

afterEach(cleanup);

it.each<{ title: string; path: ProductPagePath }>([
  { title: 'Email', path: '/email' },
  { title: 'Chat', path: '/channels' },
  { title: 'Documents', path: '/documents' },
  { title: 'Tasks', path: '/tasks' },
  { title: 'Agents', path: '/agents' },
  { title: 'CRM', path: '/crm' },
])('links $title directly to its full product page', ({ title, path }) => {
  const view = render(() => (
    <HomepageFeatureDetails title={title} path={path} />
  ));
  const link = screen.getByRole('link', { name: `Learn more about ${title}` });
  expect(link.getAttribute('href')).toBe(path);
  expect(link.getAttribute('target')).toBeNull();
  expect(link.hasAttribute('aria-haspopup')).toBe(false);
  expect(view.container.querySelector('iframe')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});
