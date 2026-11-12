import { cleanup, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { EntityDetailTopBar } from './EntityDetailTopBar';

const fixture = vi.hoisted(() => ({ mobile: true }));
vi.mock('@core/mobile/isMobile', () => ({
  isMobile: () => fixture.mobile,
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 400, height: 48 }),
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    HeaderActionsOutlet: () => null,
    Toggle: () => null,
  },
}));
vi.mock('../view-shell', () => ({
  ViewShell: {
    TopBar: (props: ParentProps) => <div>{props.children}</div>,
  },
  ViewBreadcrumbs: {
    Outlet: (props: ParentProps) => <nav>{props.children}</nav>,
  },
}));

afterEach(() => {
  cleanup();
  fixture.mobile = true;
});

it('preserves phone navigation when no replacement title is supplied', () => {
  render(() => (
    <EntityDetailTopBar
      navigation={() => <button>Project tasks</button>}
      titleMenu={<button>Project menu</button>}
    />
  ));
  expect(screen.getByRole('button', { name: 'Project tasks' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Project menu' })).toBeTruthy();
});

it('keeps existing phone tabs outside the replacement title menu', () => {
  const title = vi.fn(() => <button>Project title</button>);
  render(() => (
    <EntityDetailTopBar
      navigation={() => <button>Project tasks</button>}
      mobileTitle={title}
    />
  ));
  expect(screen.getByRole('button', { name: 'Project title' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Project tasks' })).toBeTruthy();
  expect(title).toHaveBeenCalledTimes(1);
});

it('keeps desktop navigation without mounting the phone title', () => {
  fixture.mobile = false;
  const title = vi.fn(() => <button>Project title</button>);
  render(() => (
    <EntityDetailTopBar
      navigation={() => <button>Project tasks</button>}
      mobileTitle={title}
    />
  ));
  expect(screen.getByRole('button', { name: 'Project tasks' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Project title' })).toBeNull();
  expect(title).not.toHaveBeenCalled();
});
