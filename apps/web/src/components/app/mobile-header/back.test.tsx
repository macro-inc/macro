import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useSplitBackInterceptor } from '../split-layout/back-interceptor';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '../split-layout/context';
import { MobileHeader } from './mobile-header';

let disposeInterceptor: (() => void) | undefined;
afterEach(() => {
  disposeInterceptor?.();
  disposeInterceptor = undefined;
});

function panel(hasHistory: boolean) {
  return {
    handle: {
      canGoBack: () => hasHistory,
      content: () => ({ type: 'component', id: 'routines' }),
      goBack: vi.fn(),
      replace: vi.fn(),
    },
  };
}

it('runs a page fallback without disabling Back when history is empty', () => {
  const context = panel(false);
  const back = vi.fn();
  render(() => (
    <SplitPanelContext.Provider
      value={context as unknown as SplitPanelContextType}
    >
      <MobileHeader.Back onBack={back} />
    </SplitPanelContext.Provider>
  ));
  fireEvent.click(screen.getByRole('button'));
  expect(back).toHaveBeenCalledOnce();
  expect(context.handle.goBack).not.toHaveBeenCalled();
});

it('lets an unsaved-page interceptor consume Back before its callback', () => {
  const context = panel(true);
  const back = vi.fn();
  const intercept = vi.fn(() => true);
  createRoot((dispose) => {
    disposeInterceptor = dispose;
    useSplitBackInterceptor(intercept);
  });
  render(() => (
    <SplitPanelContext.Provider
      value={context as unknown as SplitPanelContextType}
    >
      <MobileHeader.Back onBack={back} />
    </SplitPanelContext.Provider>
  ));
  fireEvent.click(screen.getByRole('button'));
  expect(intercept).toHaveBeenCalledOnce();
  expect(back).not.toHaveBeenCalled();
});

it('uses shared split history when a page does not override Back', () => {
  const context = panel(true);
  render(() => (
    <SplitPanelContext.Provider
      value={context as unknown as SplitPanelContextType}
    >
      <MobileHeader.Back />
    </SplitPanelContext.Provider>
  ));
  fireEvent.click(screen.getByRole('button'));
  expect(context.handle.goBack).toHaveBeenCalledOnce();
});
