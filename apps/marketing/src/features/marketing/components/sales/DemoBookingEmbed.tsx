import { onCleanup, onMount } from 'solid-js';
import { buildCalSlugWithAttribution } from '../../../../app/utils/utilAnalytic';
import { DEMO_BOOKING_URL } from '../../../../app/utils/utilCta';

type CalApi = ((...args: unknown[]) => void) & {
  loaded?: boolean;
  ns?: Record<string, (...args: unknown[]) => void>;
  q?: unknown[];
};

const NAMESPACE = 'macro-demo';
const CAL_SCRIPT = 'https://app.cal.com/embed/embed.js';
// The homepage's white primary button.
const BRAND = '#fafafa';

const calThemeVars = {
  'cal-bg': '#0c0c0c',
  'cal-bg-emphasis': '#1a1a1a',
  'cal-bg-subtle': '#141414',
  'cal-bg-muted': '#141414',
  'cal-bg-inverted': '#f5f5f5',
  'cal-border': '#ffffff1a',
  'cal-border-default': '#ffffff1a',
  'cal-border-emphasis': '#ffffff40',
  'cal-border-subtle': '#ffffff14',
  'cal-border-booker': '#ffffff1a',
  'cal-border-booker-width': '1px',
  'cal-brand': BRAND,
  'cal-brand-emphasis': '#ffffff',
  'cal-brand-text': '#000',
  'cal-text': '#d4d4d4',
  'cal-text-emphasis': '#fff',
  'cal-text-muted': '#8a8a8a',
  'cal-text-subtle': '#a3a3a3',
} as const;

/** cal.com's documented loader: queues calls until embed.js arrives. */
function loadCal(): CalApi {
  const w = window as unknown as { Cal?: CalApi };
  if (w.Cal) return w.Cal;
  const push = (target: { q?: unknown[] }, args: unknown) => {
    target.q = target.q || [];
    target.q.push(args);
  };
  const cal: CalApi = (...args: unknown[]) => {
    if (!cal.loaded) {
      cal.ns = {};
      cal.q = cal.q || [];
      document.head.appendChild(document.createElement('script')).src =
        CAL_SCRIPT;
      cal.loaded = true;
    }
    if (args[0] === 'init') {
      const api: CalApi = (...apiArgs: unknown[]) => push(api, apiArgs);
      const namespace = args[1];
      if (typeof namespace === 'string') {
        cal.ns![namespace] = cal.ns![namespace] || api;
        push(cal.ns![namespace] as CalApi, args);
        push(cal, ['initNamespace', namespace]);
      } else {
        push(cal, args);
      }
      return;
    }
    push(cal, args);
  };
  w.Cal = cal;
  return cal;
}

/**
 * Inline cal.com booker for the Macro demo call. Loads embed.js only once the
 * visitor nears it, so the ad landing page's first paint stays light.
 */
export function DemoBookingEmbed(props: { id: string }) {
  let host!: HTMLDivElement;
  onMount(() => {
    const start = () => {
      const cal = loadCal();
      cal('init', NAMESPACE, { origin: 'https://app.cal.com' });
      const api = cal.ns?.[NAMESPACE];
      api?.('inline', {
        elementOrSelector: `#${props.id}`,
        config: {
          layout: 'month_view',
          theme: 'dark',
          useSlotsViewOnSmallScreen: 'true',
        },
        calLink: buildCalSlugWithAttribution(
          new URL(DEMO_BOOKING_URL).pathname.slice(1)
        ),
      });
      api?.('ui', {
        theme: 'dark',
        layout: 'month_view',
        hideEventTypeDetails: false,
        styles: { branding: { brandColor: BRAND } },
        cssVarsPerTheme: { light: calThemeVars, dark: calThemeVars },
      });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        start();
      },
      { rootMargin: '1200px 0px' }
    );
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });
  return <div ref={host} id={props.id} class="sales-booking-embed" />;
}
