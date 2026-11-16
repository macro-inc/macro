import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { SplitHeaderScope, useSplitHeaderScope } from './SplitHeaderScope';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from './split-layout/context';

vi.mock('../priority-collapse/PriorityCollapseOverflowSensor', () => ({
  createPriorityCollapseController: () => ({
    setRow: () => {},
    collapser: {},
  }),
  PriorityCollapseOverflowSensor: () => null,
}));

afterEach(cleanup);

it('answers for the nearest host only', () => {
  const [hosting, setHosting] = createSignal(false);
  const Detail = () => (
    <output>{useSplitHeaderScope() ? 'hosted header' : 'own bar'}</output>
  );

  render(() => (
    <SplitPanelContext.Provider value={{} as SplitPanelContextType}>
      {/* An inline preview frame around a view that hosts a detail. */}
      <SplitHeaderScope.Root>
        <SplitHeaderScope.Root when={hosting()}>
          <Detail />
        </SplitHeaderScope.Root>
      </SplitHeaderScope.Root>
    </SplitPanelContext.Provider>
  ));

  expect(screen.getByRole('status').textContent).toBe('own bar');

  setHosting(true);
  expect(screen.getByRole('status').textContent).toBe('hosted header');
});
