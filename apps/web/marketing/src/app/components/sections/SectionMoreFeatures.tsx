import { A } from '@solidjs/router';
import { type Component, For, type JSX, Show } from 'solid-js';
import IconGithub from '../../../assets/icons/icon-github.svg';
import IconInstagram from '../../../assets/icons/icon-instagram.svg';
import IconLinkedin from '../../../assets/icons/icon-linkedin.svg';
import IconTwitter from '../../../assets/icons/icon-twitter.svg';
import { featurePages } from '../../data/featurePages';
import { demoHref, handleDemoClick } from '../../utils/utilCta';
import { featureNavGlyphs } from '../graphics/FeatureNavGlyphs';
import { HomeSectionRule } from './HomeSectionRule';

type IconComponent = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

// Footer links that aren't already in the header (Pricing, Blog, GitHub,
// Videos live in the header, so they're intentionally dropped here).
const secondaryLinks: {
  title: string;
  href: string;
  external?: boolean;
  onClick?: () => void;
}[] = [
  {
    title: 'Book Demo',
    href: demoHref(),
    external: true,
    onClick: () => handleDemoClick('footer_book_demo'),
  },
  { title: 'Switch to Macro', href: '/migrate' },
  { title: 'Jobs', href: '/jobs' },
  { title: 'Partners', href: '/partners' },
  { title: 'Terms', href: '/terms' },
  { title: 'Privacy', href: '/privacy' },
  { title: 'DPA', href: '/dpa' },
];

const socials: { title: string; Icon: IconComponent; href: string }[] = [
  { title: 'X', Icon: IconTwitter, href: 'https://x.com/macrodotcom' },
  {
    title: 'GitHub',
    Icon: IconGithub,
    href: 'https://github.com/macro-inc/macro',
  },
  {
    title: 'LinkedIn',
    Icon: IconLinkedin,
    href: 'https://www.linkedin.com/company/macrocom',
  },
  {
    title: 'Instagram',
    Icon: IconInstagram,
    href: 'https://www.instagram.com/macrodotcom/',
  },
];

const year = new Date().getFullYear();

// Cross-links to the other feature pages plus the (former footer) site links,
// shown as isometric line-art tiles that match the home page figures. Designed
// to be nested inside a page's final "Get started" CTA.
export function SectionMoreFeatures(props: {
  currentPath?: string;
  maxWidth?: string;
  footerOnly?: boolean;
}) {
  // Always show the full set of feature blocks (a clean 2x4 grid). The current
  // page is intentionally included so the grid never goes lopsided.
  const items = () => featurePages;

  return (
    <>
      <HomeSectionRule />
      <div
        class="more-features-root"
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          'justify-items': 'center',
          position: 'relative',
          width: '100%',
          'z-index': 1,
        }}
      >
        <style>{`
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           build-time prerender paints correctly on phones before the JS
           bundle loads. */
        .more-features-root {
          gap: 18px;
          padding-top: 48px;
        }
        .more-features-kicker { font-size: 13px; }
        .more-features-grid {
          border-radius: 20px;
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        .more-features-glyph-frame { height: 64px; }
        .more-features-tile-title { font-size: 14px; }
        .more-features-socials {
          gap: 28px;
          margin-top: 16px;
        }
        .more-features-social-icon { height: 25px; width: 25px; }
        .more-features-copyright {
          font-size: 13px;
          margin: 8px 0 0;
        }
        .more-features-legal { font-size: 13px; }
        @media (max-width: 699px) {
          .more-features-root { gap: 14px; padding-top: 40px; }
          .more-features-kicker { font-size: 11px; }
          .more-features-grid { border-radius: 16px; }
          .more-features-glyph-frame { height: 54px; }
          .more-features-tile-title { font-size: 13px; }
          .more-features-socials { gap: 24px; margin-top: 10px; }
          .more-features-social-icon { height: 23px; width: 23px; }
          .more-features-copyright { font-size: 12px; margin: 6px 0 0; }
          .more-features-legal { font-size: 12px; }
        }

        /* The tile grid drops from four columns to two below 920px, and the
           inner hairline borders (left edge of every column but the first,
           top edge of every row but the first) follow the column count. */
        .more-features-tile {
          gap: 18px;
          padding: 28px 22px;
        }
        .more-features-grid .more-features-tile:not(:nth-child(4n + 1)) {
          border-left: 1px solid color-mix(in srgb, var(--b4) 14%, transparent);
        }
        .more-features-grid .more-features-tile:nth-child(n + 5) {
          border-top: 1px solid color-mix(in srgb, var(--b4) 14%, transparent);
        }
        @media (max-width: 919px) {
          .more-features-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .more-features-grid .more-features-tile:not(:nth-child(4n + 1)) { border-left: none; }
          .more-features-grid .more-features-tile:nth-child(n + 5) { border-top: none; }
          .more-features-grid .more-features-tile:not(:nth-child(2n + 1)) {
            border-left: 1px solid color-mix(in srgb, var(--b4) 14%, transparent);
          }
          .more-features-grid .more-features-tile:nth-child(n + 3) {
            border-top: 1px solid color-mix(in srgb, var(--b4) 14%, transparent);
          }
        }
        @media (max-width: 699px) {
          .more-features-tile { gap: 14px; padding: 22px 14px; }
        }
        .more-features-tile {
          color: color-mix(in srgb, var(--c4) 52%, transparent);
          text-decoration: none;
          transition: background-color 160ms ease, color 160ms ease;
        }
        .more-features-tile-title {
          color: var(--c2);
          transition: color 160ms ease;
        }
        @media (hover) {
          .more-features-tile:hover {
            background-color: color-mix(in srgb, var(--b2) 26%, transparent);
            color: var(--a0);
          }
          .more-features-tile:hover .more-features-tile-title {
            color: var(--c1);
          }
        }
        .more-features-social {
          transition: color 160ms ease;
        }
        @media (hover) {
          .more-features-social:hover {
            color: var(--c1);
          }
        }
        .more-features-legal a {
          color: inherit;
          text-decoration: none;
          transition: color 160ms ease;
        }
        @media (hover) {
          .more-features-legal a:hover {
            color: var(--c2);
          }
        }
      `}</style>

        <Show when={!props.footerOnly}>
          <span
            class="more-features-kicker"
            style={{
              color: 'var(--c4)',
              'font-family': 'rajdhani, body',
              'font-weight': '700',
              'letter-spacing': '0.08em',
              opacity: 0.55,
              'text-align': 'center',
              'text-transform': 'uppercase',
            }}
          >
            Or keep exploring...
          </span>

          <div
            class="more-features-grid"
            style={{
              border:
                '1px solid color-mix(in srgb, var(--b4) 18%, transparent)',
              'box-sizing': 'border-box',
              display: 'grid',
              'margin-bottom': '30px',
              'max-width': '960px',
              overflow: 'hidden',
              width: '100%',
            }}
          >
            <For each={items()}>
              {(page) => {
                const Glyph = featureNavGlyphs[page.href];
                return (
                  <A
                    href={page.href}
                    class="more-features-tile"
                    style={{
                      'box-sizing': 'border-box',
                      display: 'grid',
                      'grid-template-rows': 'auto auto',
                      'justify-items': 'center',
                      'text-align': 'center',
                    }}
                  >
                    <div
                      class="more-features-glyph-frame"
                      style={{
                        'align-items': 'center',
                        display: 'flex',
                        'justify-content': 'center',
                      }}
                    >
                      {Glyph && <Glyph height="100%" />}
                    </div>
                    <span
                      class="more-features-tile-title"
                      style={{
                        'font-family': 'body',
                        'font-weight': '700',
                        'letter-spacing': '0.07em',
                        'line-height': 1.2,
                        'text-transform': 'uppercase',
                      }}
                    >
                      {page.title}
                    </span>
                  </A>
                );
              }}
            </For>
          </div>
        </Show>

        <div
          class="more-features-socials"
          style={{
            'align-items': 'center',
            display: 'flex',
            'justify-content': 'center',
            // In footer-only mode the socials are the first element under the
            // divider, so drop the extra top margin to keep the gap above the
            // socials equal to the gap below the legal links (equidistant).
            // Otherwise the class supplies the responsive margin.
            'margin-top': props.footerOnly ? '0' : undefined,
          }}
        >
          <For each={socials}>
            {(social) => (
              <a
                href={social.href}
                target="_blank"
                rel="noreferrer"
                aria-label={social.title}
                class="more-features-social"
                style={{ color: 'var(--c4)', display: 'inline-flex' }}
              >
                <social.Icon
                  class="more-features-social-icon"
                  style={{ display: 'block' }}
                />
              </a>
            )}
          </For>
        </div>

        <p
          class="more-features-copyright"
          style={{
            color: 'color-mix(in srgb, var(--c4) 78%, transparent)',
            'font-family': 'body',
            'font-weight': '400',
            'letter-spacing': '0.02em',
            'text-align': 'center',
          }}
        >
          &copy; {year} Macro. All rights reserved.
        </p>

        <p
          class="more-features-legal"
          style={{
            color: 'color-mix(in srgb, var(--c4) 52%, transparent)',
            'font-family': 'body',
            'font-weight': '400',
            'letter-spacing': '0.02em',
            margin: '2px 0 0',
            'text-align': 'center',
          }}
        >
          <For each={secondaryLinks}>
            {(link, index) => (
              <>
                {index() > 0 && <span aria-hidden="true">{' · '}</span>}
                <Show
                  when={link.external}
                  fallback={<A href={link.href}>{link.title}</A>}
                >
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={link.onClick}
                  >
                    {link.title}
                  </a>
                </Show>
              </>
            )}
          </For>
        </p>
      </div>
    </>
  );
}
