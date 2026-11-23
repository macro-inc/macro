import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { createCallPanel } from '../primitives/create-call-panel';

it('keeps the automatic open shut while the panel would cover the stage', () => {
  createRoot((dispose) => {
    const [wide, setWide] = createSignal(false);
    const panel = createCallPanel(
      () => true,
      () => {},
      wide
    );
    // A narrow split: the participants stay visible.
    expect(panel.state.open).toBe(false);
    setWide(true);
    expect(panel.state.open).toBe(true);
    expect(panel.state.tab).toBe('chat');
    setWide(false);
    expect(panel.state.open).toBe(false);
    dispose();
  });
});

it('opens on request in a narrow split, and an explicit close stays closed', () => {
  createRoot((dispose) => {
    const [wide, setWide] = createSignal(false);
    const panel = createCallPanel(
      () => true,
      () => {},
      wide
    );
    panel.toggle();
    expect(panel.state.open).toBe(true);
    panel.close();
    setWide(true);
    expect(panel.state.open).toBe(false);
    dispose();
  });
});

it('keeps an automatic panel the viewer used open when the call narrows', () => {
  createRoot((dispose) => {
    const [wide, setWide] = createSignal(true);
    const panel = createCallPanel(
      () => true,
      () => {},
      wide
    );
    expect(panel.state.open).toBe(true);
    panel.selectTab('participants');
    setWide(false);
    expect(panel.state.open).toBe(true);
    expect(panel.state.tab).toBe('participants');
    dispose();
  });
});
