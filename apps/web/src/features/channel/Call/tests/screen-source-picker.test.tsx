/** @vitest-environment jsdom */
import { ImperativeDialogHost } from '@app/components/ui/components/ImperativeDialog';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { ComponentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenCaptureSources } from '../desktop-screen-capture';
import { pickScreenSource } from '../ScreenSourcePicker';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/ImperativeDialog')),
  ...(await import('@app/components/ui/components/Dialog')),
  ...(await import('@app/components/ui/components/ActionDialogShell')),
  ...(await import('@app/components/ui/components/RadioGroup')),
  Button: (props: ComponentProps<'button'>) => (
    <button type={props.type} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));
beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SOURCES: ScreenCaptureSources = {
  hasAccess: true,
  sources: [
    {
      id: 'screen:1:0',
      kind: 'screen',
      name: null,
      appName: null,
      builtin: true,
    },
    {
      id: 'screen:2:0',
      kind: 'screen',
      name: null,
      appName: null,
      builtin: false,
    },
    {
      id: 'window:42:0',
      kind: 'window',
      name: 'Quarterly plan',
      appName: 'Keynote',
      builtin: false,
    },
  ],
};

function share() {
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
}

describe('screen source picker', () => {
  it('shares the main screen unless the user picks another source', async () => {
    render(() => <ImperativeDialogHost />);
    const picked = pickScreenSource(SOURCES);

    expect(
      (screen.getByLabelText('Built-in display') as HTMLInputElement).checked
    ).toBe(true);
    screen.getByLabelText('Display 1');
    fireEvent.click(screen.getByLabelText('Quarterly plan'));
    share();

    await expect(picked).resolves.toMatchObject({ id: 'window:42:0' });
  });

  it('resolves with nothing when cancelled', async () => {
    render(() => <ImperativeDialogHost />);
    const picked = pickScreenSource(SOURCES);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(picked).resolves.toBeUndefined();
    await waitFor(() =>
      expect(screen.queryByText('Share your screen')).toBeNull()
    );
  });

  it('explains missing Screen Recording access', async () => {
    render(() => <ImperativeDialogHost />);
    const picked = pickScreenSource({ ...SOURCES, hasAccess: false });

    expect(screen.getByRole('alert').textContent).toContain('Screen Recording');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(picked).resolves.toBeUndefined();
  });
});
