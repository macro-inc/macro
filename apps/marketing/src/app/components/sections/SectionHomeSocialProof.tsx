import { For, onMount, Show } from 'solid-js';
import IconGithub from '../../../assets/icons/icon-github.svg';
import { viewportWidth } from '../../utils/utilBreakpoint';
import {
  ensureGithubStars,
  formatStarCount,
  githubStars,
} from '../../utils/utilGithubStars';

const MACRO_REPO_URL = 'https://github.com/macro-inc/macro';

// TODO: replace these placeholder wordmarks with real customer logos (SVGs).
const logos = ['Northwind', 'Lumen', 'Vertex', 'Monarch', 'Cascade', 'Helio'];

// TODO: replace with real, attributed customer quotes before publishing.
type Testimonial = {
  quote: string;
  name: string;
  role: string;
  initials: string;
};

const testimonials: Testimonial[] = [
  {
    quote:
      'Macro replaced five tabs and a dozen notifications. My team finally has one place where email, chat, and tasks actually talk to each other.',
    name: 'Alex Rivera',
    role: 'Head of Ops, Northwind',
    initials: 'AR',
  },
  {
    quote:
      'The shared memory is the killer feature. Our agents pick up context from every thread, so nothing has to be re-explained.',
    name: 'Priya Shah',
    role: 'Founder, Lumen',
    initials: 'PS',
  },
  {
    quote:
      'We moved the whole company over in a weekend. It\u2019s the first tool everyone actually kept using afterward.',
    name: 'Daniel Cho',
    role: 'CTO, Vertex',
    initials: 'DC',
  },
];

const proofStyles = `
  .home-proof-card {
    transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1), border-color 260ms ease;
  }
  @media (hover) {
    .home-proof-card:hover {
      transform: translateY(-3px);
      border-color: color-mix(in srgb, var(--b4) 45%, transparent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .home-proof-card { transition: none; }
  }
`;

function StatDivider(props: { vertical: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        'background-color': 'color-mix(in srgb, var(--c4) 16%, transparent)',
        height: props.vertical ? '24px' : '1px',
        width: props.vertical ? '1px' : '32px',
      }}
    />
  );
}

export function SectionHomeSocialProof() {
  const mobile = () => viewportWidth() < 700;
  const stacked = () => viewportWidth() < 820;

  onMount(() => {
    ensureGithubStars();
  });

  return (
    <section
      aria-label="What teams say about Macro"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '36px' : '48px',
        'justify-items': mobile() ? 'start' : 'center',
        width: '100%',
      }}
    >
      <style>{proofStyles}</style>

      {/* Eyebrow */}
      <span
        style={{
          color: 'color-mix(in srgb, var(--c4) 60%, transparent)',
          'font-family': 'rajdhani, body',
          'font-size': mobile() ? '11px' : '12px',
          'font-weight': '700',
          'letter-spacing': '0.14em',
          'text-transform': 'uppercase',
        }}
      >
        Loved by fast-moving teams
      </span>

      {/* Logo row (placeholder wordmarks) */}
      <div
        aria-label="Trusted by teams at"
        style={{
          'align-items': 'center',
          'column-gap': mobile() ? '28px' : '48px',
          display: 'flex',
          'flex-wrap': 'wrap',
          'justify-content': mobile() ? 'flex-start' : 'center',
          'row-gap': '18px',
          width: '100%',
        }}
      >
        <For each={logos}>
          {(logo) => (
            <span
              style={{
                color: 'color-mix(in srgb, var(--c3) 62%, transparent)',
                'font-family': 'display',
                'font-size': mobile() ? '18px' : '21px',
                'font-weight': '500',
                'letter-spacing': '-0.01em',
                'line-height': 1,
                'white-space': 'nowrap',
              }}
            >
              {logo}
            </span>
          )}
        </For>
      </div>

      {/* Testimonials */}
      <div
        style={{
          display: 'grid',
          gap: mobile() ? '16px' : '20px',
          'grid-template-columns': stacked()
            ? '1fr'
            : 'repeat(3, minmax(0, 1fr))',
          width: '100%',
        }}
      >
        <For each={testimonials}>
          {(t) => (
            <figure
              class="home-proof-card"
              style={{
                'align-content': 'start',
                'background-color':
                  'color-mix(in srgb, var(--b1) 90%, var(--b0))',
                border:
                  '1px solid color-mix(in srgb, var(--b4) 26%, transparent)',
                'border-radius': '16px',
                'box-sizing': 'border-box',
                display: 'grid',
                gap: '20px',
                margin: '0',
                padding: mobile() ? '22px' : '26px',
              }}
            >
              <blockquote
                style={{
                  color: 'var(--c2)',
                  'font-family': 'body',
                  'font-size': mobile() ? '16px' : '17px',
                  'font-weight': '400',
                  'line-height': 1.55,
                  margin: '0',
                }}
              >
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  gap: '12px',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    'align-items': 'center',
                    'background-color':
                      'color-mix(in srgb, var(--a0) 16%, transparent)',
                    'border-radius': '999px',
                    color: 'var(--a0)',
                    display: 'inline-flex',
                    flex: 'none',
                    'font-family': 'body',
                    'font-size': '13px',
                    'font-weight': '700',
                    height: '38px',
                    'justify-content': 'center',
                    'letter-spacing': '0.02em',
                    width: '38px',
                  }}
                >
                  {t.initials}
                </span>
                <span style={{ display: 'grid', gap: '3px' }}>
                  <span
                    style={{
                      color: 'var(--c1)',
                      'font-family': 'body',
                      'font-size': '14px',
                      'font-weight': '600',
                      'line-height': 1.2,
                    }}
                  >
                    {t.name}
                  </span>
                  <span
                    style={{
                      color: 'var(--c4)',
                      'font-family': 'body',
                      'font-size': '13px',
                      'font-weight': '400',
                      'line-height': 1.2,
                    }}
                  >
                    {t.role}
                  </span>
                </span>
              </figcaption>
            </figure>
          )}
        </For>
      </div>

      {/* Proof bar — real signals only */}
      <div
        style={{
          'align-items': 'center',
          color: 'var(--c3)',
          display: 'flex',
          'flex-direction': stacked() ? 'column' : 'row',
          'font-family': 'body',
          gap: stacked() ? '14px' : '24px',
          'justify-content': 'center',
        }}
      >
        <a
          href={MACRO_REPO_URL}
          target="_blank"
          rel="noreferrer"
          style={{
            'align-items': 'center',
            color: 'inherit',
            cursor: 'default',
            display: 'inline-flex',
            gap: '9px',
            'text-decoration': 'none',
          }}
        >
          <IconGithub
            aria-hidden="true"
            style={{ display: 'block', height: '17px', width: '17px' }}
          />
          <span style={{ 'font-size': '15px', 'font-weight': '400' }}>
            <Show
              when={githubStars() !== null}
              fallback={<>Open source on GitHub</>}
            >
              <span style={{ color: 'var(--c1)', 'font-weight': '700' }}>
                {formatStarCount(githubStars()!)}
              </span>{' '}
              GitHub stars
            </Show>
          </span>
        </a>

        <StatDivider vertical={!stacked()} />

        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            gap: '9px',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 256 256"
            fill="currentColor"
            aria-hidden="true"
            style={{ color: 'var(--a0)', display: 'block' }}
          >
            <path d="M208,40H48A16,16,0,0,0,32,56v58.78c0,89.61,75.82,119.34,91,124.39a15.53,15.53,0,0,0,10,0c15.2-5.05,91-34.78,91-124.39V56A16,16,0,0,0,208,40Zm-34.34,69.66-48,48a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L120,140.69l42.34-42.35a8,8,0,0,1,11.32,11.32Z" />
          </svg>
          <span style={{ 'font-size': '15px', 'font-weight': '400' }}>
            <span style={{ color: 'var(--c1)', 'font-weight': '700' }}>
              SOC 2
            </span>{' '}
            Type II certified
          </span>
        </span>

        <StatDivider vertical={!stacked()} />

        <span style={{ 'font-size': '15px', 'font-weight': '400' }}>
          <span style={{ color: 'var(--c1)', 'font-weight': '700' }}>
            30 seconds
          </span>{' '}
          to set up
        </span>
      </div>
    </section>
  );
}
