import posthog from 'posthog-js';
import { isServer } from 'solid-js/web';

declare const gtag: (
  command: 'config' | 'event' | 'js',
  targetId: string | Date,
  config?: Record<string, unknown>
) => void;

declare const fbq: (
  command: 'init' | 'track' | 'trackCustom',
  eventName: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string }
) => void;

/** GA4 measurement id. */
const GA_ID = 'G-52HPEL3FTV';

/** Meta Pixel id — same pixel the base code in index.html initializes. */
const META_PIXEL_ID = '639142540393286';

/**
 * Google Ads account id and Conversion Action labels, mirroring the app's
 * `apps/web/src/lib/analytics/googleConversions.ts`. The site fires these
 * directly now that mobile email capture happens here instead of in the app —
 * keep the labels in step with that file.
 */
const GOOGLE_ADS_ID = 'AW-11035820781';

const GOOGLE_CONVERSION_LABELS = {
  /** Mobile web email capture — visitor submitted their email to get a desktop link. */
  mobile_web_lead: 'lCHSCIntvaccEO2FpY4p',
} as const;

type GoogleConversionAction = keyof typeof GOOGLE_CONVERSION_LABELS;

/** Meta Pixel standard events we fire — `fbq('track', ...)` only accepts these. */
type MetaStandardEvent = 'Lead' | 'CompleteRegistration';

// The old GTM container (GTM-M58X7PJ8) was removed: it is unpublished and
// both gtm.js and ns.html returned 404 on every production page load.
const initializeGoogleAnalytics = () => {
  // Install the dataLayer stub immediately (no network) so gtag()/page_view
  // calls made before the tag script arrives are queued, not lost.
  const gaInit = document.createElement('script');
  // Registering the AW account on page load is what lets gtag pick up ?gclid=…
  // into the _gcl_aw cookie, so a later gtag('event', 'conversion', ...) fire
  // (mobile email capture) can be attributed to the ad click.
  gaInit.innerHTML = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GA_ID}');
    gtag('config', '${GOOGLE_ADS_ID}');
  `;
  document.head.appendChild(gaInit);

  // Fetch gtag.js after first paint; queued dataLayer events drain on load.
  const loadTagScript = () => {
    const gaScript = document.createElement('script');
    gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    gaScript.async = true;
    document.head.appendChild(gaScript);
  };
  if (document.readyState === 'complete') {
    loadTagScript();
  } else {
    window.addEventListener('load', loadTagScript, { once: true });
  }
};

// Meta Pixel base code is inlined in index.html so it fires before the JS
// bundle parses (cold-load bouncers were silent when init lived here).

// Same PostHog project + proxy as the app (js/app analytics.ts). The app is
// served same-origin at macro.com/app/*, so the anonymous distinct_id created
// here is the same person PostHog sees after signup — ad-landing UTMs become
// $initial_utm_* on the eventual identified user.
const initializePosthog = () => {
  // Public client-side key (ships in the bundle either way); env var wins so
  // dev deploys can point elsewhere.
  const key =
    import.meta.env.VITE_POSTHOG_API_KEY ||
    'phc_eSQcxAxPf0FAmnCTckz84305pNlMlOdDKciSKkuX0GO';

  posthog.init(key, {
    api_host: 'https://macro-prox.macroverse.workers.dev/i/ph',
    ui_host: 'https://us.posthog.com',
    defaults: '2026-01-30',
  });
};

const generateEventId = (): string => {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const tryCatch = (callback: VoidFunction, logMessage = 'Error: ') => {
  try {
    callback();
  } catch (e) {
    console.error(logMessage, e);
  }
};

const INITIALIZE_FAIL_ERROR_MESSAGE =
  '[Analytics] Failed to initialize providers:';
const PAGE_VIEW_FAIL_ERROR_MESSAGE = '[Analytics] Failed to send page view';

const createAnalytics = () => {
  // No analytics in dev or during build-time prerendering.
  const disabled = import.meta.env.DEV === true || isServer;

  const initializeProviders = () => {
    if (disabled) return;

    tryCatch(initializeGoogleAnalytics, INITIALIZE_FAIL_ERROR_MESSAGE);
    // Meta Pixel: base code lives in index.html (fires on cold load before bundle).
    tryCatch(initializePosthog, INITIALIZE_FAIL_ERROR_MESSAGE);
  };

  initializeProviders();

  // PostHog is absent here on purpose: its `defaults` config auto-captures
  // initial + history-change pageviews, so a manual capture would double-count.
  const pageView = (path: string) => {
    if (disabled) {
      return;
    }

    tryCatch(() => {
      gtag('event', 'page_view', {
        page_path: path,
        page_location: window.location.href,
      });
    }, PAGE_VIEW_FAIL_ERROR_MESSAGE);

    tryCatch(() => {
      fbq('track', 'PageView', {}, { eventID: generateEventId() });
    }, PAGE_VIEW_FAIL_ERROR_MESSAGE);
  };

  const sendEvent = (
    provider: 'ga' | 'meta' | 'posthog',
    event: string,
    data?: Record<string, unknown>,
    eventId?: string
  ) => {
    if (disabled) {
      return;
    }
    tryCatch(() => {
      switch (provider) {
        case 'ga': {
          gtag('event', event, data);
          break;
        }
        case 'meta': {
          fbq(
            'track',
            event,
            data ?? {},
            eventId ? { eventID: eventId } : undefined
          );
          break;
        }
        case 'posthog': {
          posthog.capture(event, data);
          break;
        }
      }
    }, `[Analytics] Failed to send event to ${provider}`);
  };

  const track = (event: string, data?: Record<string, unknown>) => {
    if (disabled) {
      return;
    }
    const eventId = generateEventId();
    sendEvent('ga', event, data);
    sendEvent('meta', event, data, eventId);
    sendEvent('posthog', event, data);
  };

  /**
   * Fires a Meta Pixel **standard** event (Lead, CompleteRegistration, …).
   * Meta's optimization models are pre-trained on the standard taxonomy and
   * Ads Manager surfaces these natively in its conversion pickers, so campaign
   * conversions must go through here rather than `track()` (which sends a
   * custom event under whatever name it is given).
   */
  const trackMeta = (
    event: MetaStandardEvent,
    data?: Record<string, unknown>
  ) => {
    if (disabled) {
      return;
    }
    sendEvent('meta', event, data, generateEventId());
  };

  /**
   * Fires a Google Ads conversion. `action` resolves to its `AW-{id}/{label}`
   * send-target; pass `transaction_id` (the submitted email works) so Google
   * dedupes a re-fire from a refresh or a revisit of the same page.
   */
  const trackGoogleConversion = (
    action: GoogleConversionAction,
    data?: { value?: number; currency?: string; transaction_id?: string }
  ) => {
    if (disabled) {
      return;
    }
    tryCatch(() => {
      gtag('event', 'conversion', {
        send_to: `${GOOGLE_ADS_ID}/${GOOGLE_CONVERSION_LABELS[action]}`,
        ...data,
      });
    }, '[Analytics] Failed to send Google Ads conversion:');
  };

  /**
   * Attaches a known email to the current visitor across providers, so a lead
   * captured on the site is the same person downstream marketing automation
   * and the app's post-signup events see. Also feeds Meta's advanced matching
   * (`em`), which materially improves ad attribution for the lead.
   */
  const identifyEmail = (email: string) => {
    if (disabled) {
      return;
    }
    tryCatch(() => {
      gtag('config', GA_ID, { user_id: email, email });
      fbq('init', META_PIXEL_ID, { em: email });
      posthog.identify(email, { email });
    }, '[Analytics] Failed to identify visitor:');
  };

  const trackPosthog = (event: string, data?: Record<string, unknown>) => {
    sendEvent('posthog', event, data);
  };

  return {
    pageView,
    track,
    trackPosthog,
    trackMeta,
    trackGoogleConversion,
    identifyEmail,
  };
};

export const analytics = createAnalytics();

/**
 * Collect the Meta attribution signals available in the current browser
 * session. Passed through cal.com (via URL `metadata[...]` params for link
 * flows, or embed `config.metadata` for inline flows) so the backend's
 * server-side Lead event can include them in `user_data` — giving Meta
 * enough to match the conversion back to the originating ad/browser.
 *
 * `user_agent` is opt-in via `includeUserAgent` because it URL-encodes to
 * ~300 chars and bloats visible cal.com links. Embed flows default to
 * including it (it rides in a JS object, not a URL).
 */
export const getCalBookingAttribution = (
  options: { includeUserAgent?: boolean } = {}
): Record<string, string> => {
  const { includeUserAgent = true } = options;
  const signals: Record<string, string> = {};

  if (typeof document !== 'undefined') {
    const cookies = document.cookie.split('; ');
    for (const entry of cookies) {
      const idx = entry.indexOf('=');
      if (idx <= 0) continue;
      const name = entry.slice(0, idx);
      const value = decodeURIComponent(entry.slice(idx + 1));
      if (name === '_fbp' && value) signals.fbp = value;
      if (name === '_fbc' && value) signals.fbc = value;
    }
  }

  if (
    includeUserAgent &&
    typeof navigator !== 'undefined' &&
    navigator.userAgent
  ) {
    signals.user_agent = navigator.userAgent;
  }

  return signals;
};

/**
 * Build a cal.com link with attribution signals appended as
 * `?metadata[key]=value` params. Cal.com forwards these to the webhook
 * under `payload.metadata`. `user_agent` is omitted here to keep the URL
 * readable — embed flows still send it.
 */
export const buildCalLinkWithAttribution = (baseUrl: string): string => {
  const signals = getCalBookingAttribution({ includeUserAgent: false });
  try {
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(signals)) {
      url.searchParams.set(`metadata[${key}]`, value);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
};

/**
 * Attach attribution signals to a cal.com embed slug (e.g.
 * `"forms/7045081b-..."` → `"forms/7045081b-...?metadata[fbp]=..."`).
 *
 * The embed's `config.metadata` option did not forward to webhook payloads
 * in testing — likely because cal.com routing forms drop embed-config
 * metadata at the form → event-type handoff. Appending the params to the
 * slug forces them into the iframe URL, which matches the mechanism the
 * link flow proved works.
 *
 * `user_agent` is included here (embed config is not visible in a URL bar).
 */
export const buildCalSlugWithAttribution = (slug: string): string => {
  const signals = getCalBookingAttribution();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(signals)) {
    params.set(`metadata[${key}]`, value);
  }
  const qs = params.toString();
  if (!qs) return slug;
  const separator = slug.includes('?') ? '&' : '?';
  return `${slug}${separator}${qs}`;
};
