import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { Topbar } from './Topbar';

vi.mock('@app/components/view-shell/ViewShell', () => ({
  ViewShell: {
    TopBar: (props: ParentProps) => <div>{props.children}</div>,
  },
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanel: { CloseButton: () => null },
}));
afterEach(cleanup);

it('uses the block title control without duplicating its title or session menu', () => {
  const share = vi.fn();
  render(() => (
    <Topbar title="Session" titleContent={<button>Session title menu</button>}>
      <button onClick={share}>Share</button>
    </Topbar>
  ));
  expect(
    screen.getByRole('button', { name: 'Session title menu' })
  ).toBeTruthy();
  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Session menu' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(share).toHaveBeenCalledOnce();
});

it('keeps the plain heading for the new conversation page', () => {
  render(() => <Topbar title="New conversation" />);
  expect(
    screen.getByRole('heading', { name: 'New conversation' })
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Side panel' })).toBeNull();
});
