import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';
import {
  buildSimpleEntityUrl,
  openExternalUrl,
  registerExternalUrlInterceptor,
} from './url';

const platform = vi.hoisted(() => ({
  tauri: false,
  mobile: undefined as 'ios' | 'android' | undefined,
}));
vi.mock('./platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform')>()),
  isTauri: () => platform.tauri,
  getNativeMobilePlatform: () => platform.mobile,
}));
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

it('copies routine links using the canonical route', () => {
  expect(
    new URL(buildSimpleEntityUrl({ type: 'routine', id: 'routine-1' })).pathname
  ).toBe('/app/routines/routine-1');
});

describe('openExternalUrl', () => {
  let openSpy: MockInstance<typeof window.open>;
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
    platform.tauri = false;
    platform.mobile = undefined;
    invoke.mockReset();
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

  it('hands the URL to the native policy on desktop without touching the page', async () => {
    platform.tauri = true;
    invoke.mockResolvedValue(true);

    openExternalUrl('https://example.com');

    expect(invoke).toHaveBeenCalledWith('open_external_url', {
      url: 'https://example.com',
    });
    await new Promise((resolve) => setTimeout(resolve));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens a popup on desktop when the native policy leaves it to the page', async () => {
    platform.tauri = true;
    invoke.mockResolvedValue(false);

    openExternalUrl('http://tauri.localhost/presenter.html');

    await vi.waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'http://tauri.localhost/presenter.html',
        '_blank',
        'noopener,noreferrer'
      )
    );
  });

  it('opens a popup on a native shell older than the command', async () => {
    platform.tauri = true;
    invoke.mockRejectedValue('Command open_external_url not found');

    openExternalUrl('https://example.com');

    await vi.waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://example.com',
        '_blank',
        'noopener,noreferrer'
      )
    );
  });

  it('opens a popup at once on desktop for a string that is not a URL', () => {
    platform.tauri = true;

    openExternalUrl('example.com');

    expect(invoke).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(
      'example.com',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('navigates in place on mobile, where only navigation reaches native', () => {
    platform.tauri = true;
    platform.mobile = 'ios';

    openExternalUrl('https://example.com');

    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_self');
    expect(invoke).not.toHaveBeenCalled();
  });
});
