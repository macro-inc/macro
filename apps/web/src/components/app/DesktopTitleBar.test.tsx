import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type {
  SplitHandle,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopTitleBar } from './DesktopTitleBar';

vi.mock('@ui', () => ({
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
  ) => (
    <button
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  setGlobalSplitManager(undefined);
});

it('navigates the active split and disables unavailable directions', () => {
  const [firstCanGoBack, setFirstCanGoBack] = createSignal(false);
  const [firstCanGoForward, setFirstCanGoForward] = createSignal(false);
  const first = {
    canGoBack: firstCanGoBack,
    canGoForward: firstCanGoForward,
    goBack: vi.fn(),
    goForward: vi.fn(),
  } as unknown as SplitHandle;
  const second = {
    canGoBack: () => true,
    canGoForward: () => true,
    goBack: vi.fn(),
    goForward: vi.fn(),
  } as unknown as SplitHandle;
  const [activeSplit, setActiveSplit] = createSignal(first);
  setGlobalSplitManager({
    activeSplit,
    canAppendSplit: () => false,
  } as unknown as SplitManager);

  render(() => <DesktopTitleBar />);
  const back = screen.getByRole('button', {
    name: 'Go Back',
  }) as HTMLButtonElement;
  const forward = screen.getByRole('button', {
    name: 'Go Forward',
  }) as HTMLButtonElement;
  expect(back.disabled).toBe(true);
  expect(forward.disabled).toBe(true);

  setFirstCanGoBack(true);
  fireEvent.click(back);
  expect(first.goBack).toHaveBeenCalledOnce();
  expect(forward.disabled).toBe(true);

  setActiveSplit(second);
  expect(back.disabled).toBe(false);
  expect(forward.disabled).toBe(false);
  fireEvent.click(back);
  fireEvent.click(forward);
  expect(second.goBack).toHaveBeenCalledOnce();
  expect(second.goForward).toHaveBeenCalledOnce();
  expect(first.goForward).not.toHaveBeenCalled();

  setFirstCanGoForward(true);
  setActiveSplit(first);
  expect(forward.disabled).toBe(false);
});
