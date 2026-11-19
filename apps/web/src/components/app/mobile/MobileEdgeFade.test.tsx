import { cleanup, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileTopEdgeFade } from './MobileEdgeFade';

vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
}));

afterEach(cleanup);

it('draws the top fade outside the native iOS app', () => {
  const { container } = render(() => <MobileTopEdgeFade />);

  expect(container.querySelector('[data-mobile-top-edge-fade]')).not.toBeNull();
});
