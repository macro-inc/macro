import { type Component, onMount } from 'solid-js';
import { buildCalSlugWithAttribution } from '../utils/utilAnalytic';
import { breakpoint } from '../utils/utilBreakpoint';
import { setPageSeo } from '../utils/utilSeo';

const detailCardStyle = {
  border: '1px solid var(--b2)',
  'box-sizing': 'border-box',
  'align-content': 'start',
  padding: '22px',
  display: 'grid',
  gap: '10px',
} as const;

declare global {
  interface Window {
    Cal?: {
      (...args: any[]): void;
      loaded?: boolean;
      ns?: Record<string, (...args: any[]) => void>;
      q?: unknown[];
    };
  }
}

export const RouteStartups: Component = () => {
  setPageSeo({
    title: 'Macro for Startups — Up to $10,000 in Credits',
    description:
      'Macro offers approved pre-seed and seed startups up to $10,000 in credits toward Claude and compute usage, plus hands-on help getting started.',
    path: '/startups',
  });

  onMount(() => {
    type Queueable = {
      q?: unknown[];
    };

    const tightenCalSpacing = () => {
      const calInline = document.querySelector(
        '#my-cal-inline-macro cal-inline'
      ) as HTMLElement | null;
      if (!calInline) return false;

      Object.assign(calInline.style, {
        height: 'auto',
        minHeight: '0',
        maxHeight: 'none',
        margin: '0',
        padding: '0',
        'align-content': 'start',
      });

      return true;
    };

    const initCal = () => {
      if (!window.Cal) return;

      window.Cal('init', 'macro', { origin: 'https://app.cal.com' });

      window.Cal.ns?.macro?.('inline', {
        elementOrSelector: '#my-cal-inline-macro',
        config: {
          layout: 'month_view',
          theme: 'dark',
          'ui.color-scheme': 'dark',
          useSlotsViewOnSmallScreen: true,
        },
        calLink: buildCalSlugWithAttribution(
          'forms/7045081b-4d29-4536-be67-6022b42efd95'
        ),
      });

      window.Cal.ns?.macro?.('ui', {
        colorScheme: 'dark',
        cssVarsPerTheme: {
          light: { 'cal-brand': '#000' },
          dark: { 'cal-brand': '#fff' },
        },
        hideEventTypeDetails: false,
        layout: 'month_view',
        theme: 'dark',
      });

      requestAnimationFrame(() => {
        tightenCalSpacing();
      });
    };

    const observer = new MutationObserver(() => {
      if (tightenCalSpacing()) observer.disconnect();
    });

    const calRoot = document.getElementById('my-cal-inline-macro');
    if (calRoot) {
      observer.observe(calRoot, { childList: true, subtree: true });
    }

    if (window.Cal?.loaded) {
      initCal();
      return;
    }

    ((C, A, L) => {
      const p = (a: Queueable, ar: unknown) => {
        a.q = a.q || [];
        a.q.push(ar);
      };
      const d = C.document;
      C.Cal =
        C.Cal ||
        function (...ar: unknown[]) {
          const cal = C.Cal!;
          if (!cal.loaded) {
            cal.ns = {};
            cal.q = cal.q || [];
            d.head.appendChild(d.createElement('script')).src = A;
            cal.loaded = true;
          }
          if (ar[0] === L) {
            const api: ((...args: unknown[]) => void) & Queueable = function (
              ...args: unknown[]
            ) {
              p(api, args);
            };
            const namespace = ar[1] as string | undefined;
            if (typeof namespace === 'string') {
              cal.ns![namespace] = cal.ns![namespace] || api;
              p(cal.ns![namespace] as Queueable, Array.from(ar));
              p(cal, ['initNamespace', namespace]);
            } else {
              p(cal, Array.from(ar));
            }
            return;
          }
          p(cal, Array.from(ar));
        };
    })(window, 'https://app.cal.com/embed/embed.js', 'init');

    initCal();
  });

  return (
    <div
      style={{
        display: 'grid',
        gap: breakpoint() ? '48px' : '72px',
        'padding-top': breakpoint() ? '48px' : '80px',
        'padding-bottom': '0',
        'padding-left': breakpoint() ? '16px' : '24px',
        'padding-right': breakpoint() ? '16px' : '24px',
        'margin-bottom': '0',
        'box-sizing': 'border-box',
        width: '100%',
        'justify-items': 'center',
      }}
    >
      <section
        style={{
          display: 'grid',
          gap: breakpoint() ? '18px' : '22px',
          'justify-items': 'center',
          'text-align': 'center',
          width: '100%',
          'max-width': '600px',
        }}
      >
        <h1
          style={{
            'font-family': 'display',
            'font-size': breakpoint() ? '38px' : '50px',
            'line-height': breakpoint() ? '1.02' : '0.98',
            'letter-spacing': '-0.035em',
            'font-weight': '450',
            'max-width': '600px',
            margin: '0',
            color: 'var(--c1)',
          }}
        >
          Up to $10,000 in credits for pre-seed and seed startups.
        </h1>
        <p
          style={{
            'font-size': breakpoint() ? '18px' : '22px',
            'line-height': 1.34,
            'max-width': '600px',
            margin: '0',
            color: 'var(--c4)',
          }}
        >
          We are offering approved startups up to $10,000 in credits toward
          Claude and compute usage in Macro, plus hands-on help getting started.
        </p>
      </section>

      <section style={{ width: '100%', 'max-width': '600px' }}>
        <div
          id="my-cal-inline-macro"
          style={{
            width: '100%',
            'min-height': breakpoint() ? '420px' : '520px',
            overflow: 'hidden',
          }}
        />
      </section>

      <section
        style={{
          display: 'grid',
          'grid-template-columns': breakpoint() ? '1fr' : '1fr 1fr',
          gap: '1px',
          width: '100%',
          'max-width': '600px',
          'box-sizing': 'border-box',
        }}
      >
        <div style={detailCardStyle}>
          <div
            style={{
              'font-family': 'display',
              'font-size': breakpoint() ? '22px' : '26px',
              'line-height': 1.1,
              margin: '0',
              color: 'var(--c1)',
            }}
          >
            Who it is for
          </div>
          <div
            style={{
              'font-size': breakpoint() ? '16px' : '18px',
              'line-height': 1.5,
              color: 'var(--c4)',
            }}
          >
            Pre-seed and seed-stage teams are the best fit. If you're at Series
            A and the product is a strong fit, you should still apply.
          </div>
        </div>
        <div style={detailCardStyle}>
          <div
            style={{
              'font-family': 'display',
              'font-size': breakpoint() ? '22px' : '26px',
              'line-height': 1.1,
              margin: '0',
              color: 'var(--c1)',
            }}
          >
            What you'll get
          </div>
          <div
            style={{
              'font-size': breakpoint() ? '16px' : '18px',
              'line-height': 1.5,
              color: 'var(--c4)',
            }}
          >
            Hands-on help getting started with Macro (or migrating from your
            current tools) and up to $10,000 in credits.
          </div>
        </div>
      </section>
    </div>
  );
};
