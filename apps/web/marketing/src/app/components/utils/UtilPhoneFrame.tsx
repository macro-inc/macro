import type { JSX } from 'solid-js';
import IconWifi from '../../../assets/icons/phosphor/wifi-high.svg';
import { viewportWidth } from '../../utils/utilBreakpoint';

// Faux-app chrome uses a neutral UI sans so the mocks read as real product
// screenshots rather than marketing copy.
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const mobile = () => viewportWidth() < 700;

// iOS-style status bar that sits at the top of the faux phone screen.
function PhoneStatusBar(props: { compact: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        display: 'flex',
        'font-family': appFont,
        height: props.compact ? '38px' : '42px',
        'justify-content': 'space-between',
        padding: props.compact ? '0 20px' : '0 24px',
        position: 'relative',
        'z-index': 2,
      }}
    >
      <span
        style={{
          'font-size': '13px',
          'font-weight': '600',
          'letter-spacing': '0.01em',
        }}
      >
        9:41
      </span>
      {/* Dynamic island */}
      <span
        style={{
          'align-items': 'center',
          'background-color': '#000',
          'border-radius': '999px',
          'box-shadow':
            'inset 0 0 0 1px color-mix(in srgb, var(--c1) 12%, transparent)',
          display: 'flex',
          height: props.compact ? '22px' : '25px',
          'justify-content': 'flex-end',
          left: '50%',
          padding: '0 9px',
          position: 'absolute',
          top: props.compact ? '8px' : '9px',
          transform: 'translateX(-50%)',
          width: props.compact ? '80px' : '94px',
        }}
      >
        <span
          style={{
            background: 'color-mix(in srgb, #38507a 80%, #000)',
            'border-radius': '999px',
            'box-shadow': 'inset 0 0 2px rgb(0 0 0 / 0.8)',
            height: '8px',
            width: '8px',
          }}
        />
      </span>
      {/* Wi-Fi · battery */}
      <span
        style={{
          'align-items': 'center',
          color: 'var(--c1)',
          display: 'flex',
          gap: '6px',
        }}
      >
        <IconWifi
          aria-hidden="true"
          style={{
            display: 'block',
            flex: 'none',
            height: '12px',
            width: '12px',
          }}
        />
        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            gap: '1.5px',
          }}
        >
          <span
            style={{
              border:
                '1px solid color-mix(in srgb, var(--c1) 45%, transparent)',
              'border-radius': '3px',
              'box-sizing': 'border-box',
              height: '11px',
              padding: '1.5px',
              width: '23px',
            }}
          >
            <span
              style={{
                background: 'currentColor',
                'border-radius': '1px',
                display: 'block',
                height: '100%',
                width: '72%',
              }}
            />
          </span>
          <span
            style={{
              background: 'color-mix(in srgb, var(--c1) 45%, transparent)',
              'border-radius': '0 1px 1px 0',
              height: '4px',
              width: '1.5px',
            }}
          />
        </span>
      </span>
    </div>
  );
}

// Faux smartphone device frame — wraps a screen's worth of content in a
// rounded titanium-style body with side buttons, a status bar, and a home
// indicator. The screen keeps a fixed height; inner content scrolls.
export function PhoneScreenContent(props: {
  children: JSX.Element;
  zoom?: number;
}) {
  // `zoom` packs more (real-size) content into the same screen height — used
  // by the `small` PhoneFrame variant, where the device shrank but the
  // content didn't. Unlike transform:scale (TURBO_ZOOM elsewhere), `zoom`
  // resolves this element's own percentage width against its unzoomed
  // containing block, so it already fills 100% — no width compensation.
  const zoom = () => props.zoom ?? 1;
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '12px',
        'grid-template-columns': 'minmax(0, 1fr)',
        padding: '14px 14px 18px',
        width: '100%',
        zoom: zoom(),
      }}
    >
      {props.children}
    </div>
  );
}

export function PhoneFrame(props: { children: JSX.Element; small?: boolean }) {
  const compact = () => mobile();
  // The `small` variant renders a physically smaller device (used where the
  // phone is a supporting graphic rather than the hero itself).
  const bezel = () => (props.small ? (compact() ? 6 : 7) : compact() ? 11 : 13);
  const screenHeight = () =>
    props.small ? (compact() ? 500 : 560) : compact() ? 660 : 750;
  const sideButton: JSX.CSSProperties = {
    background:
      'linear-gradient(180deg, color-mix(in srgb, var(--b4) 60%, var(--b2)) 0%, var(--b3) 45%, color-mix(in srgb, var(--b0) 55%, var(--b3)) 100%)',
    'box-shadow': '0 1px 2px rgb(0 0 0 / 0.5)',
    position: 'absolute',
    width: '3px',
    'z-index': 0,
  };
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        'justify-self': 'center',
        position: 'relative',
        width: '100%',
        'max-width': props.small
          ? compact()
            ? '248px'
            : '280px'
          : compact()
            ? '328px'
            : '376px',
      }}
    >
      {/* Side buttons */}
      <span
        aria-hidden="true"
        style={{
          ...sideButton,
          left: '-2px',
          top: '19%',
          height: '24px',
          'border-radius': '3px 0 0 3px',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          ...sideButton,
          left: '-3px',
          top: '28%',
          height: '46px',
          'border-radius': '3px 0 0 3px',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          ...sideButton,
          left: '-3px',
          top: '40%',
          height: '46px',
          'border-radius': '3px 0 0 3px',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          ...sideButton,
          right: '-3px',
          top: '31%',
          height: '70px',
          'border-radius': '0 3px 3px 0',
        }}
      />

      {/* Phone body */}
      <div
        style={{
          background:
            'linear-gradient(145deg, color-mix(in srgb, var(--b4) 60%, var(--b2)) 0%, var(--b2) 16%, var(--b1) 50%, var(--b2) 84%, color-mix(in srgb, var(--b4) 50%, var(--b2)) 100%)',
          'border-radius': props.small
            ? compact()
              ? '36px'
              : '40px'
            : compact()
              ? '48px'
              : '54px',
          'box-shadow':
            '0 44px 100px rgb(0 0 0 / 0.5), 0 12px 30px rgb(0 0 0 / 0.4), inset 0 0 0 1px color-mix(in srgb, var(--c1) 6%, transparent)',
          'box-sizing': 'border-box',
          padding: `${bezel()}px`,
          position: 'relative',
          'z-index': 1,
        }}
      >
        {/* Screen */}
        <div
          style={{
            'background-color': 'var(--b0)',
            'border-radius': props.small
              ? compact()
                ? '30px'
                : '34px'
              : compact()
                ? '38px'
                : '43px',
            'box-shadow':
              'inset 0 0 0 1px color-mix(in srgb, var(--c1) 5%, transparent)',
            'box-sizing': 'border-box',
            display: 'grid',
            'grid-template-rows': 'auto 1fr auto',
            height: `${screenHeight()}px`,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <PhoneStatusBar compact={compact()} />
          <style>{`
            .phone-frame-scroll {
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
            .phone-frame-scroll::-webkit-scrollbar {
              display: none;
            }
          `}</style>
          <div
            class="phone-frame-scroll"
            style={{
              'box-sizing': 'border-box',
              'min-height': '0',
              'overflow-x': 'hidden',
              'overflow-y': 'auto',
              'overscroll-behavior': 'contain',
              width: '100%',
            }}
          >
            {props.children}
          </div>
          {/* Home indicator */}
          <div
            aria-hidden="true"
            style={{
              display: 'flex',
              'justify-content': 'center',
              padding: '4px 0 9px',
            }}
          >
            <span
              style={{
                background: 'color-mix(in srgb, var(--c1) 55%, transparent)',
                'border-radius': '999px',
                height: '4px',
                width: '34%',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
