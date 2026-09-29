import { createSignal, Show } from 'solid-js';
import { isServer } from 'solid-js/web';
import markDesyncPlaceholder from '../../../assets/mark-desync-placeholder.jpg';
import { APP_BASE_URL } from '../../utils/utilBaseUrl';
import { breakpoint, viewportWidth } from '../../utils/utilBreakpoint';

const mobile = () => viewportWidth() < 700;
const stacked = () => breakpoint();

const isLocalhost =
  !isServer && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const desyncVideoUrl = isLocalhost
  ? '/video/desync.mp4'
  : new URL('/video/desync.mp4', APP_BASE_URL).toString();

/** Quote + inline Desync case-study player used on Pricing and Partners. */
export function SectionDesyncCaseStudy() {
  let videoRef!: HTMLVideoElement;
  const [playing, setPlaying] = createSignal(false);
  const compact = () => viewportWidth() < 700;

  function handlePlay() {
    videoRef
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }

  return (
    <section
      aria-label="Desync case study video"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div
        style={{
          'align-items': 'center',
          display: 'grid',
          gap: compact() ? '28px' : '48px',
          'grid-template-columns': stacked()
            ? '1fr'
            : 'minmax(0, 0.85fr) minmax(0, 1.15fr)',
          'max-width': '1080px',
          width: '100%',
        }}
      >
        <div style={{ display: 'grid', gap: compact() ? '16px' : '18px' }}>
          <span
            style={{
              color: 'var(--c1)',
              'font-family': 'rajdhani, body',
              'font-size': breakpoint() ? '12px' : '16px',
              'font-weight': '700',
              'letter-spacing': '0.1em',
              'line-height': 1,
              'text-transform': 'uppercase',
            }}
          >
            Case Study
          </span>
          <blockquote
            style={{
              color: 'var(--c1)',
              'font-family': 'display',
              'font-size': compact() ? '28px' : '34px',
              'font-weight': '410',
              'letter-spacing': '-0.01em',
              'line-height': 1.14,
              margin: '0',
              'overflow-wrap': 'break-word',
            }}
          >
            &ldquo;Macro did not help us get organized. Macro<em> is why</em> we
            are organized.&rdquo;
          </blockquote>
          <div
            style={{
              color: 'var(--c4)',
              'font-family': 'rajdhani, body',
              'font-size': compact() ? '13px' : '14px',
              'font-weight': '700',
              'letter-spacing': '0.08em',
              'line-height': 1,
              opacity: 0.8,
              'text-transform': 'uppercase',
            }}
          >
            — Mark Evgenev, Founder/CEO Desync
          </div>
        </div>

        <div style={{ position: 'relative', width: '100%' }}>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: '-38% -30%',
              background:
                'radial-gradient(50% 50% at 50% 50%, color-mix(in srgb, var(--ambient-ink) 11%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 4%, transparent) 42%, transparent 74%)',
              filter: 'blur(56px)',
              'pointer-events': 'none',
              'z-index': 0,
            }}
          />
          <div
            style={{
              'background-color': 'var(--b1)',
              border:
                '1px solid color-mix(in srgb, var(--c1) 12%, transparent)',
              'border-radius': mobile() ? '16px' : '20px',
              'box-shadow':
                '0 34px 80px -24px rgb(0 0 0 / 0.72), 0 10px 30px -14px rgb(0 0 0 / 0.55)',
              cursor: playing() ? 'default' : 'pointer',
              overflow: 'hidden',
              position: 'relative',
              'z-index': 1,
              width: '100%',
            }}
            onClick={() => {
              if (!playing()) handlePlay();
            }}
          >
            <video
              ref={videoRef}
              controls={playing()}
              onEnded={() => setPlaying(false)}
              onError={() => setPlaying(false)}
              playsinline
              poster={markDesyncPlaceholder}
              preload="metadata"
              src={desyncVideoUrl}
              style={{
                'aspect-ratio': compact() ? '1.2 / 1' : '1.78 / 1',
                background: 'var(--b1)',
                display: 'block',
                height: '100%',
                'object-fit': playing() ? 'contain' : 'cover',
                'object-position': 'center center',
                width: '100%',
              }}
            />
            <Show when={!playing()}>
              <img
                src={markDesyncPlaceholder}
                loading="lazy"
                alt=""
                aria-hidden="true"
                style={{
                  display: 'block',
                  filter: 'brightness(0.9)',
                  height: '100%',
                  inset: '0',
                  'object-fit': 'cover',
                  'object-position': 'center center',
                  'pointer-events': 'none',
                  position: 'absolute',
                  width: '100%',
                }}
              />
            </Show>
            <Show when={!playing()}>
              <div
                style={{
                  background:
                    'linear-gradient(0deg, oklch(from var(--b0) l c h / 0.78), oklch(from var(--b0) l c h / 0.12) 52%, transparent 78%)',
                  inset: '0',
                  'pointer-events': 'none',
                  position: 'absolute',
                  'z-index': 1,
                }}
              />
            </Show>
            <Show when={!playing()}>
              <div
                style={{
                  'align-items': 'center',
                  bottom: compact() ? '20px' : '28px',
                  display: 'grid',
                  gap: compact() ? '12px' : '14px',
                  'grid-template-columns': 'min-content min-content 1fr',
                  left: compact() ? '20px' : '28px',
                  'pointer-events': 'none',
                  position: 'absolute',
                  right: compact() ? '20px' : '28px',
                  'z-index': 2,
                }}
              >
                <svg
                  width={compact() ? '38' : '42'}
                  height={compact() ? '38' : '42'}
                  viewBox="0 0 48 48"
                  aria-hidden="true"
                >
                  <circle
                    cx="24"
                    cy="24"
                    r="21"
                    fill="none"
                    stroke="var(--c1)"
                    stroke-width="2"
                  />
                  <path d="M20.5 16.5 L20.5 31.5 L32.5 24 Z" fill="var(--c1)" />
                </svg>
                <div
                  style={{
                    color: 'var(--c1)',
                    'font-family': 'rajdhani, body',
                    'font-size': compact() ? '14px' : '15px',
                    'font-weight': '700',
                    'letter-spacing': '0.1em',
                    'line-height': 1,
                    'text-transform': 'uppercase',
                    'white-space': 'nowrap',
                  }}
                >
                  Watch Video
                </div>
                <div
                  style={{
                    'background-color': 'var(--c1)',
                    height: '1px',
                    'margin-top': '1px',
                    opacity: 0.8,
                    width: '100%',
                  }}
                />
              </div>
            </Show>
          </div>
        </div>
      </div>
    </section>
  );
}
