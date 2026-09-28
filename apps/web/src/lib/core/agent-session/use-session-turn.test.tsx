import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  get: vi.fn(),
  acquire: vi.fn(),
}));

vi.mock('./AgentSession', () => ({
  AgentSession: {
    get: session.get,
    acquire: session.acquire,
  },
}));

import { noteSessionActivity, resetSessionTurns } from './session-turn';
import { useSessionTurn } from './use-session-turn';

afterEach(() => {
  cleanup();
  resetSessionTurns();
  session.get.mockReset();
  session.acquire.mockReset();
});

function Follow(props: { id: string }) {
  const turn = useSessionTurn(() => props.id);
  return <span data-testid="turn">{turn() ?? 'none'}</span>;
}

describe('useSessionTurn', () => {
  it('does not acquire a quiet session nobody has open', () => {
    session.get.mockReturnValue(undefined);
    render(() => <Follow id="quiet" />);
    expect(session.acquire).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="turn"]')?.textContent).toBe(
      'none'
    );
  });

  it('acquires a session that just produced a live frame', () => {
    // Resolves like the real one: the hook drops the load's rejection, so a
    // mock that returns nothing would not exercise that path.
    const load = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn();
    session.get.mockReturnValue(undefined);
    session.acquire.mockReturnValue({ load, release });
    noteSessionActivity('live');
    const view = render(() => <Follow id="live" />);
    expect(session.acquire).toHaveBeenCalledWith('live');
    expect(load).toHaveBeenCalledOnce();
    view.unmount();
    expect(release).toHaveBeenCalledOnce();
  });
});
