/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTopbar } from './app-topbar';

const mocks = vi.hoisted(() => ({
  activeSplit: undefined as
    | {
        canGoBack: () => boolean;
        canGoForward: () => boolean;
        goBack: () => void;
        goForward: () => void;
      }
    | undefined,
  goBack: vi.fn(),
  goForward: vi.fn(),
  openCommandMenu: vi.fn(),
}));

vi.mock('@app/features/command', () => ({
  CommandState: { open: mocks.openCommandMenu },
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ activeSplit: () => mocks.activeSplit }),
}));

vi.mock('@ui', () => {
  type MockButtonProps = {
    children?: JSX.Element;
    disabled?: boolean;
    label?: string;
    'aria-label'?: string;
    onClick?: () => void;
  };

  const Button = (props: MockButtonProps) => (
    <button
      type="button"
      aria-label={props['aria-label'] ?? props.label}
      disabled={props.disabled}
      onClick={() => props.onClick?.()}
    >
      {props.children}
    </button>
  );

  return { Button, Hotkey: () => <span>⌘K</span> };
});

function splitWithHistory(back: boolean, forward: boolean) {
  return {
    canGoBack: () => back,
    canGoForward: () => forward,
    goBack: mocks.goBack,
    goForward: mocks.goForward,
  };
}

describe('AppTopbar', () => {
  beforeEach(() => {
    mocks.activeSplit = splitWithHistory(true, true);
    mocks.goBack.mockClear();
    mocks.goForward.mockClear();
    mocks.openCommandMenu.mockClear();
  });

  it('navigates the active split’s history', () => {
    const { getByLabelText } = render(() => <AppTopbar />);

    fireEvent.click(getByLabelText('Back'));
    expect(mocks.goBack).toHaveBeenCalled();

    fireEvent.click(getByLabelText('Forward'));
    expect(mocks.goForward).toHaveBeenCalled();
  });

  it('disables a direction the active split cannot go', () => {
    mocks.activeSplit = splitWithHistory(true, false);

    const { getByLabelText } = render(() => <AppTopbar />);

    expect((getByLabelText('Back') as HTMLButtonElement).disabled).toBe(false);
    expect((getByLabelText('Forward') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('disables both directions with no active split', () => {
    mocks.activeSplit = undefined;

    const { getByLabelText } = render(() => <AppTopbar />);

    expect((getByLabelText('Back') as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText('Forward') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('opens the command menu from the search field', () => {
    const { getByLabelText } = render(() => <AppTopbar />);

    fireEvent.click(getByLabelText('Search Macro'));
    expect(mocks.openCommandMenu).toHaveBeenCalled();
  });
});
