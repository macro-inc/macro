import type { CaptureOptions, PostHogConfig } from 'posthog-js';

type Properties = Record<string, unknown>;

type PosthogClient = {
  init: (key: string, config: Partial<PostHogConfig>) => unknown;
  capture: (
    event: string,
    properties: Properties,
    options: CaptureOptions
  ) => unknown;
  identify: (
    email: string,
    properties: Properties,
    initialProperties: Properties
  ) => unknown;
  set_config: (config: Partial<PostHogConfig>) => unknown;
};

type PendingEvent =
  | {
      type: 'capture';
      event: string;
      properties: Properties;
      timestamp: Date;
    }
  | { type: 'identify'; email: string };

const pageProperties = (): Properties => ({
  $current_url: window.location.href,
  $host: window.location.host,
  $pathname: window.location.pathname,
  $title: document.title,
  $referrer: document.referrer || '$direct',
  $referring_domain: document.referrer
    ? new URL(document.referrer).hostname
    : '$direct',
});

// Preserve paid and organic landing attribution if navigation happens while
// the SDK chunk is loading. These are the campaign fields supported by PostHog.
const campaignKeys = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gad_source',
  'mc_cid',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'twclid',
  'li_fat_id',
  'igshid',
  'ttclid',
  'rdt_cid',
  'epik',
  'qclid',
  'sccid',
  'irclid',
  '_kx',
];

/** Website-only queue: the SDK downloads after paint, or immediately on an event. */
export const createDeferredPosthog = (
  key: string,
  load: () => Promise<PosthogClient> = () =>
    import('posthog-js').then((module) => module.default)
) => {
  const landingPage = pageProperties();
  const search = new URLSearchParams(window.location.search);
  const campaign: Properties = {};
  const initialProperties: Properties = {
    $initial_current_url: landingPage.$current_url,
    $initial_referrer: landingPage.$referrer,
    $initial_referring_domain: landingPage.$referring_domain,
  };
  for (const name of campaignKeys) {
    const value = search.get(name);
    if (!value) continue;
    campaign[name] = value;
    initialProperties[`$initial_${name}`] = value;
  }

  const pending: PendingEvent[] = [
    {
      type: 'capture',
      event: '$pageview',
      properties: { ...campaign, ...landingPage },
      timestamp: new Date(),
    },
  ];
  let client: PosthogClient | undefined;
  let loading: Promise<void> | undefined;
  let frame = 0;

  const report = (error: unknown) => {
    console.error('[Analytics] Failed to send PostHog analytics:', error);
  };

  const drain = () => {
    if (!client) return;
    while (pending.length) {
      const next = pending.shift();
      if (!next) continue;
      // A rejected individual event must not strand later captures/identity.
      try {
        if (next.type === 'identify') {
          client.identify(next.email, { email: next.email }, initialProperties);
        } else {
          client.capture(next.event, next.properties, {
            timestamp: next.timestamp,
            $set_once: initialProperties,
          });
        }
      } catch (error) {
        report(error);
      }
    }
  };

  const start = () => {
    if (client || loading) return;
    window.cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', start);
    loading = Promise.resolve()
      .then(load)
      .then((loaded) => {
        loaded.init(key, {
          api_host: 'https://macro-prox.macroverse.workers.dev/i/ph',
          ui_host: 'https://us.posthog.com',
          defaults: '2026-01-30',
          // Replay the original landing page and any early navigation exactly
          // once before handing future history-change pageviews to the SDK.
          capture_pageview: false,
          capture_pageleave: true,
        });
        client = loaded;
        drain();
        loaded.set_config({ capture_pageview: 'history_change' });
      })
      .catch(report)
      .finally(() => {
        loading = undefined;
      });
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') start();
  };
  // Two animation frames let the first frame paint before requesting the SDK.
  // Background tabs do not receive frames, so start those immediately instead.
  if (document.visibilityState === 'hidden') {
    start();
  } else {
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(start);
    });
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', start, { once: true });
  }

  const capture = (event: string, data?: Properties) => {
    pending.push({
      type: 'capture',
      event,
      properties: { ...campaign, ...pageProperties(), ...data },
      timestamp: new Date(),
    });
    if (client) drain();
    else start();
  };

  return {
    capture,
    identify: (email: string) => {
      pending.push({ type: 'identify', email });
      if (client) drain();
      else start();
    },
    pageView: () => {
      if (!client) capture('$pageview');
    },
  };
};
