import { afterEach, describe, expect, it, vi } from 'vitest';
import { animateSecurityHandoff } from './animateSecurityHandoff';

const originalAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'animate'
);
afterEach(() => {
  document.body.replaceChildren();
  if (originalAnimate)
    Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
  vi.unstubAllGlobals();
});

function setup(reduced = false) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reduced }))
  );
  const completions: (() => void)[] = [];
  const cancel = vi.fn();
  const animate = vi.fn(
    (_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({
      finished: new Promise<void>((resolve) => completions.push(resolve)),
      cancel,
    })
  );
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  const shell = document.createElement('div');
  shell.className = 'onboarding-flow';
  shell.dataset.onboardingScroll = '';
  const content = document.createElement('div');
  content.innerHTML = '<div data-security-item>Source</div>'.repeat(3);
  shell.append(content);
  document.body.append(shell);
  const commit = vi.fn(() => {
    content.innerHTML =
      '<h1 tabindex="-1">Google connection</h1>' +
      '<div data-privacy-item>Assurance</div>'.repeat(3);
  });
  const settle = async () => {
    completions.forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
  };
  return { content, commit, animate, cancel, settle };
}

describe('security handoff', () => {
  it.each([54, 44])(
    'keeps %dpx feature bubbles circular and selected styling intact outside their original parent',
    async (size) => {
      const view = setup();
      const style = document.createElement('style');
      style.textContent = `
        .feature-flow-icon { width: 76px; height: 76px; border-radius: 50%; }
        .feature-overview .feature-flow-icon { width: ${size}px; height: ${size}px; }
        .feature-overview [aria-pressed=true] .feature-flow-icon {
          background-color: rgb(247, 125, 103); box-shadow: inset 0 0 0 1px coral;
        }
        .feature-overview .feature-flow-check { position: absolute; width: 20px; height: 20px; right: -3px; bottom: -3px; }
        .feature-overview .feature-flow-check svg { width: 12px; height: 12px; }
      `;
      document.body.append(style);
      view.content.innerHTML = `
        <section class="feature-overview">
          <button aria-pressed="true"><div class="feature-flow-icon" data-tool-surface>
            <span class="feature-flow-check"><svg></svg></span>
          </div></button>
        </section>`;
      const source = view.content.querySelector<HTMLElement>(
        '[data-tool-surface]'
      )!;
      vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(100, 200, size, size)
      );
      const background = getComputedStyle(source).backgroundColor;
      const shadow = getComputedStyle(source).boxShadow;
      animateSecurityHandoff(
        view.content,
        () => {
          view.content.innerHTML = '<div data-security-item>Proof</div>'.repeat(
            3
          );
        },
        'features'
      );
      const overlay = document.querySelector('[data-security-transition]')!;
      const ghost = overlay.children[1] as HTMLElement;
      expect(getComputedStyle(ghost).width).toBe(`${size}px`);
      expect(getComputedStyle(ghost).height).toBe(`${size}px`);
      expect(getComputedStyle(ghost).borderRadius).toBe('50%');
      expect(getComputedStyle(ghost).backgroundColor).toBe(background);
      expect(getComputedStyle(ghost).boxShadow).toBe(shadow);
      const check = ghost.querySelector('.feature-flow-check')!;
      expect(getComputedStyle(check).position).toBe('absolute');
      expect(getComputedStyle(check).height).toBe('20px');
      expect(getComputedStyle(check.querySelector('svg')!).width).toBe('12px');
      await Promise.resolve();
      await view.settle();
      expect(document.querySelector('[data-security-transition]')).toBeNull();
    }
  );

  it('carries the intro icon downward before the proof row enters downward', async () => {
    const view = setup();
    view.content.innerHTML = `
      <div data-workspace-intro>
        <svg><filter id="intro-noise"></filter><rect filter="url(#intro-noise)" /></svg>
        <button class="workspace-intro-icon">Macro</button>
      </div>
      <p>Already have an account?</p>`;
    const commit = () => {
      view.content.innerHTML =
        '<h1 tabindex="-1">Security</h1>' +
        '<div data-security-item>Proof</div>'.repeat(3);
    };
    animateSecurityHandoff(view.content, commit, 'intro');
    const snapshot = document.querySelector(
      '[data-security-transition]'
    )?.firstElementChild;
    expect(snapshot?.textContent).toContain('Already have an account?');
    const filter = snapshot?.querySelector('filter');
    expect(filter?.id).not.toBe('intro-noise');
    expect(snapshot?.querySelector('rect')?.getAttribute('filter')).toBe(
      `url(#${filter?.id})`
    );
    await Promise.resolve();
    const exit = view.animate.mock.calls.find(
      ([frames]) => frames[0].transform === 'translate(0, 0)'
    );
    expect(exit?.[0].at(-1)?.transform).toMatch(/translate\(0px, [1-9]\d*px\)/);
    const entrance = view.animate.mock.calls.find(
      ([frames]) => frames[0].translate === '0 -28px'
    );
    expect(entrance?.[0].at(-1)?.translate).toBe('0 0');
    expect(entrance?.[1].delay).toBeGreaterThan(0);
    await view.settle();
    expect(document.querySelector('[data-security-transition]')).toBeNull();
    expect(view.content.inert).toBeFalsy();
  });

  it('preserves centered feature positions throughout the entrance and cleanup', async () => {
    const view = setup();
    view.content.innerHTML =
      '<button class="workspace-intro-icon">Macro</button>';
    animateSecurityHandoff(
      view.content,
      () => {
        view.content.innerHTML =
          '<div class="feature-flow-core"></div><button class="feature-flow-node" style="transform:translate(-50%, -50%)">Docs</button>';
      },
      'intro'
    );
    await Promise.resolve();
    const entrances = view.animate.mock.calls.filter(
      ([frames]) => frames[0].translate === '0 -28px'
    );
    expect(entrances).toHaveLength(2);
    for (const [frames] of entrances) {
      expect(frames.every((frame) => frame.transform === undefined)).toBe(true);
      expect(frames.at(-1)?.translate).toBe('0 0');
    }
    await view.settle();
    expect(
      view.content.querySelector<HTMLElement>('.feature-flow-node')?.style
        .transform
    ).toBe('translate(-50%, -50%)');
  });

  it('skips snapshots and motion when reduced motion is requested', () => {
    const view = setup(true);
    animateSecurityHandoff(view.content, view.commit);
    expect(view.commit).toHaveBeenCalledOnce();
    expect(view.animate).not.toHaveBeenCalled();
    expect(document.querySelector('[data-security-transition]')).toBeNull();
    expect(view.content.hasAttribute('aria-busy')).toBe(false);
  });

  it('keeps the arriving screen inert until movement settles, then restores focus', async () => {
    const view = setup();
    animateSecurityHandoff(view.content, view.commit);
    expect(view.commit).toHaveBeenCalledOnce();
    expect(view.content.inert).toBe(true);
    expect(
      document
        .querySelector('[data-security-transition]')
        ?.getAttribute('aria-hidden')
    ).toBe('true');
    await Promise.resolve();
    expect(view.animate).toHaveBeenCalled();
    await view.settle();
    expect(view.content.inert).toBeFalsy();
    expect(view.content.hasAttribute('aria-busy')).toBe(false);
    expect(view.content.style.opacity).toBe('');
    expect(document.querySelector('[data-security-transition]')).toBeNull();
    expect(document.activeElement).toBe(view.content.querySelector('h1'));
  });

  it('can be disposed before destination measurement without leaving a hidden screen', async () => {
    const view = setup();
    const dispose = animateSecurityHandoff(view.content, view.commit);
    dispose();
    await Promise.resolve();
    expect(view.animate).not.toHaveBeenCalled();
    expect(view.content.inert).toBeFalsy();
    expect(view.content.style.opacity).toBe('');
    expect(document.querySelector('[data-security-transition]')).toBeNull();
  });

  it('settles an interrupted resize without stale snapshots or blocked controls', async () => {
    const view = setup();
    animateSecurityHandoff(view.content, view.commit);
    await Promise.resolve();
    window.dispatchEvent(new Event('resize'));
    expect(view.cancel).toHaveBeenCalled();
    expect(view.content.inert).toBeFalsy();
    expect(document.querySelector('[data-security-transition]')).toBeNull();
    await view.settle();
    expect(document.activeElement).toBe(view.content.querySelector('h1'));
  });

  it('settles when reading begins without moving focus back to the hero', async () => {
    const view = setup();
    animateSecurityHandoff(view.content, view.commit);
    await Promise.resolve();
    const heading = document.createElement('h2');
    heading.tabIndex = -1;
    view.content.parentElement?.append(heading);
    heading.focus();
    view.content.parentElement?.dispatchEvent(new Event('scroll'));
    expect(view.content.inert).toBeFalsy();
    expect(document.querySelector('[data-security-transition]')).toBeNull();
    expect(document.activeElement).toBe(heading);
    await view.settle();
    expect(document.activeElement).toBe(heading);
  });
});
