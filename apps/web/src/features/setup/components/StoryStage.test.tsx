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
  sessionStorage.removeItem('macro:onboarding-features');
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
    const order: StoryStep[] = ['welcome', 'vision', 'security', 'tools'];
    setStep(order[Math.min(order.indexOf(step()) + 1, order.length - 1)]);
  });
  const view = render(() => (
    <StoryStage step={step()} onNext={next}>
      <button data-tool-tile="Linear">
        <span data-tool-surface>Linear</span>
      </button>
      <button onClick={next}>Continue</button>
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

  it('keeps independent feature choices when returning from security', async () => {
    const view = setup({ reduced: true });
    fireEvent.click(view.getByRole('button', { name: 'Get started' }));
    expect(view.step()).toBe('vision');
    fireEvent.click(view.getByRole('button', { name: 'Calendar' }));
    fireEvent.click(view.getByRole('button', { name: 'Docs' }));
    expect(
      view
        .getByRole('button', { name: 'Calendar' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      view.getByRole('button', { name: 'Docs' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(view.queryByRole('status')).toBeNull();
    expect(
      view.getByRole('heading', {
        name: 'Which features do you want to try first?',
      })
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Calendar' }));
    expect(
      view
        .getByRole('button', { name: 'Calendar' })
        .getAttribute('aria-pressed')
    ).toBe('false');
    expect(
      view.getByRole('button', { name: 'Docs' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(view.queryByRole('status')).toBeNull();
    fireEvent.keyDown(view.getByRole('button', { name: 'Calendar' }), {
      key: 'Escape',
    });
    expect(
      view.getByRole('button', { name: 'Docs' }).getAttribute('aria-pressed')
    ).toBe('true');
    fireEvent.click(view.getByRole('button', { name: 'Continue' }));
    expect(view.next).toHaveBeenLastCalledWith(['Docs']);
    expect(view.step()).toBe('security');
    expect(view.getByLabelText('ISO 27001')).toBeTruthy();
    expect(
      view.getByRole('link', { name: /Open source/ }).getAttribute('href')
    ).toBe('https://github.com/macro-inc/macro');
    expect(view.getByText('$30M+ raised')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'How?' })).toBeNull();
    expect(view.animate).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(document.activeElement?.tagName).toBe('H1');
    expect(view.next).toHaveBeenCalledTimes(2);
    view.setStep('vision');
    expect(
      view.getByRole('button', { name: 'Docs' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      view
        .getByRole('button', { name: 'Calendar' })
        .getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('allows continuing without choosing features and tolerates invalid saved choices', () => {
    sessionStorage.setItem('macro:onboarding-features', '{invalid');
    const view = setup({ reduced: true, initial: 'vision' });
    expect(view.getAllByRole('button', { pressed: false })).toHaveLength(15);
    fireEvent.click(view.getByRole('button', { name: 'Continue' }));
    expect(view.next).toHaveBeenLastCalledWith([]);
    expect(view.step()).toBe('security');
  });

  it('restores only supported feature choices after a fresh mount', () => {
    sessionStorage.setItem(
      'macro:onboarding-features',
      JSON.stringify(['Docs', 'Email', 'Docs', 'Unknown', null])
    );
    const view = setup({ reduced: true, initial: 'vision' });
    expect(view.getAllByRole('button', { pressed: true })).toHaveLength(2);
    expect(view.queryByRole('status')).toBeNull();
    expect(view.next).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Continue' }));
    expect(view.next).toHaveBeenLastCalledWith(['Email', 'Docs']);
  });

  it('blocks repeated advances while moving and restores focus after settling', async () => {
    const view = setup();
    const start = view.getByRole('button', { name: 'Get started' });
    fireEvent.click(start);
    fireEvent.click(start);
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

  it('lets the full-slide handoff own motion without starting a nested transition', () => {
    const view = setup();
    view.container.setAttribute('data-security-handoff', '');
    view.setStep('security');
    expect(view.getByText('$30M+ raised')).toBeTruthy();
    expect(view.animate).not.toHaveBeenCalled();
    expect(document.querySelector('[data-security-transition]')).toBeNull();
    expect(document.querySelector('[data-story-transition]')).toBeNull();
  });

  it('cleans up interrupted transitions and can continue from the selected slide', async () => {
    const view = setup();
    fireEvent.click(view.getByRole('button', { name: 'Get started' }));
    await Promise.resolve();
    view.setStep('tools');
    expect(view.cancel).toHaveBeenCalled();
    await view.settle();
    expect(view.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(document.querySelector('[data-story-transition]')).toBeNull();
  });

  it('removes the outgoing snapshot when unmounted before measurement', async () => {
    const view = setup();
    fireEvent.click(view.getByRole('button', { name: 'Get started' }));
    view.unmount();
    await Promise.resolve();
    expect(view.animate).not.toHaveBeenCalled();
    expect(document.querySelector('[data-story-transition]')).toBeNull();
  });
});
