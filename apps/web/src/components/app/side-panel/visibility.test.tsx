import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SidePanelVisibilityProvider,
  useSidePanelVisibility,
} from './visibility';

function Panel(props: { name: string }) {
  const [open, setOpen] = useSidePanelVisibility();
  return (
    <button onClick={() => setOpen((value) => !value)}>
      {props.name}: {open() ? 'open' : 'closed'}
    </button>
  );
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('shared side panel preference', () => {
  it('synchronizes mounted panels and restores the choice after remount', async () => {
    const ui = () => (
      <SidePanelVisibilityProvider>
        <Panel name="Channel" />
        <Panel name="Document" />
        <Panel name="Email" />
      </SidePanelVisibilityProvider>
    );
    render(ui);
    await fireEvent.click(screen.getByText('Channel: open'));
    expect(screen.getByText('Document: closed')).toBeTruthy();
    expect(screen.getByText('Email: closed')).toBeTruthy();
    expect(localStorage.getItem('macro:pref:side-panel:open')).toBe('false');
    cleanup();
    render(ui);
    expect(screen.getByText('Channel: closed')).toBeTruthy();
    await fireEvent.click(screen.getByText('Email: closed'));
    expect(screen.getByText('Document: open')).toBeTruthy();
  });
});
