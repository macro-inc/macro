import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoryStage, type StoryStep } from './StoryStage';

const originalAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'animate'
);
afterEach(() => {
  cleanup();
  if (originalAnimate)
    Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
  vi.unstubAllGlobals();
});

function setup(options: { reduced?: boolean; initial?: StoryStep } = {}) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: options.reduced ?? false }))
  );
  const completions: (() => void)[] = [];
  const cancel = vi.fn();
  const animate = vi.fn(() => ({
    finished: new Promise<void>((resolve) => completions.push(resolve)),
    cancel,
  }));
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  const [step, setStep] = createSignal<StoryStep>(options.initial ?? 'welcome');
  const next = vi.fn(() => {
    const order: StoryStep[] = ['welcome', 'vision', 'tools', 'security'];
    setStep(order[Math.min(order.indexOf(step()) + 1, 3)]);
  });
  const view = render(() => (
    <StoryStage step={step()} onNext={next}>
      <button data-tool-tile="Linear">
        <span data-tool-surface>Linear</span>
      </button>
      <button onClick={next}>Can I trust it?</button>
    </StoryStage>
  ));
  const settle = async () => {
    await Promise.resolve();
    completions.splice(0).forEach((finish) => finish());
    await Promise.resolve();
  };
  return { ...view, next, animate, cancel, step, setStep, settle };
}

describe('opening story', () => {
  it('leaves wheel and page navigation keys to native scrolling', () => {
    const view = setup();
    fireEvent.wheel(window, { deltaY: 200 });
    fireEvent.keyDown(window, { key: 'PageDown' });
    fireEvent.touchStart(window, { touches: [{ clientY: 300 }] });
    fireEvent.touchEnd(window, { changedTouches: [{ clientY: 180 }] });
    expect(view.next).not.toHaveBeenCalled();
    expect(view.step()).toBe('welcome');
  });

  it('follows Why → How → connections → trust without a timed security interlude', async () => {
    const view = setup({ reduced: true });
    fireEvent.click(view.getByRole('button', { name: 'Why?' }));
    expect(view.getByRole('heading', { level: 1 }).textContent).toContain(
      'Your whole workspace'
    );
    fireEvent.click(view.getByRole('button', { name: 'How?' }));
    expect(view.step()).toBe('tools');
    fireEvent.click(view.getByRole('button', { name: 'Can I trust it?' }));
    expect(view.step()).toBe('security');
    expect(view.getByText('ISO 27001')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Create my team' })).toBeTruthy();
    expect(view.animate).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it('blocks repeated advances while moving and restores focus after settling', async () => {
    const view = setup();
    const why = view.getByRole('button', { name: 'Why?' });
    fireEvent.click(why);
    fireEvent.click(why);
    expect(view.next).toHaveBeenCalledOnce();
    expect(
      view.container.querySelector<HTMLElement>('[data-story-stage]')?.inert
    ).toBe(true);
    await view.settle();
    expect(
      view.container.querySelector<HTMLElement>('[data-story-stage]')?.inert
    ).toBe(false);
    expect(document.activeElement).toBe(
      view.getByRole('heading', { level: 1 })
    );
    expect(document.querySelector('[data-story-transition]')).toBeNull();
  });

  it('restores OAuth directly to tools without replaying the story', () => {
    const view = setup({ initial: 'tools' });
    expect(view.getByText('Linear')).toBeTruthy();
    expect(view.animate).not.toHaveBeenCalled();
    expect(view.next).not.toHaveBeenCalled();
  });

  it('cleans up interrupted transitions and can continue from the selected slide', async () => {
    const view = setup();
    fireEvent.click(view.getByRole('button', { name: 'Why?' }));
    await Promise.resolve();
    view.setStep('tools');
    expect(view.cancel).toHaveBeenCalled();
    await view.settle();
    expect(view.getByRole('button', { name: 'Can I trust it?' })).toBeTruthy();
    expect(document.querySelector('[data-story-transition]')).toBeNull();
  });

  it('removes the outgoing snapshot when unmounted before measurement', async () => {
    const view = setup();
    fireEvent.click(view.getByRole('button', { name: 'Why?' }));
    view.unmount();
    await Promise.resolve();
    expect(view.animate).not.toHaveBeenCalled();
    expect(document.querySelector('[data-story-transition]')).toBeNull();
  });
});
