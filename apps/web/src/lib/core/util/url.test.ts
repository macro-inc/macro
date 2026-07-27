import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openExternalUrl, registerExternalUrlInterceptor } from './url';

describe('openExternalUrl', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  const disposers: Array<() => void> = [];

  // Register + track the disposer so afterEach can tear it down; interceptors
  // otherwise accumulate across tests.
  function register(interceptor: (url: string) => boolean) {
    const dispose = registerExternalUrlInterceptor(interceptor);
    disposers.push(dispose);
    return dispose;
  }

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    openSpy.mockRestore();
  });

  it('lets a registered interceptor claim the URL instead of opening a tab', () => {
    const interceptor = vi.fn(() => true);
    register(interceptor);

    openExternalUrl('mailto:alice@example.com');

    expect(interceptor).toHaveBeenCalledWith('mailto:alice@example.com');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('tries interceptors in registration order and stops at the first to claim', () => {
    const first = vi.fn(() => false);
    const second = vi.fn(() => true);
    const third = vi.fn(() => true);
    register(first);
    register(second);
    register(third);

    openExternalUrl('https://example.com');

    expect(first).toHaveBeenCalledWith('https://example.com');
    expect(second).toHaveBeenCalledWith('https://example.com');
    // second already claimed it — third and the window.open fallback never run.
    expect(third).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('no longer consults an interceptor once it is unregistered', () => {
    const interceptor = vi.fn(() => true);
    const dispose = register(interceptor);
    dispose();

    openExternalUrl('https://example.com');

    expect(interceptor).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('opens a new tab when no interceptor claims the URL', () => {
    register(() => false);

    openExternalUrl('https://example.com');

    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
