import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceDesktopDemo } from './WorkspaceDesktopDemo';

vi.mock('./DemoInteractionBoundary', () => ({
  DemoInteractionBoundary: (props: {
    children: unknown;
    render?: () => unknown;
  }) => props.render?.() ?? props.children,
}));
afterEach(cleanup);

it('omits simulated browser chrome while retaining the hero and its app content', () => {
  const view = render(() => (
    <WorkspaceDesktopDemo
      heroFrame
      windowChrome={false}
      view="crm"
      label="Explore Macro CRM"
    >
      <div>Sales pipeline</div>
    </WorkspaceDesktopDemo>
  ));
  const frame = view.getByRole('region', { name: 'Explore Macro CRM' });
  expect(frame.getAttribute('data-hero-frame')).toBe('true');
  expect(frame.getAttribute('data-window-chrome')).toBe('false');
  expect(frame.querySelector('.email-desktop-titlebar')).toBeNull();
  expect(frame.querySelector('.email-desktop-traffic-lights')).toBeNull();
  expect(frame.querySelector('.email-desktop-wallpaper')).toBeTruthy();
  expect(view.getByText('Sales pipeline')).toBeTruthy();
});

it('preserves the existing title bar on other product frames', () => {
  const view = render(() => (
    <WorkspaceDesktopDemo heroFrame view="documents" label="Explore Macro Docs">
      <div>Shared document</div>
    </WorkspaceDesktopDemo>
  ));
  expect(view.container.querySelector('.email-desktop-titlebar')).toBeTruthy();
  expect(
    view
      .getByRole('link', { name: 'Open the sample workspace in a new tab' })
      .getAttribute('href')
  ).toBe('/demo');
  expect(view.getByText('Shared document')).toBeTruthy();
});
