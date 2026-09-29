import { For, type JSX } from 'solid-js';
import { MacroMarkIcon } from './MacroMarkIcon';
import { MODULE_LOGOS } from './moduleLogos';

/**
 * The "<tool> → Macro" switch graphic that heads each migration section.
 *
 * A themed rebuild of the SVGs on docs.macro.com/switch-to-macro, which bake
 * in the docs site's fixed dark palette. Here the tiles, ink, and arrow come
 * from the theme variables, so the graphic follows whichever palette the
 * visitor has picked.
 */

type BrandMark = { label: string; viewBox: string; paths: string[] };

/** Monochrome marks for the tools people migrate from. Notion, Slack, and
 *  Linear reuse the paths already carried by the connector modules. */
export const SWITCH_BRANDS = {
  superhuman: {
    label: 'Superhuman',
    viewBox: '0 0 23 23',
    paths: [
      'M22.3826 6.22157C22.1402 3.17618 19.718 0.759886 16.6746 0.523503C13.2525 0.259071 9.81644 0.261063 6.3944 0.533481C3.34902 0.773957 0.932736 3.19625 0.696353 6.24163C0.431921 9.66367 0.433913 13.0997 0.706346 16.5217C0.948815 19.5671 3.3711 21.9834 6.4145 22.2198C9.83653 22.4843 13.2725 22.4823 16.6946 22.2098C19.74 21.9673 22.1563 19.545 22.3927 16.5018C22.6572 13.0797 22.6552 9.6436 22.3826 6.22157ZM11.5715 3.84741C12.8036 3.84741 13.8014 4.84317 13.8014 6.07133C13.8014 7.29949 12.8036 8.29525 11.5715 8.29525C10.3393 8.29525 9.34159 7.29949 9.34159 6.07133C9.34159 4.84317 10.3393 3.84741 11.5715 3.84741ZM15.779 18.4993H15.781L11.9101 16.3796C11.6997 16.2634 11.4432 16.2634 11.2329 16.3796L7.36202 18.4993C6.73891 18.8399 6.0598 18.1487 6.41838 17.5395L10.9664 9.83397C11.2369 9.37517 11.9041 9.37517 12.1745 9.83397L16.7226 17.5395C17.0812 18.1487 16.4041 18.8399 15.779 18.4993Z',
    ],
  },
  notion: {
    label: 'Notion',
    viewBox: '0 0 24 24',
    paths: MODULE_LOGOS.Notion.paths,
  },
  slack: {
    label: 'Slack',
    viewBox: '0 0 24 24',
    paths: MODULE_LOGOS.Slack.paths,
  },
  linear: {
    label: 'Linear',
    viewBox: '0 0 24 24',
    paths: MODULE_LOGOS.Linear.paths,
  },
  // Same path the versus posts' ComparisonTable uses (PostComparison.tsx).
  clickup: {
    label: 'ClickUp',
    viewBox: '0 0 24 24',
    paths: [
      'M2 18.439l3.69-2.828c1.961 2.56 4.044 3.739 6.363 3.739 2.307 0 4.33-1.166 6.203-3.704L22 18.405C19.298 22.065 15.941 24 12.053 24 8.178 24 4.788 22.078 2 18.439zM12.036 5.612l-6.58 5.666-3.098-3.598L12.05 0l9.634 7.688-3.11 3.588z',
    ],
  },
} satisfies Record<string, BrandMark>;

export type SwitchBrand = keyof typeof SWITCH_BRANDS;

/** Compact monochrome mark for controls that identify one migration source. */
export function SwitchBrandIcon(props: { brand: SwitchBrand; size?: number }) {
  const brand = () => SWITCH_BRANDS[props.brand];
  const size = () => props.size ?? 16;

  return (
    <svg
      viewBox={brand().viewBox}
      fill="currentColor"
      aria-hidden="true"
      style={{
        display: 'block',
        flex: 'none',
        height: `${size()}px`,
        width: `${size()}px`,
      }}
    >
      <For each={brand().paths}>{(d) => <path d={d} />}</For>
    </svg>
  );
}

const tileStyle = (size: number): JSX.CSSProperties => ({
  'align-items': 'center',
  'background-color': 'var(--b1)',
  border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
  'border-radius': `${Math.round(size * 0.23)}px`,
  'box-sizing': 'border-box',
  display: 'flex',
  flex: 'none',
  height: `${size}px`,
  'justify-content': 'center',
  width: `${size}px`,
});

const captionStyle: JSX.CSSProperties = {
  color: 'var(--c4)',
  'font-family': 'rajdhani, body',
  'font-size': '12px',
  'font-weight': '600',
  'letter-spacing': '0.08em',
  'text-transform': 'uppercase',
};

/**
 * Side-by-side tiles — the tool you are coming from, an accent arrow, then
 * Macro — sized by `compact` (mobile) rather than a media query, so it matches
 * the rest of the page's `mobile()` breakpoint.
 */
export function SwitchGraphic(props: {
  brand: SwitchBrand;
  compact?: boolean;
}) {
  const brand = () => SWITCH_BRANDS[props.brand];
  const size = () => (props.compact ? 88 : 116);
  const glyph = () => Math.round(size() * 0.4);

  return (
    <div
      aria-label={`${brand().label} to Macro`}
      role="img"
      style={{
        'align-items': 'flex-start',
        display: 'flex',
        gap: props.compact ? '18px' : '28px',
        'justify-content': 'flex-start',
      }}
    >
      <div style={{ display: 'grid', gap: '10px', 'justify-items': 'center' }}>
        <div style={tileStyle(size())}>
          <svg
            viewBox={brand().viewBox}
            fill="var(--c2)"
            aria-hidden="true"
            style={{
              display: 'block',
              height: `${glyph()}px`,
              width: `${glyph()}px`,
            }}
          >
            <For each={brand().paths}>{(d) => <path d={d} />}</For>
          </svg>
        </div>
        <span style={captionStyle}>{brand().label}</span>
      </div>

      <svg
        viewBox="0 0 56 24"
        aria-hidden="true"
        style={{
          display: 'block',
          flex: 'none',
          'margin-top': `${Math.round(size() / 2) - 12}px`,
          width: props.compact ? '34px' : '48px',
        }}
      >
        <path d="M0 10h38V2l16 10-16 10v-8H0z" fill="var(--a0)" />
      </svg>

      <div style={{ display: 'grid', gap: '10px', 'justify-items': 'center' }}>
        <div
          style={{
            ...tileStyle(size()),
            'border-color': 'color-mix(in srgb, var(--a0) 34%, transparent)',
          }}
        >
          <MacroMarkIcon
            style={{
              color: 'var(--a0)',
              display: 'block',
              fill: 'currentColor',
              height: `${Math.round(glyph() * 0.66)}px`,
              stroke: 'none',
            }}
          />
        </div>
        <span style={{ ...captionStyle, color: 'var(--a0)' }}>Macro</span>
      </div>
    </div>
  );
}
