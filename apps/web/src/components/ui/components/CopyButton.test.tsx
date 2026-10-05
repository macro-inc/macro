import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ButtonGroup } from './ButtonGroup';
import { CopyButton } from './CopyButton';

const cancel = vi.fn();
const connectedAtAnimation: boolean[] = [];
const animate = vi.fn<Element['animate']>(function (this: Element) {
  connectedAtAnimation.push(this.isConnected);
  return { cancel } as unknown as Animation;
});
const originalAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'animate'
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false }))
  );
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  connectedAtAnimation.length = 0;
  if (originalAnimate)
    Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

describe('CopyButton', () => {
  it('copies inside editor containers that stop native click propagation', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    const view = render(() => (
      <div on:click={(event) => event.stopPropagation()}>
        <CopyButton onClick={copy} label="Copy code">
          <svg />
        </CopyButton>
      </div>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await Promise.resolve();
    expect(copy).toHaveBeenCalledOnce();
    expect(view.container.querySelector('[data-copy-feedback]')).not.toBeNull();
  });

  it('waits for success, preserves the existing icon, and restores it after feedback', async () => {
    let complete!: () => void;
    const copy = vi.fn(
      () => new Promise<void>((resolve) => (complete = resolve))
    );
    let forwardedRef: HTMLButtonElement | undefined;
    render(() => (
      <ButtonGroup variant="outline" size="md">
        <CopyButton ref={(element) => (forwardedRef = element)} onClick={copy}>
          <svg aria-hidden="true" style={{ width: '18px', height: '18px' }} />
          Copy
        </CopyButton>
      </ButtonGroup>
    ));
    const button = screen.getByRole('button', { name: 'Copy' });
    const original = button.querySelector('svg')!;
    vi.spyOn(original, 'getBoundingClientRect').mockReturnValue({
      left: 8,
      top: 7,
      width: 18,
      height: 18,
    } as DOMRect);
    expect(forwardedRef).toBe(button);
    expect(button.getAttribute('data-variant')).toBe('outline');
    expect(button.getAttribute('data-size')).toBe('md');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(button.querySelector('[data-copy-feedback]')).toBeNull();
    complete();
    await Promise.resolve();
    const check = button.querySelector<SVGElement>('[data-copy-feedback]')!;
    expect(check.style.width).toBe('18px');
    expect(check.style.height).toBe('18px');
    expect(button.querySelector('svg')).toBe(original);
    expect(button.textContent).toBe('Copy');
    expect(connectedAtAnimation).toEqual([true, true]);
    await vi.advanceTimersByTimeAsync(1600);
    expect(button.querySelector('[data-copy-feedback]')).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });

  it.each([() => false, () => Promise.reject(new Error('denied'))])(
    'does not signal success on a failed copy',
    async (copy) => {
      render(() => (
        <CopyButton onClick={copy}>
          <svg />
          Copy
        </CopyButton>
      ));
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      await Promise.resolve();
      expect(animate).not.toHaveBeenCalled();
    }
  );

  it('preserves bound handlers and leaves text-only buttons unchanged', async () => {
    const copy = vi.fn();
    render(() => <CopyButton onClick={[copy, 'text']}>Copy</CopyButton>);
    const button = screen.getByRole('button', { name: 'Copy' });
    fireEvent.click(button);
    await Promise.resolve();
    expect(copy.mock.calls[0][0]).toBe('text');
    expect(button.querySelector('svg')).toBeNull();
  });

  it('does not animate after unmount while a copy is pending', async () => {
    let complete!: () => void;
    const view = render(() => (
      <CopyButton
        onClick={() => new Promise<void>((resolve) => (complete = resolve))}
      >
        <svg />
        Copy
      </CopyButton>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    view.unmount();
    complete();
    await Promise.resolve();
    expect(animate).not.toHaveBeenCalled();
  });

  it('respects reduced motion and disabled buttons', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
    } as MediaQueryList);
    const copy = vi.fn();
    render(() => (
      <CopyButton onClick={copy}>
        <svg />
        Copy
      </CopyButton>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await Promise.resolve();
    expect(animate.mock.calls[0][1]).toMatchObject({ duration: 0 });
    cleanup();
    render(() => (
      <CopyButton disabled onClick={copy}>
        Disabled
      </CopyButton>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Disabled' }));
    expect(copy).toHaveBeenCalledTimes(1);
  });
});
