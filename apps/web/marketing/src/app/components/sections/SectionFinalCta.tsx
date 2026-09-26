import IconCasa from '../../../assets/designs/design-casa.svg';
import IconIso from '../../../assets/designs/design-iso.svg';
import IconSoc2 from '../../../assets/designs/design-soc2.svg';
import {
  CtaIcon,
  ctaHref,
  ctaLabel,
  demoHref,
  handleCtaClick,
  handleDemoClick,
} from '../../utils/utilCta';
import { LinkBookDemo } from '../buttons/LinkBookDemo';
import { FormMobileSignup } from '../forms/FormMobileSignup';
import { SsgDesktop, SsgMobile } from '../utils/SsgGate';

type SectionFinalCtaProps = {
  /** `button_name` on the desktop "Sign up with Google" click (`app_redirect`). */
  googleButtonName: string;
  /** `button_name` on the desktop "Book demo" click (`demo_booking_open`). */
  demoButtonName: string;
  /** `button_name` on the phone email-capture submit (`mobile_signup_submitted`). */
  mobileButtonName: string;
};

// Viewport-dependent spacing/typography in CSS so the prerender is correct on
// phones before the JS bundle loads. Class names are global; the section is
// rendered at most once per page.
const FINAL_CTA_STYLES = `
  @media (hover) {
    .home-hero-cta:hover {
      transform: scale(1.02);
    }
  }
  .final-cta { align-items: center; gap: 44px; justify-items: center; text-align: center; }
  .final-cta-copy { gap: 16px; justify-items: center; }
  .final-cta-headline { gap: 8px; justify-items: center; }
  .final-cta-headline-main-desktop { font-size: 62px; line-height: 1.15; }
  .final-cta-headline-main-mobile { display: none; font-size: 47px; line-height: 1.15; }
  .final-cta-headline-sub { font-size: 47px; line-height: 1.2; }
  .final-cta-trust { gap: 14px; justify-items: center; }
  .final-cta-badges { gap: 12px; justify-content: center; }
  .final-cta-badge { height: 26px; width: 26px; }
  .final-cta-note { font-size: 14px; text-align: center; }
  @media (max-width: 699px) {
    .final-cta { align-items: start; gap: 36px; justify-items: start; text-align: left; }
    .final-cta-copy { gap: 14px; justify-items: start; }
    .final-cta-headline { gap: 6px; justify-items: start; }
    .final-cta-headline-main-desktop { display: none; }
    .final-cta-headline-main-mobile {
      display: block;
      font-size: clamp(32px, 11.2vw, 47px);
      white-space: nowrap;
    }
    .final-cta-headline-sub { display: none; }
    .final-cta-trust { gap: 12px; justify-items: start; }
    .final-cta-badges { gap: 10px; justify-content: start; }
    .final-cta-badge { height: 22px; width: 22px; }
    .final-cta-note { font-size: 13px; text-align: left; }
  }
`;

/**
 * Closing CTA shared by the homepage, blog pages, and feature pages: the
 * "Start with your inbox" headline, the Google + Book demo pill bar on desktop
 * (inline email capture on phones), and the security badges. Callers own the
 * surrounding padding.
 */
export function SectionFinalCta(props: SectionFinalCtaProps) {
  return (
    <>
      <style>{FINAL_CTA_STYLES}</style>
      <section
        aria-label="Get started"
        class="final-cta"
        style={{
          display: 'grid',
        }}
      >
        <div
          class="final-cta-cta-copy"
          style={{
            display: 'grid',
            'max-width': '720px',
          }}
        >
          <h2
            class="final-cta-cta-headline"
            style={{
              color: 'var(--c0)',
              display: 'grid',
              'font-family': 'display',
              'font-weight': '420',
              'letter-spacing': '-0.015em',
              'line-height': 1.15,
              margin: '0',
            }}
          >
            {/* Both headline variants ship; CSS shows one per viewport. */}
            <span class="final-cta-headline-main-mobile">
              Get started free.
            </span>
            <span class="final-cta-headline-main-desktop">
              Start with your inbox.
            </span>
            <span class="final-cta-headline-sub">Try Macro free today.</span>
          </h2>
        </div>
        <SsgMobile>
          {/* Same inline capture as the hero: on a phone the page's closing CTA
            asks for an email rather than sending the visitor to the app. */}
          <div
            style={{
              'box-sizing': 'border-box',
              display: 'grid',
              gap: '6px',
              'justify-items': 'center',
              width: '100%',
            }}
          >
            <FormMobileSignup buttonName={props.mobileButtonName} />
            <LinkBookDemo buttonName={props.demoButtonName} />
          </div>
        </SsgMobile>
        <SsgDesktop>
          <div
            class="home-hero-cta-bar"
            style={{
              'align-items': 'center',
              'backdrop-filter': 'blur(6px)',
              '-webkit-backdrop-filter': 'blur(6px)',
              'background-color':
                'color-mix(in srgb, var(--b1) 86%, transparent)',
              border:
                '1px solid color-mix(in srgb, var(--b4) 32%, transparent)',
              'border-radius': '999px',
              'box-shadow':
                'inset 0 1px 0 color-mix(in srgb, var(--c1) 6%, transparent), inset 0 -1px 0 color-mix(in srgb, var(--b0) 40%, transparent), 0 14px 32px -22px rgb(0 0 0 / 0.55)',
              'box-sizing': 'border-box',
              display: 'flex',
              gap: '8px',
              'justify-content': 'flex-start',
              overflow: 'hidden',
              padding: '8px',
              position: 'relative',
            }}
          >
            <a
              href={ctaHref()}
              class="home-hero-cta"
              onClick={(event) => handleCtaClick(event, props.googleButtonName)}
              style={{
                'align-items': 'center',
                'background-color': 'var(--a0)',
                border:
                  '1px solid color-mix(in srgb, var(--b4) 32%, transparent)',
                'border-radius': '999px',
                'box-sizing': 'border-box',
                color: 'var(--b0)',
                cursor: 'default',
                display: 'inline-flex',
                'font-family': 'body',
                'font-size': '20px',
                'font-weight': '700',
                gap: '8px',
                height: '40px',
                'justify-content': 'center',
                'letter-spacing': '0.01em',
                'line-height': 1,
                overflow: 'hidden',
                padding: '0 22px',
                'text-decoration': 'none',
                'text-transform': 'uppercase',
                transition: 'transform 160ms ease',
                'white-space': 'nowrap',
              }}
            >
              <CtaIcon size={16} />
              {ctaLabel('Sign up with Google')}
            </a>
            <a
              href={demoHref()}
              class="home-hero-cta"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => handleDemoClick(props.demoButtonName)}
              style={{
                'align-items': 'center',
                'background-color': 'var(--c1)',
                border:
                  '1px solid color-mix(in srgb, var(--b4) 32%, transparent)',
                'border-radius': '999px',
                'box-sizing': 'border-box',
                color: 'var(--b0)',
                cursor: 'default',
                display: 'inline-flex',
                'font-family': 'body',
                'font-size': '20px',
                'font-weight': '700',
                height: '40px',
                'justify-content': 'center',
                'letter-spacing': '0.01em',
                'line-height': 1,
                padding: '0 22px',
                'text-decoration': 'none',
                'text-transform': 'uppercase',
                transition: 'transform 160ms ease',
                'white-space': 'nowrap',
              }}
            >
              Book demo
            </a>
          </div>
        </SsgDesktop>
        <div
          class="final-cta-trust"
          style={{
            display: 'grid',
          }}
        >
          <div
            aria-label="Security certifications"
            class="final-cta-badges"
            style={{
              'align-items': 'center',
              color: 'color-mix(in srgb, var(--c2) 55%, var(--c4))',
              display: 'flex',
              opacity: 0.42,
            }}
          >
            <IconIso
              aria-label="ISO 27001"
              class="final-cta-badge"
              style={{ display: 'block' }}
            />
            <IconSoc2
              aria-label="AICPA SOC 2"
              class="final-cta-badge"
              style={{ display: 'block' }}
            />
            <IconCasa
              aria-label="CASA Tier 2"
              class="final-cta-badge"
              style={{ display: 'block', transform: 'scale(1.02)' }}
            />
          </div>
          <p
            class="final-cta-note"
            style={{
              color: 'color-mix(in srgb, var(--c4) 70%, transparent)',
              'font-family': 'body',
              'font-weight': '500',
              'letter-spacing': '0.01em',
              'line-height': 1.4,
              margin: '0',
              'max-width': '420px',
            }}
          >
            Enterprise-grade security.
            <br />
            SOC 2 Type II certified.
          </p>
        </div>
      </section>
    </>
  );
}
