import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { isServer } from 'solid-js/web';
import markDesyncPlaceholder from '../../assets/mark-desync-placeholder.jpg';
import { SavingsCalculator } from '../../features/marketing/components/pricing/SavingsCalculator';
import { HomeSectionRule } from '../components/sections/HomeSectionRule';
import { SectionFinalCta } from '../components/sections/SectionFinalCta';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { APP_BASE_URL } from '../utils/utilBaseUrl';
import { breakpoint, viewportWidth } from '../utils/utilBreakpoint';
import { ctaHref, handleCtaClick } from '../utils/utilCta';
import { setPageSeo } from '../utils/utilSeo';

const mobile = () => viewportWidth() < 700;
const stacked = () => breakpoint();
// Plan cards collapse to a single column before the global breakpoint.
const narrow = () => viewportWidth() < 1000;

// Prerendering has no window; bake the production URL into the static HTML.
const isLocalhost =
  !isServer && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const desyncVideoUrl = isLocalhost
  ? '/video/desync.mp4'
  : new URL('/video/desync.mp4', APP_BASE_URL).toString();

// Hairlines that match the home page's section rules instead of bento borders.
const RULE = 'color-mix(in srgb, var(--c4) 9%, transparent)';
const RULE_STRONG = 'color-mix(in srgb, var(--c4) 15%, transparent)';
const CARD_BORDER = 'color-mix(in srgb, var(--b4) 20%, transparent)';

function planEyebrowStyle(): JSX.CSSProperties {
  return {
    color: 'var(--c1)',
    'font-family': 'Inter, body',
    'font-size': breakpoint() ? '12px' : '16px',
    'font-weight': '700',
    'letter-spacing': '0.1em',
    'line-height': 1,
    'text-transform': 'uppercase',
  };
}

function eyebrowStyle(): JSX.CSSProperties {
  return {
    color: 'var(--c1)',
    'font-family': 'Inter, body',
    'font-size': breakpoint() ? '12px' : '16px',
    'font-weight': '700',
    'letter-spacing': '0.1em',
    'line-height': 1,
    'text-transform': 'uppercase',
  };
}

function sectionHeadingStyle(): JSX.CSSProperties {
  return {
    color: 'var(--c1)',
    'font-family': 'display',
    'font-size': mobile() ? '32px' : breakpoint() ? '38px' : '44px',
    'font-weight': '315',
    'letter-spacing': '-0.015em',
    'line-height': 1.1,
    margin: 0,
  };
}

function PlanCard(props: {
  accent?: boolean;
  eyebrow: string;
  price: string;
  primaryLine: string;
  secondaryLine?: string;
  note: JSX.Element;
  buttonName: string;
  buttonLabel?: string;
}) {
  return (
    <section
      style={{
        'background-color': 'var(--b0)',
        'background-image': props.accent
          ? 'radial-gradient(120% 88% at 50% 0%, color-mix(in srgb, var(--ambient-ink) 7%, transparent) 0%, transparent 55%)'
          : undefined,
        border: props.accent
          ? '1px solid color-mix(in srgb, var(--c1) 13%, transparent)'
          : `1px solid ${CARD_BORDER}`,
        'border-radius': mobile() ? '18px' : '20px',
        'box-shadow': props.accent
          ? '0 4px 12px -10px var(--shadow-ink-lg)'
          : undefined,
        'box-sizing': 'border-box',
        display: 'flex',
        'flex-direction': 'column',
        gap: mobile() ? '28px' : '32px',
        padding: mobile() ? '34px 26px' : '40px 32px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flex: '1',
          'flex-direction': 'column',
          gap: mobile() ? '22px' : '24px',
        }}
      >
        <span style={planEyebrowStyle()}>{props.eyebrow}</span>
        <div
          style={{
            'align-items': 'baseline',
            display: 'flex',
            'flex-wrap': 'wrap',
            gap: '10px',
          }}
        >
          <span
            style={{
              color: 'var(--c0)',
              'font-family': 'display',
              'font-size': mobile() ? '48px' : '52px',
              'font-weight': '315',
              'letter-spacing': '-0.015em',
              'line-height': 1,
            }}
          >
            {props.price}
          </span>
          <div style={{ display: 'grid', 'min-width': 0 }}>
            <span
              style={{
                color: 'var(--c1)',
                'font-size': '15px',
                'font-weight': '700',
                'line-height': 1.4,
              }}
            >
              {props.primaryLine}
            </span>
            <Show when={props.secondaryLine}>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-size': '15px',
                  'line-height': 1.4,
                }}
              >
                {props.secondaryLine}
              </span>
            </Show>
          </div>
        </div>
        <p
          style={{
            color: 'var(--c4)',
            'font-size': mobile() ? '15px' : '16px',
            'line-height': 1.55,
            margin: 0,
          }}
        >
          {props.note}
        </p>
      </div>
      <div style={{ display: 'flex' }}>
        <a
          href={ctaHref()}
          class="pricing-cta-button"
          onClick={(event) => handleCtaClick(event, props.buttonName)}
          style={{
            'align-items': 'center',
            'background-color': props.accent ? 'var(--c0)' : 'transparent',
            border: props.accent
              ? '1px solid transparent'
              : `1px solid ${RULE_STRONG}`,
            'border-radius': '999px',
            'box-sizing': 'border-box',
            color: props.accent ? 'var(--b0)' : 'var(--c1)',
            cursor: 'default',
            display: 'inline-flex',
            'font-family': 'body',
            'font-size': '15px',
            'font-weight': '700',
            gap: '8px',
            height: '46px',
            'justify-content': 'center',
            'letter-spacing': '0.045em',
            'line-height': 1,
            padding: '0 24px',
            'text-decoration': 'none',
            'text-transform': 'uppercase',
            transition: 'transform 160ms ease',
            'white-space': 'nowrap',
            width: '100%',
          }}
        >
          {props.buttonLabel ?? 'Get started'}
        </a>
      </div>
    </section>
  );
}

function PricingPlans() {
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        margin: '0 auto',
        'max-width': narrow() ? '560px' : '1100px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: mobile() ? '16px' : '20px',
          'grid-template-columns': narrow()
            ? 'minmax(0, 1fr)'
            : 'repeat(3, minmax(0, 1fr))',
        }}
      >
        <PlanCard
          eyebrow="Free"
          price="$0"
          primaryLine="per seat / month"
          secondaryLine="no credit card required"
          note={
            <>
              <strong>Get started with limited usage:</strong> Haiku, up to two
              email accounts, 5 GB of storage, and a "Sent with Macro" footer.
            </>
          }
          buttonName="pricing_free_connect_google"
          buttonLabel="Start for free"
        />
        <PlanCard
          accent
          eyebrow="Pro"
          price="$40"
          primaryLine="per seat / month"
          secondaryLine="30 days free"
          note={
            <>
              <strong>Your whole workspace:</strong> every AI model with
              standard usage, unlimited email accounts, calls, teams, and 1 TB
              of storage.
            </>
          }
          buttonName="pricing_paid_connect_google"
        />
        <PlanCard
          eyebrow="Max"
          price="$200"
          primaryLine="per seat / month"
          secondaryLine="10× Pro usage"
          note={
            <>
              <strong>Everything in Pro,</strong> with 10× the AI usage for
              heavy agent work, plus priority support.
            </>
          }
          buttonName="pricing_max_connect_google"
        />
      </div>
    </div>
  );
}

type CellValue = boolean | string;

const comparisonGroups: Array<{
  group: string;
  rows: Array<{
    label: string;
    free: CellValue;
    pro: CellValue;
    max: CellValue;
  }>;
}> = [
  {
    group: 'AI and agents',
    rows: [
      { label: 'AI usage', free: 'Limited', pro: 'Standard', max: '10× Pro' },
      { label: 'AI models', free: 'Haiku', pro: 'All', max: 'All' },
      {
        label: 'Agents with workspace context',
        free: true,
        pro: true,
        max: true,
      },
    ],
  },
  {
    group: 'Workspace',
    rows: [
      {
        label: 'Connected email accounts',
        free: 'Up to 2',
        pro: 'Unlimited',
        max: 'Unlimited',
      },
      { label: 'Storage', free: '5 GB', pro: '1 TB', max: '1 TB' },
      {
        label: 'Calls, recording, and transcription',
        free: false,
        pro: true,
        max: true,
      },
    ],
  },
  {
    group: 'Branding and teams',
    rows: [
      {
        label: '"Sent with Macro" email footer',
        free: 'Added',
        pro: 'Removed',
        max: 'Removed',
      },
      {
        label: 'Auto-shared email and CRM for your team',
        free: false,
        pro: true,
        max: true,
      },
      {
        label: 'Team-level memory for your agents',
        free: false,
        pro: true,
        max: true,
      },
      {
        label: 'Channel-based sharing and access control',
        free: false,
        pro: true,
        max: true,
      },
      { label: 'Priority support', free: false, pro: false, max: true },
    ],
  },
];

const comparisonPlans = [
  { key: 'free', name: 'Free', price: '$0' },
  { key: 'pro', name: 'Pro', price: '$40 / seat' },
  { key: 'max', name: 'Max', price: '$200 / seat' },
] as const;

function CheckMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-label="Included"
      style={{ color: 'var(--c1)' }}
    >
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M4 12.5l5 5L20 6"
      />
    </svg>
  );
}

function DashMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-label="Not included"
      style={{ color: 'color-mix(in srgb, var(--c4) 50%, transparent)' }}
    >
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        d="M6 12h12"
      />
    </svg>
  );
}

function ComparisonCell(props: { value: CellValue }) {
  return (
    <Show
      when={typeof props.value === 'string'}
      fallback={props.value ? <CheckMark /> : <DashMark />}
    >
      <span
        style={{
          color: 'var(--c2)',
          'font-family': 'Inter, body',
          'font-size': mobile() ? '12px' : '14px',
          'font-weight': '600',
          'text-align': 'center',
        }}
      >
        {props.value as string}
      </span>
    </Show>
  );
}

function comparisonPlanHeadingStyle(color: string): JSX.CSSProperties {
  return {
    color: color,
    'font-family': 'Inter, body',
    'font-size': mobile() ? '12px' : '14px',
    'font-weight': '700',
    'letter-spacing': '0.1em',
    'line-height': 1,
    'text-transform': 'uppercase',
  };
}

function ComparisonGrid() {
  const cols = () =>
    mobile() ? '1fr 64px 64px 64px' : '1fr 140px 140px 140px';

  return (
    <section
      aria-label="Free, Pro, and Max plan comparison"
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
          'box-sizing': 'border-box',
          'max-width': '1100px',
          'padding-left': mobile() ? '12px' : '40px',
          width: '100%',
        }}
      >
        <div
          style={{
            'align-items': 'end',
            'border-bottom': `1px solid ${RULE_STRONG}`,
            display: 'grid',
            gap: mobile() ? '8px' : '16px',
            'grid-template-columns': cols(),
            padding: mobile() ? '0 4px 16px' : '0 8px 20px',
          }}
        >
          <div aria-hidden="true" />
          <For each={comparisonPlans}>
            {(plan) => (
              <div style={{ 'text-align': 'center' }}>
                <div style={comparisonPlanHeadingStyle('var(--c1)')}>
                  {plan.name}
                </div>
                <div
                  style={{
                    color: 'var(--c4)',
                    'font-size': mobile() ? '11px' : '13px',
                    'margin-top': '4px',
                  }}
                >
                  {plan.price}
                </div>
              </div>
            )}
          </For>
        </div>

        <For each={comparisonGroups}>
          {(group) => (
            <>
              <div
                style={{
                  ...eyebrowStyle(),
                  'border-bottom': `1px solid ${RULE}`,
                  color: 'color-mix(in srgb, var(--c4) 70%, transparent)',
                  'font-size': mobile() ? '12px' : '13px',
                  padding: mobile() ? '20px 4px 12px' : '24px 8px 14px',
                }}
              >
                {group.group}
              </div>
              <For each={group.rows}>
                {(row, index) => (
                  <div
                    style={{
                      'align-items': 'center',
                      'border-bottom':
                        index() === group.rows.length - 1
                          ? '0'
                          : `1px solid ${RULE}`,
                      display: 'grid',
                      gap: mobile() ? '8px' : '16px',
                      'grid-template-columns': cols(),
                      padding: mobile() ? '14px 4px' : '16px 8px',
                    }}
                  >
                    <div
                      style={{
                        color: 'var(--c2)',
                        'font-size': mobile() ? '14px' : '16px',
                        'line-height': 1.4,
                      }}
                    >
                      {row.label}
                    </div>
                    <For each={comparisonPlans}>
                      {(plan) => (
                        <div
                          style={{ display: 'grid', 'place-items': 'center' }}
                        >
                          <ComparisonCell value={row[plan.key]} />
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </section>
  );
}

function CaseStudyVideo() {
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
          <span style={eyebrowStyle()}>Case Study</span>
          <blockquote
            style={{
              color: 'var(--c1)',
              'font-family': 'display',
              'font-size': compact() ? '28px' : '34px',
              'font-weight': '315',
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
              'font-family': 'Inter, body',
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
          {/* Large, diffuse white glow pooled behind the card — sits under the
            card's own black drop shadow for depth. */}
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
                    'font-family': 'Inter, body',
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

const faqItems: Array<{ q: string; a: JSX.Element }> = [
  {
    q: "What's the main purpose of Macro?",
    a: (
      <>
        Macro combines email, chat, documents, tasks, calls, and agents. Read
        them in one inbox, search across the workspace, and use agents to edit
        documents, draft replies, and update tasks. Documents use CRDTs for live
        collaboration and offline sync.
      </>
    ),
  },
  {
    q: 'How does Macro compare to Notion?',
    a: (
      <>
        Macro is a replacement for Notion. Notion is built on markdown and
        databases; Macro has purpose-built modules for each job, plus native
        email, messaging, and file storage. You can still{' '}
        <a href="https://docs.macro.com/faq" target="_blank" rel="noreferrer">
          connect Notion via MCP
        </a>{' '}
        and ask a Macro agent to import your docs. See our{' '}
        <a href="https://youtu.be/hyU1XYmxkYM" target="_blank" rel="noreferrer">
          comparison video
        </a>
        .
      </>
    ),
  },
  {
    q: 'How does Macro compare to Superhuman?',
    a: (
      <>
        Macro Mail uses familiar J / K / E shortcuts, combines your email
        accounts in one inbox, and shares that inbox with messages, @mentions,
        tasks, and agent responses. Agents can search indexed email, draft
        replies, and share threads with your team.
      </>
    ),
  },
  {
    q: 'How does Macro compare to Slack?',
    a: (
      <>
        Macro Chat shows replies inline and treats conversations as inbox items
        you can mark done. When you can share a document or email thread,
        @mentioning it in a channel grants access to that channel. Agents
        participate in channels and can read the referenced work.
      </>
    ),
  },
  {
    q: 'Does Macro have its own email or integrate with my email?',
    a: (
      <>
        Macro Mail is an email client, not an email server. We integrate with
        your existing Google Workspace or Gmail account. Outlook and custom
        IMAP/SMTP are a popular request and are coming soon.
      </>
    ),
  },
  {
    q: 'Can I self-host Macro?',
    a: (
      <>
        Yes, under our AGPL license, though the hosted version is our primary
        focus today. The hosted version has the iOS app, Apple/Google/GitHub
        approvals, runs on AWS, and maintains a SOC 2 Type II audit. For HIPAA,
        FedRAMP, or other needs, contact{' '}
        <a href="mailto:self-host@macro.com">self-host@macro.com</a>.
      </>
    ),
  },
  {
    q: 'Is Macro fully open source? What is the license?',
    a: (
      <>
        Yes — fully open source, not "open core". As of May 31 2026 we moved
        from BSL to the AGPLv3, a copyleft license, meaning derivative works
        must also be open source. To build on Macro under a different (e.g.
        closed-source) license, contact{' '}
        <a href="mailto:licensing@macro.com">licensing@macro.com</a>.
      </>
    ),
  },
  {
    q: 'How do you make money if Macro is open source?',
    a: (
      <>
        From our hosted version, like any other SaaS or AI product, and from
        those who build on top of Macro and prefer a license other than the
        AGPLv3.
      </>
    ),
  },
  {
    q: 'How do teams work in Macro? Do I need a team?',
    a: (
      <>
        Macro works great solo or as a team, and pricing is the same either way.
        Teams share email, tasks, documents, and calls through workspace
        permissions. Agents can search and read the work you have access to, and
        use memory built from your workspace activity. Team subscriptions
        require a paid seat for every member, and each seat can be Pro or Max.
      </>
    ),
  },
  {
    q: 'What happens if I hit my AI usage limit?',
    a: (
      <>
        Every plan includes a monthly amount of AI usage. Free has a limited
        allowance for trying Macro, Pro covers standard everyday use, and Max
        includes 10× Pro's usage for heavy agent work. If you reach your limit,
        upgrade from billing settings: Free to Pro, or Pro to Max.
      </>
    ),
  },
  {
    q: 'How do you use my data?',
    a: (
      <>
        Workspace access follows your sharing permissions. For details on data
        collection, processing, retention, and AI handling, see our{' '}
        <a href="/privacy">privacy policy</a> and{' '}
        <a href="/terms">terms of service</a> for full details.
      </>
    ),
  },
  {
    q: 'Have you raised venture capital?',
    a: (
      <>
        Yes — about $30M led by a16z, with participation from BoxGroup, 3kVC,
        and others.
      </>
    ),
  },
];

function FaqSection() {
  return (
    <section
      aria-label="Frequently asked questions"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '24px' : '40px',
        'justify-items': 'center',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <style>{`
        .pricing-faq__item { border-bottom: 1px solid ${RULE}; }
        .pricing-faq__item > summary {
          align-items: center;
          color: var(--c1);
          cursor: default;
          display: flex;
          font-family: 'display';
          font-size: 20px;
          font-weight: 410;
          gap: 16px;
          justify-content: space-between;
          letter-spacing: -0.01em;
          list-style: none;
          padding: 22px 4px;
        }
        .pricing-faq__item > summary::-webkit-details-marker { display: none; }
        .pricing-faq__item > summary .pricing-faq__chevron { color: var(--c4); flex-shrink: 0; transition: transform 220ms ease; }
        .pricing-faq__item[open] > summary .pricing-faq__chevron { transform: rotate(180deg); }
        .pricing-faq__answer { color: var(--c4); font-size: 16px; line-height: 1.6; margin: 0; padding: 0 4px 24px; max-width: 760px; }
        .pricing-faq__answer a { color: var(--a0); text-decoration: none; }
        @media (hover) {
          .pricing-faq__item > summary:hover { color: var(--a0); }
          .pricing-faq__answer a:hover { text-decoration: underline; }
          .pricing-cta-button:hover { transform: scale(1.02); }
        }
        @media (max-width: 700px) {
          .pricing-faq__item > summary { font-size: 17px; padding: 18px 4px; }
        }
      `}</style>
      <div
        style={{
          display: 'grid',
          gap: '12px',
          'justify-items': 'center',
          'max-width': '720px',
          'text-align': 'center',
        }}
      >
        <span style={eyebrowStyle()}>FAQ</span>
        <h2 style={sectionHeadingStyle()}>Frequently asked questions</h2>
      </div>
      <div
        style={{
          'border-top': `1px solid ${RULE}`,
          width: '100%',
          'max-width': '860px',
        }}
      >
        <For each={faqItems}>
          {(item) => (
            <details class="pricing-faq__item">
              <summary>
                <span>{item.q}</span>
                <svg
                  class="pricing-faq__chevron"
                  width="16"
                  height="16"
                  viewBox="0 0 256 256"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
                </svg>
              </summary>
              <p class="pricing-faq__answer">{item.a}</p>
            </details>
          )}
        </For>
      </div>
    </section>
  );
}

function SavingsSection() {
  return (
    <section
      aria-labelledby="pricing-savings-title"
      id="savings"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '24px' : '40px',
        'justify-items': 'center',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: '16px',
          'justify-items': 'center',
          'text-align': 'center',
        }}
      >
        <span style={eyebrowStyle()}>Calculator</span>
        <h2 id="pricing-savings-title" style={sectionHeadingStyle()}>
          See what you’d save
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-size': mobile() ? '15px' : '16px',
            'line-height': 1.6,
            margin: 0,
            'max-width': '440px',
            'text-wrap': 'balance',
          }}
        >
          Choose the tools your team pays for today and how many seats you need.
        </p>
      </div>
      <SavingsCalculator />
    </section>
  );
}

function PricingFinalCta() {
  return (
    <SectionFinalCta
      googleButtonName="pricing_final_sign_up_google"
      demoButtonName="pricing_final_book_demo"
      mobileButtonName="pricing_final_get_started"
    />
  );
}

export const RoutePricing: Component = () => {
  setPageSeo({
    title: 'Pricing — Macro',
    description:
      'Start free. Pro is $40 per seat per month with every AI model and standard usage. Max is $200 per seat per month with 10× Pro usage. Every module is included on every plan — we charge for usage limits and team features, not feature gates.',
    path: '/pricing',
  });

  return (
    <div
      lang="en"
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '0',
        'padding-bottom': mobile() ? '48px' : '64px',
        width: '100%',
      }}
    >
      <style>{`
        @media (hover) {
          .pricing-cta-button:hover { transform: scale(1.02); }
          .pricing-final-cta:hover { transform: scale(1.02); }
        }
      `}</style>

      <section
        aria-label="Pricing"
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          gap: mobile() ? '20px' : '24px',
          'justify-items': 'center',
          'padding-bottom': mobile() ? '48px' : '64px',
          'padding-inline': mobile() ? '18px' : '24px',
          'padding-top': mobile() ? '96px' : '128px',
          'text-align': 'center',
          width: '100%',
        }}
      >
        <h1
          style={{
            'font-family': 'display',
            'font-size': mobile() ? 'clamp(46px, 13vw, 62px)' : '52.36px',
            'font-weight': '315',
            'letter-spacing': '-0.012em',
            'line-height': 1.12,
            margin: 0,
            'max-width': '820px',
            'text-wrap': 'balance',
          }}
        >
          Support Macro's open source development with a paid plan.
        </h1>
      </section>

      <HomeSectionRule />

      <div style={{ 'padding-block': mobile() ? '56px' : '72px' }}>
        <PricingPlans />
      </div>

      <HomeSectionRule />

      <ComparisonGrid />

      <HomeSectionRule />

      <SavingsSection />

      <HomeSectionRule />

      <CaseStudyVideo />

      <HomeSectionRule />

      <FaqSection />

      <HomeSectionRule />

      <div
        style={{
          'padding-block': mobile() ? '52px' : '68px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <PricingFinalCta />
      </div>

      <div
        style={{
          'padding-bottom': mobile() ? '40px' : '48px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <SectionMoreFeatures currentPath="/pricing" footerOnly />
      </div>
    </div>
  );
};
