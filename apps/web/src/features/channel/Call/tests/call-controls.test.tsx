/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallControlBar } from '../CallControls/CallControlBar';

vi.mock('@ui', async () => ({
  ...(await import('../../../../components/ui/components/Button')),
  Tooltip: (props: { children: JSX.Element }) => props.children,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const toggleAudio = vi.fn(),
    leave = vi.fn(),
    toggleBackground = vi.fn();
  const { container } = render(() => (
    <CallControlBar
      disabled={false}
      audioMuted={false}
      videoMuted={false}
      screenSharing={false}
      menuOpen={menuOpen()}
      onToggleAudio={toggleAudio}
      onToggleVideo={() => {}}
      onToggleScreen={() => {}}
      onLeave={leave}
      audioSettings={<button type="button">Microphone device</button>}
      videoSettings={<button type="button">Camera device</button>}
      backgroundActive={false}
      backgroundDisabled={false}
      onToggleBackground={toggleBackground}
      backgroundSettings={<button type="button">Background picker</button>}
    />
  ));
  const bar = container.querySelector('[data-call-controls]')!;
  const hover = (element: Element) =>
    fireEvent(
      element,
      Object.assign(new Event('pointerenter', { bubbles: false }), {
        pointerType: 'mouse',
      })
    );
  return { bar, hover, setMenuOpen, toggleAudio, toggleBackground, leave };
}

describe('call controls', () => {
  it('previews settings on hover, keeps them while a device menu is open, and closes after leaving', () => {
    vi.useFakeTimers();
    const { bar, hover, setMenuOpen } = setup();
    hover(screen.getByRole('group', { name: 'Microphone controls' }));
    expect(screen.queryByRole('region')).toBeNull();
    vi.advanceTimersByTime(150);
    expect(screen.getByRole('region', { name: 'Audio settings' })).toBeTruthy();
    setMenuOpen(true);
    fireEvent.pointerLeave(bar);
    vi.advanceTimersByTime(350);
    expect(screen.getByRole('region')).toBeTruthy();
    setMenuOpen(false);
    fireEvent.pointerLeave(bar);
    vi.advanceTimersByTime(350);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('ignores a quick pass over a control and cancels a close when the pointer returns', () => {
    vi.useFakeTimers();
    const { bar, hover } = setup();
    const group = screen.getByRole('group', { name: 'Microphone controls' });
    hover(group);
    vi.advanceTimersByTime(70);
    fireEvent.pointerLeave(group);
    vi.advanceTimersByTime(200);
    expect(screen.queryByRole('region')).toBeNull();
    hover(group);
    vi.advanceTimersByTime(150);
    fireEvent.pointerLeave(bar);
    vi.advanceTimersByTime(200);
    hover(bar);
    vi.advanceTimersByTime(200);
    expect(screen.getByRole('region')).toBeTruthy();
  });

  it('pins settings by click and dismisses on an outside pointer', () => {
    vi.useFakeTimers();
    const { bar } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Audio settings' }));
    fireEvent.pointerLeave(bar);
    vi.advanceTimersByTime(350);
    expect(screen.getByRole('region')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('returns keyboard focus to the disclosure when Escape closes settings', () => {
    setup();
    const disclosure = screen.getByRole('button', { name: 'Camera settings' });
    fireEvent.click(disclosure);
    const device = screen.getByRole('button', { name: 'Camera device' });
    expect(document.activeElement).toBe(device);
    fireEvent.keyDown(device, { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull();
    expect(document.activeElement).toBe(disclosure);
  });

  it('previews backgrounds with the shared hover delay and toggles the effect independently', () => {
    vi.useFakeTimers();
    const { hover, toggleBackground } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on background' }));
    expect(toggleBackground).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region')).toBeNull();
    hover(screen.getByRole('group', { name: 'Background controls' }));
    vi.advanceTimersByTime(70);
    expect(screen.queryByRole('region')).toBeNull();
    vi.advanceTimersByTime(80);
    expect(
      screen.getByRole('region', { name: 'Background settings' })
    ).toBeTruthy();
    const disclosure = screen.getByRole('button', {
      name: 'Background settings',
    });
    fireEvent.click(disclosure);
    const picker = screen.getByRole('button', { name: 'Background picker' });
    expect(document.activeElement).toBe(picker);
    fireEvent.keyDown(picker, { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull();
    expect(document.activeElement).toBe(disclosure);
  });

  it('keeps media actions independent from the settings disclosures', () => {
    const { toggleAudio, leave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    expect(toggleAudio).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    expect(leave).toHaveBeenCalledOnce();
  });
});
