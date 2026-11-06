// @vitest-environment jsdom
import { render, screen } from '@solidjs/testing-library';
import { expect, it, vi } from 'vitest';
import { ScreenProvider } from '../context/screen-context';
import { ScreenPane } from './screen-pane';

it.each([
  { edit: false, touch: false },
  { edit: true, touch: true },
])('hides Take control for %j', ({ edit, touch }) => {
  render(() => (
    <ScreenProvider
      value={{
        host: {
          sessionId: () => 'session',
          harnessId: () => undefined,
          canEdit: () => edit,
          touch: () => touch,
          resolveUrl: async () => '',
        },
        available: () => true,
        open: () => true,
        setOpen: vi.fn(),
      }}
    >
      <ScreenPane connect={async () => ({ disconnect: vi.fn() })} />
    </ScreenProvider>
  ));
  expect(screen.queryByRole('button', { name: 'Take control' })).toBeNull();
});
