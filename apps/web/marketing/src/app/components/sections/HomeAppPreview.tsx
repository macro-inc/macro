import { A } from '@solidjs/router';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { featurePages } from '../../data/featurePages';
import { featureNavGlyphs } from '../graphics/FeatureNavGlyphs';
import { APP_PREVIEW_HEIGHT, SceneAppPreview } from './SceneAppPreview';

// Maps each feature strip tile to the matching section inside the app-preview
// hero graphic (SceneAppPreview's left rail). Tiles with a mapping toggle the
// preview in place; the rest (CRM, Pull Requests — no hero section) still
// navigate to their feature page.
const STRIP_HREF_TO_SECTION: Record<string, string> = {
  '/agents': 'agents',
  '/email': 'email',
  '/documents': 'files',
  '/channels': 'channels',
  '/calls': 'calls',
  '/tasks': 'tasks',
};

// The strip shows only the feature pages that toggle a live preview section;
// CRM and Pull Requests have no hero section, so they're left off the bar.
const stripPages = featurePages.filter(
  (page) => STRIP_HREF_TO_SECTION[page.href]
);

function HomeFeatureStrip(props: {
  mobile: () => boolean;
  activeSection: string;
  onSelectSection: (key: string) => void;
}) {
  // Only the feature pages that toggle a live preview section appear here, so
  // every tile is interactive. The bar is always a single row — on small
  // widths the tiles shrink to tab-bar scale rather than wrapping into a tall
  // multi-row grid that dwarfs the mockup.
  const columns = () => stripPages.length;
  const glyphHeight = () => (props.mobile() ? '20px' : '40px');

  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: props.mobile() ? '12px' : '16px',
        'justify-items': 'center',
        width: '100%',
      }}
    >
      <style>{`
        /* Apple "liquid glass" rim: a 1px gradient border (drawn with the
           masked padding-box recipe) that catches light at the top-left and
           bottom-right corners and fades to nothing along the rest of the
           edge, so the bar reads like a polished pane of glass. */
        .home-feature-strip-bar::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(
            135deg,
            color-mix(in srgb, var(--c1) 26%, transparent) 0%,
            transparent 24%,
            transparent 76%,
            color-mix(in srgb, var(--c1) 18%, transparent) 100%
          );
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          pointer-events: none;
        }
        .home-feature-strip-tile {
          appearance: none;
          -webkit-appearance: none;
          color: color-mix(in srgb, var(--c4) 48%, transparent);
          cursor: default;
          font: inherit;
          margin: 0;
          text-decoration: none;
          transition: background-image 200ms ease, box-shadow 200ms ease, color 200ms ease;
        }
        .home-feature-strip-title {
          color: color-mix(in srgb, var(--c2) 78%, transparent);
          transition: color 200ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        /* Sits the line-art cube on a soft contact shadow so every tile reads as
           a solid block resting on the bar rather than a flat outline. */
        .home-feature-strip-glyph {
          filter: drop-shadow(0 2px 2px rgb(0 0 0 / 0.34));
          transform: translateZ(0);
          transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), filter 240ms ease;
        }
        .home-feature-strip-tile[data-active='true'] {
          background-image: linear-gradient(180deg, color-mix(in srgb, var(--b2) 44%, transparent), color-mix(in srgb, var(--b2) 12%, transparent));
          box-shadow: inset 0 1px 0 color-mix(in srgb, var(--c1) 9%, transparent), inset 0 -12px 20px -14px rgb(0 0 0 / 0.6);
          color: var(--a0);
        }
        .home-feature-strip-tile[data-active='true'] .home-feature-strip-title {
          color: var(--c1);
        }
        /* Lift + enlarge the cube toward the viewer and deepen its shadow so the
           selected tile pops out of the bar in 3D. */
        .home-feature-strip-tile[data-active='true'] .home-feature-strip-glyph {
          filter: drop-shadow(0 10px 11px rgb(0 0 0 / 0.52));
          transform: translateY(-5px) scale(1.12);
        }
        @media (hover) {
          .home-feature-strip-tile:hover {
            background-image: linear-gradient(180deg, color-mix(in srgb, var(--b2) 36%, transparent), color-mix(in srgb, var(--b2) 10%, transparent));
            box-shadow: inset 0 1px 0 color-mix(in srgb, var(--c1) 8%, transparent), inset 0 -12px 20px -14px rgb(0 0 0 / 0.52);
            color: var(--a0);
          }
          .home-feature-strip-tile:hover .home-feature-strip-title {
            color: var(--c1);
          }
          .home-feature-strip-tile:hover .home-feature-strip-glyph {
            filter: drop-shadow(0 10px 11px rgb(0 0 0 / 0.52));
            transform: translateY(-5px) scale(1.12);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .home-feature-strip-glyph,
          .home-feature-strip-title {
            transition: none;
          }
        }
      `}</style>
      <div
        class="home-feature-strip-bar"
        style={{
          'backdrop-filter': 'blur(6px)',
          '-webkit-backdrop-filter': 'blur(6px)',
          'background-color': 'color-mix(in srgb, var(--b1) 85%, transparent)',
          border: '1px solid color-mix(in srgb, var(--b4) 16%, transparent)',
          'border-radius': props.mobile() ? '12px' : '20px',
          'box-shadow':
            'inset 0 -1px 0 color-mix(in srgb, var(--b0) 50%, transparent), 0 22px 48px -26px rgb(0 0 0 / 0.7)',
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': `repeat(${columns()}, minmax(0, 1fr))`,
          'max-width': props.mobile() ? '1080px' : '1160px',
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
        }}
      >
        <For each={stripPages}>
          {(page, index) => {
            const Glyph = featureNavGlyphs[page.href];
            const sectionKey = STRIP_HREF_TO_SECTION[page.href];
            const tileStyle = (): JSX.CSSProperties => ({
              'background-color': 'transparent',
              'border-bottom': 'none',
              'border-left':
                index() % columns() !== 0
                  ? '1px solid color-mix(in srgb, var(--b4) 13%, transparent)'
                  : 'none',
              'border-right': 'none',
              'border-top':
                index() >= columns()
                  ? '1px solid color-mix(in srgb, var(--b4) 13%, transparent)'
                  : 'none',
              'box-sizing': 'border-box',
              display: 'grid',
              gap: props.mobile() ? '5px' : '10px',
              'grid-template-rows': 'auto auto',
              'justify-items': 'center',
              padding: props.mobile() ? '9px 3px' : '18px 10px',
              'text-align': 'center',
              width: '100%',
            });
            const tileInner = (
              <>
                <div
                  class="home-feature-strip-glyph"
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    height: glyphHeight(),
                    'justify-content': 'center',
                  }}
                >
                  {Glyph && <Glyph height={glyphHeight()} />}
                </div>
                <span
                  class="home-feature-strip-title"
                  style={{
                    'font-family': 'body',
                    // At six-across on a phone each tile is ~55px wide, so the
                    // label tracks the viewport and eases its letter-spacing to
                    // keep "DOCUMENTS"/"CHANNELS" from overflowing their tile.
                    'font-size': props.mobile()
                      ? 'clamp(7.5px, 2.1vw, 9px)'
                      : '12px',
                    'font-weight': '700',
                    'letter-spacing': props.mobile() ? '0.03em' : '0.07em',
                    'line-height': 1.15,
                    'text-transform': 'uppercase',
                  }}
                >
                  {page.title}
                </span>
              </>
            );
            return (
              <Show
                when={sectionKey}
                fallback={
                  <A
                    href={page.href}
                    class="home-feature-strip-tile"
                    style={tileStyle()}
                  >
                    {tileInner}
                  </A>
                }
              >
                <button
                  type="button"
                  class="home-feature-strip-tile"
                  data-active={
                    props.activeSection === sectionKey ? 'true' : 'false'
                  }
                  aria-pressed={props.activeSection === sectionKey}
                  aria-label={`Show ${page.title} in the product preview`}
                  onClick={() => props.onSelectSection(sectionKey!)}
                  style={tileStyle()}
                >
                  {tileInner}
                </button>
              </Show>
            );
          }}
        </For>
      </div>
    </div>
  );
}

// A small neutral lift behind product previews, over the pure black canvas.
export function HomeHeroBackdrop(props: {
  subtle?: boolean;
  neutral?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: '20% 0 0',
        'pointer-events': 'none',
        'z-index': 0,
        opacity: props.subtle ? 0.3 : 0.5,
        background:
          'radial-gradient(ellipse 45% 35% at 50% 65%, rgb(255 255 255 / 0.025), transparent 100%)',
      }}
    />
  );
}

// The homepage's interactive "app preview" hero: a 3D-tilted, shadowed Macro
// window (SceneAppPreview) floating off the gradient, with the floating glass
// feature strip straddling its bottom edge. Reused on feature pages (e.g. the
// docs hero) via `defaultSection` so they open on the matching app section.
//
// Feature pages opt into a quieter treatment: `showStrip={false}` drops the
// section switcher (it's a single-feature page), `fadeBottom` fades the mock
// out toward the bottom of the hero, and `keepSidebarCollapsed` leaves the
// rail closed.
export function HomeAppPreview(props: {
  mobile: () => boolean;
  defaultSection?: string;
  showStrip?: boolean;
  fadeBottom?: boolean;
  compact?: boolean;
  keepSidebarCollapsed?: boolean;
  // Section keys to drop from the preview's left rail (e.g. the home page).
  excludeSections?: string[];
}) {
  const mobile = props.mobile;
  const showStrip = () => props.showStrip ?? true;
  const fade = () => props.fadeBottom ?? false;
  const compact = () => props.compact ?? false;
  const [activeSection, setActiveSection] = createSignal(
    props.defaultSection ?? 'email'
  );

  return (
    <section
      aria-label="Product preview"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        // Fade the mock inside the hero bounds — never pull it under the next
        // section, so transforms/shadows can't spill past the hero wrapper.
        // Compact mode drops bottom padding so the clipped graphic sits flush
        // against the following section.
        'padding-bottom': compact()
          ? '0'
          : fade()
            ? mobile()
              ? '28px'
              : '40px'
            : mobile()
              ? '24px'
              : '40px',
        // Compact mobile: match the gap above the email field (~42px, including
        // the form's reserved error row).
        'padding-top': compact()
          ? mobile()
            ? '14px'
            : '96px'
          : mobile()
            ? '58px'
            : '96px',
        'padding-inline': mobile() ? '18px' : '24px',
        position: 'relative',
        'min-width': '0',
        'max-width': '100%',
        overflow: 'hidden',
        'z-index': 1,
        width: '100%',
      }}
    >
      <style>{`
        /* Apple "liquid glass" rim (same recipe as the feature strip bar): a 1px
           gradient border drawn with the masked padding-box trick that catches
           light at the top-left and bottom-right corners and fades along the rest
           of the edge, so the mockup frame reads like a polished pane of glass. */
        .hero-mockup-frame::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(
            135deg,
            color-mix(in srgb, var(--c1) 28%, transparent) 0%,
            transparent 24%,
            transparent 76%,
            color-mix(in srgb, var(--c1) 18%, transparent) 100%
          );
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          pointer-events: none;
          z-index: 2;
        }
      `}</style>
      <div
        style={{
          display: 'grid',
          'justify-items': 'center',
          'max-height': compact()
            ? `${(mobile() ? APP_PREVIEW_HEIGHT.mobile : APP_PREVIEW_HEIGHT.desktop) - 50}px`
            : undefined,
          'max-width': 'min(1080px, 100%)',
          'min-width': '0',
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
          'z-index': 1,
        }}
      >
        {/* 3D-tilted, shadowed mockup that floats off the gradient — the depth
            comes from a subtle perspective rotation plus a layered drop shadow
            (Linear-style), replacing the old bottom-fade. When fading, the depth
            moves to a drop-shadow on this wrapper so it follows the mask alpha
            (a masked element would clip its own box-shadow). */}
        <div
          style={{
            'max-width': '100%',
            'min-width': '0',
            overflow: 'hidden',
            perspective: mobile() ? 'none' : '2400px',
            width: '100%',
            ...(fade()
              ? {
                  filter: mobile()
                    ? 'drop-shadow(0 16px 34px rgb(0 0 0 / 0.6))'
                    : 'drop-shadow(0 30px 55px rgb(0 0 0 / 0.5))',
                }
              : {}),
          }}
        >
          <div
            class="hero-mockup-frame"
            style={{
              // No border here: the inner SceneAppPreview mockup already draws
              // its own 1px border at the same radius, and the frame's ::after
              // glass rim supplies the top-left highlight. A border here sat 1px
              // outside the mockup's, producing a non-concentric "double" corner.
              'border-radius': mobile() ? '10px' : '12px',
              'max-width': '100%',
              'min-width': '0',
              overflow: 'hidden',
              position: 'relative',
              transform: mobile() ? 'none' : 'rotateX(3deg)',
              'transform-origin': 'center top',
              'box-shadow': fade()
                ? 'inset 0 1px 0 color-mix(in srgb, var(--c1) 8%, transparent)'
                : mobile()
                  ? '0 18px 40px -22px rgb(0 0 0 / 0.7)'
                  : 'inset 0 1px 0 color-mix(in srgb, var(--c1) 8%, transparent), ' +
                    '0 4px 12px -6px rgb(0 0 0 / 0.4), ' +
                    '0 26px 48px -18px rgb(0 0 0 / 0.55), ' +
                    '0 64px 100px -44px rgb(0 0 0 / 0.7)',
              ...(fade()
                ? {
                    '-webkit-mask-image':
                      'linear-gradient(to bottom, #000 0%, #000 58%, rgba(0, 0, 0, 0.4) 82%, transparent 100%)',
                    'mask-image':
                      'linear-gradient(to bottom, #000 0%, #000 58%, rgba(0, 0, 0, 0.4) 82%, transparent 100%)',
                  }
                : {}),
              'z-index': 1,
            }}
          >
            <SceneAppPreview
              mobile={mobile()}
              active={activeSection()}
              onSelectSection={setActiveSection}
              keepSidebarCollapsed={props.keepSidebarCollapsed}
              excludeSections={props.excludeSections}
            />
          </div>
        </div>
        {/* Section switcher — floating skeuomorphic glass bar that straddles the
            mockup's bottom edge (≈half over the graphic, half hanging below) and
            is a bit wider than the graphic. On mobile the strip stays a single
            compact tab-bar-scale row and sits fully below the mockup with a
            small gap instead of straddling it. */}
        <Show when={showStrip()}>
          <div
            style={{
              'box-sizing': 'border-box',
              'margin-inline': mobile() ? '0' : '-40px',
              'margin-top': mobile() ? '16px' : '0',
              position: 'relative',
              transform: mobile() ? 'none' : 'translateY(-50%)',
              width: mobile() ? '100%' : 'calc(100% + 80px)',
              'z-index': 2,
            }}
          >
            <HomeFeatureStrip
              mobile={mobile}
              activeSection={activeSection()}
              onSelectSection={setActiveSection}
            />
          </div>
        </Show>
      </div>
    </section>
  );
}
