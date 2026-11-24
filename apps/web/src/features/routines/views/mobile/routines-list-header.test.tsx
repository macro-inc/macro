import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileRoutinesListHeader } from './routines-list-header';

vi.mock('@components/app/mobile-header/mobile-header', () => ({
  MobileHeader: Object.assign(
    (props: ParentProps) => <div>{props.children}</div>,
    {
      Back: (props: { onBack: () => void }) => (
        <button onClick={props.onBack}>Back</button>
      ),
      Island: (props: ParentProps) => <div>{props.children}</div>,
    }
  ),
}));
vi.mock('@app/components/view-shell', () => ({
  ViewSidebar: {
    Toggle: () => <button>Show navigation</button>,
  },
}));

afterEach(cleanup);

it.each([
  [true, 'Show navigation'],
  [false, 'Back'],
] as const)(
  'shows %s entry navigation on the routines list',
  (fromDrawer, action) => {
    const onBack = vi.fn();
    render(() => (
      <MobileRoutinesListHeader
        fromDrawer={fromDrawer}
        onBack={onBack}
        onSearch={() => {}}
        onCreate={() => {}}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(onBack).toHaveBeenCalledTimes(fromDrawer ? 0 : 1);
  }
);
