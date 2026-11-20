import { SplitPanelContext } from '@components/app/split-layout/context';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { useOpenAgentScreenInPlace } from './screen-user-action';

function ViewScreenButton() {
  const openScreen = useOpenAgentScreenInPlace();
  return (
    <button type="button" onClick={() => openScreen('harness-1')}>
      View screen
    </button>
  );
}

describe('useOpenAgentScreenInPlace', () => {
  it('replaces the split it is called from with the screen (Settings → Machines)', () => {
    const replace = vi.fn();
    render(() => (
      <SplitPanelContext.Provider
        value={
          { handle: { replace } } as unknown as Parameters<
            typeof SplitPanelContext.Provider
          >[0]['value']
        }
      >
        <ViewScreenButton />
      </SplitPanelContext.Provider>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'View screen' }));

    expect(replace).toHaveBeenCalledWith({
      next: {
        type: 'component',
        id: 'agent-screen',
        params: { harnessId: 'harness-1' },
      },
    });
  });
});
