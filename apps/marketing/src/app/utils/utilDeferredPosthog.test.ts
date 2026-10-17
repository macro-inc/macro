import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredPosthog } from './utilDeferredPosthog';

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
};

const setup = () => {
  const order: string[] = [];
  const distinctIdsAtCapture: string[] = [];
  let distinctId = 'anonymous';
  const client = {
    init: vi.fn(() => order.push('init')),
    capture: vi.fn((event: string) => {
      order.push(event);
      distinctIdsAtCapture.push(distinctId);
    }),
    identify: vi.fn(
      (
        email: string,
        _properties?: Record<string, unknown>,
        _setOnce?: Record<string, unknown>
      ) => {
        distinctId = email;
        order.push(`identify:${email}`);
      }
    ),
    set_config: vi.fn(() => order.push('automatic pageviews')),
  };
  let resolve!: (value: typeof client) => void;
  const load = vi.fn(
    () =>
      new Promise<typeof client>((done) => {
        resolve = done;
      })
  );
  const analytics = createDeferredPosthog('public-key', load);
  return {
    analytics,
    load,
    client,
    order,
    distinctIdsAtCapture,
    resolve: () => resolve(client),
  };
};

describe('deferred website PostHog', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(
      'https://search.example/results'
    );
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.history.replaceState({}, '', '/?utm_source=launch&gclid=ad-click');
    document.title = 'Macro';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests the SDK after the first paint, without delaying for a timer', async () => {
    const fixture = setup();
    await settle();
    expect(fixture.load).not.toHaveBeenCalled();
    frames.shift()?.(0);
    await settle();
    expect(fixture.load).not.toHaveBeenCalled();
    frames.shift()?.(16);
    await settle();
    expect(fixture.load).toHaveBeenCalledOnce();
    fixture.resolve();
    await settle();
    expect(fixture.order).toEqual(['init', '$pageview', 'automatic pageviews']);
    expect(fixture.client.init).toHaveBeenCalledWith(
      'public-key',
      expect.objectContaining({ capture_pageview: false })
    );
  });

  it('starts immediately for explicit events and drains capture/identify in FIFO order', async () => {
    const fixture = setup();
    fixture.analytics.capture('signup_started', { source: 'hero' });
    fixture.analytics.identify('person@example.com');
    fixture.analytics.capture('signup_complete');
    await settle();
    expect(fixture.load).toHaveBeenCalledOnce();
    expect(fixture.client.capture).not.toHaveBeenCalled();
    fixture.resolve();
    await settle();
    fixture.analytics.capture('after_ready');
    expect(fixture.order).toEqual([
      'init',
      '$pageview',
      'signup_started',
      'identify:person@example.com',
      'signup_complete',
      'automatic pageviews',
      'after_ready',
    ]);
  });

  it('preserves landing attribution, timestamps, and early pageviews across navigation', async () => {
    const fixture = setup();
    const landingUrl = window.location.href;
    window.history.pushState({}, '', '/signup');
    fixture.analytics.pageView();
    fixture.analytics.identify('person@example.com');
    await settle();
    fixture.resolve();
    await settle();

    expect(fixture.client.capture).toHaveBeenNthCalledWith(
      1,
      '$pageview',
      expect.objectContaining({
        $current_url: landingUrl,
        $pathname: '/',
        $referrer: 'https://search.example/results',
        utm_source: 'launch',
        gclid: 'ad-click',
      }),
      expect.objectContaining({
        timestamp: expect.any(Date),
        $set_once: expect.objectContaining({
          $initial_current_url: landingUrl,
          $initial_utm_source: 'launch',
          $initial_gclid: 'ad-click',
        }),
      })
    );
    expect(fixture.client.capture).toHaveBeenNthCalledWith(
      2,
      '$pageview',
      expect.objectContaining({ $pathname: '/signup' }),
      expect.any(Object)
    );
    expect(fixture.client.identify).toHaveBeenCalledWith(
      'person@example.com',
      { email: 'person@example.com' },
      expect.objectContaining({ $initial_current_url: landingUrl })
    );
    fixture.analytics.pageView();
    expect(fixture.client.capture).toHaveBeenCalledTimes(2);
    expect(fixture.client.set_config).toHaveBeenCalledWith({
      capture_pageview: 'history_change',
    });
  });

  it('keeps queued events on import failure and retries on the next action', async () => {
    const fixture = setup();
    fixture.load.mockRejectedValueOnce(new Error('chunk unavailable'));
    fixture.analytics.capture('first');
    await settle();
    expect(console.error).toHaveBeenCalledOnce();
    fixture.analytics.identify('person@example.com');
    await settle();
    expect(fixture.load).toHaveBeenCalledTimes(2);
    fixture.resolve();
    await settle();
    expect(fixture.order).toEqual([
      'init',
      '$pageview',
      'first',
      'identify:person@example.com',
      'automatic pageviews',
    ]);
  });

  it('does not strand later events if one SDK capture throws', async () => {
    const fixture = setup();
    fixture.client.capture.mockImplementationOnce(() => {
      throw new Error('capture failed');
    });
    fixture.analytics.capture('conversion');
    fixture.analytics.identify('person@example.com');
    await settle();
    fixture.resolve();
    await settle();
    expect(console.error).toHaveBeenCalledOnce();
    expect(fixture.order).toEqual([
      'init',
      'conversion',
      'identify:person@example.com',
      'automatic pageviews',
    ]);
  });

  it('identifies the normalized email before the following capture', async () => {
    window.history.replaceState(
      {},
      '',
      '/mobile-signup?utm_source=ig&utm_medium=paid&utm_campaign=spring&utm_content=story&fbclid=click&gclid=ads'
    );
    const fixture = setup();
    fixture.analytics.identify(' Dartagnan@CtrlStrategies.com ', {
      mobile_capture_at: '2026-10-14T12:00:00.000Z',
      mobile_capture_device: 'mobile',
    });
    fixture.analytics.capture('mobile_signup_submitted', {
      button_name: 'mobile_signup_page',
    });
    await settle();
    fixture.resolve();
    await settle();

    expect(fixture.order).toEqual([
      'init',
      '$pageview',
      'identify:dartagnan@ctrlstrategies.com',
      'mobile_signup_submitted',
      'automatic pageviews',
    ]);
    expect(fixture.distinctIdsAtCapture).toEqual([
      'anonymous',
      'dartagnan@ctrlstrategies.com',
    ]);
    expect(fixture.client.identify).toHaveBeenCalledWith(
      'dartagnan@ctrlstrategies.com',
      { email: 'dartagnan@ctrlstrategies.com' },
      expect.objectContaining({
        utm_source: 'ig',
        utm_medium: 'paid',
        utm_campaign: 'spring',
        utm_content: 'story',
        fbclid: 'click',
        mobile_capture_at: '2026-10-14T12:00:00.000Z',
        mobile_capture_device: 'mobile',
      })
    );
    expect(fixture.client.identify.mock.calls[0]?.[2]?.gclid).toBeUndefined();
  });

  it('starts in background tabs where animation frames are suspended', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const fixture = setup();
    await settle();
    expect(fixture.load).toHaveBeenCalledOnce();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    fixture.resolve();
    await settle();
    expect(fixture.client.capture).toHaveBeenCalledOnce();
  });
});
