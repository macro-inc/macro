import { cleanup, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileTopEdgeFade } from './MobileEdgeFade';

const device = vi.hoisted(() => ({ touch: true }));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));

vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
}));

afterEach(cleanup);

it('draws the top fade on a touch device outside the native iOS app', () => {
  device.touch = true;
  const { container } = render(() => <MobileTopEdgeFade />);

  expect(container.querySelector('[data-mobile-top-edge-fade]')).not.toBeNull();
});

it('draws no top fade on desktop, where split panes set the top inset to their header', () => {
  device.touch = false;
  const { container } = render(() => <MobileTopEdgeFade />);

  expect(container.querySelector('[data-mobile-top-edge-fade]')).toBeNull();
});
