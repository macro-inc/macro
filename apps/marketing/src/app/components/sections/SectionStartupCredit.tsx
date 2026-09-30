import { onMount } from 'solid-js';
import { buildCalSlugWithAttribution } from '../../utils/utilAnalytic';
import { breakpoint } from '../../utils/utilBreakpoint';

const calThemeVars = {
  'cal-bg': 'oklch(0 0 44)',
  'cal-bg-emphasis': 'oklch(0 0 44)',
  'cal-bg-subtle': 'oklch(0.14 0 44)',
  'cal-bg-muted': 'oklch(0.14 0 44)',
  'cal-bg-inverted': 'oklch(0.9 0 44)',
  'cal-border': 'oklch(0.16 0 44)',
  'cal-border-default': 'oklch(0.16 0 44)',
  'cal-border-emphasis': 'oklch(0.36 0 44)',
  'cal-border-subtle': 'oklch(0.18 0 44)',
  'cal-border-booker': 'oklch(0.16 0 44)',
  'cal-border-booker-width': '1px',
  'cal-brand': 'oklch(0.71 0.23 44)',
  'cal-brand-emphasis': 'oklch(0.78 0.22 44)',
  'cal-brand-text': 'oklch(0 0 44)',
  'cal-text': 'oklch(0.8 0 44)',
  'cal-text-emphasis': 'oklch(0.9 0 44)',
  'cal-text-muted': 'oklch(0.6 0 44)',
  'cal-text-subtle': 'oklch(0.7 0 44)',
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

export function SectionStartupCredit() {
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
        styles: {
          branding: {
            brandColor: 'oklch(0.71 0.23 44)',
          },
        },
        cssVarsPerTheme: {
          light: calThemeVars,
          dark: calThemeVars,
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
    <section
      style={{
        display: 'grid',
        gap: breakpoint() ? '48px' : '40px',
        'padding-top': breakpoint() ? '40px' : '56px',
        'padding-bottom': breakpoint() ? '0' : '96px',
        'border-top': '1px solid var(--b2)',
      }}
    >
      <div
        style={{
          display: 'grid',
          'grid-template-columns': breakpoint()
            ? '1fr'
            : 'minmax(0, 1fr) minmax(0, 600px)',
          gap: breakpoint() ? '48px' : '40px',
          'align-items': 'start',
          width: '100%',
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: breakpoint() ? '20px' : '28px',
            'justify-items': breakpoint() ? 'center' : 'start',
            'text-align': breakpoint() ? 'center' : 'left',
            width: '100%',
            'max-width': breakpoint() ? '600px' : 'min(100%, 560px)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: breakpoint() ? '18px' : '22px',
            }}
          >
            <a
              href="/startups"
              style={{
                'font-size': breakpoint() ? '16px' : '18px',
                'line-height': 1.2,
                color: 'var(--a0)',
                'text-decoration': 'none',
                'font-weight': '400',
                'text-transform': 'uppercase',
                'letter-spacing': '0.045em',
              }}
            >
              Apply by June 1, 2026 &rarr;
            </a>
            <p
              style={{
                'font-family': 'display',
                'font-size': breakpoint() ? '26px' : '30px',
                'line-height': 1.12,
                'max-width': '100%',
                margin: '0',
                color: 'var(--c1)',
                'overflow-wrap': 'break-word',
              }}
            >
              We are offering approved startups up to $10,000 in credits{' '}
              <span
                style={{
                  color: 'var(--c4)',
                  opacity: 0.8,
                  display: 'inline',
                }}
              >
                plus hands-on help getting started.
              </span>
            </p>
            <p
              style={{
                color: 'var(--c4)',
                'font-size': breakpoint() ? '16px' : '17px',
                'line-height': 1.45,
                margin: '0',
              }}
            >
              Criteria: pre-seed or seed startups, 6-month term, up to 10 users.
              Credits are used toward Claude AI and storage spend usage in
              Macro.
            </p>
          </div>
        </div>

        <div
          style={{
            width: '100%',
            'max-width': '600px',
            'justify-self': breakpoint() ? 'center' : 'end',
          }}
        >
          <div
            id="my-cal-inline-macro"
            style={{
              width: '100%',
              'min-height': breakpoint() ? '420px' : '520px',
              'background-color': 'var(--b0)',
              border: '1px solid var(--b2)',
              'box-sizing': 'border-box',
              overflow: 'hidden',
            }}
          />
        </div>
      </div>
    </section>
  );
}
