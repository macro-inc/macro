import {
  createEffect,
  createSignal,
  For,
  Index,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { isServer } from 'solid-js/web';
import IconCompany from '../../../assets/icons/icon-company.svg';
import IconSearch from '../../../assets/icons/icon-search.svg';
import IconMacroCall from '../../../assets/icons/wide-call.svg';
import IconMacroDocs from '../../../assets/icons/wide-file-md.svg';
import IconMacroTasks from '../../../assets/icons/wide-task.svg';
import {
  breakpoint,
  isMobileViewport,
  viewportWidth,
} from '../../utils/utilBreakpoint';
import { heroAppChromeBg } from '../../utils/utilHeroStyles';
import { createVisible } from '../../utils/utilVisible';
import { PhoneFrame, PhoneScreenContent } from '../utils/UtilPhoneFrame';

const _HERO_DEMO_VIDEO_ID = 'tnsxkywzTvY';
const _MACRO_REPO_URL = 'https://github.com/macro-inc/macro';

// ---------------------------------------------------------------------------
// Shared style fragments (matching the homepage / email / channels bento
// language)
// ---------------------------------------------------------------------------

const mobile = isMobileViewport;

// The agent section drops from its text-left / phone-right two-column layout to
// a single stacked column on narrower viewports.
const _narrowAgent = () => viewportWidth() < 940;

// Faux-app chrome uses a neutral UI sans so the mocks read as real product
// screenshots rather than marketing copy.
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// In-app object accents: amber companies/people, blue docs, green tasks, teal
// calls.
const COMPANY_AMBER = 'var(--a0)';
const DOC_BLUE = 'var(--a4)';
const TASK_GREEN = 'var(--a2)';
const CALL_TEAL = 'var(--a3)';

function eyebrowStyle(): JSX.CSSProperties {
  return {
    color: 'var(--a0)',
    'font-family': 'rajdhani, body',
    'font-size': breakpoint() ? '12px' : '16px',
    'letter-spacing': '0.08em',
    'text-transform': 'uppercase',
  };
}

function Avatar(props: { initials: string; size?: number; color?: string }) {
  const s = props.size ?? 26;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': props.color ?? 'var(--b3)',
        border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        display: 'inline-grid',
        flex: 'none',
        'font-family': appFont,
        'font-size': `${Math.round(s * 0.38)}px`,
        'font-weight': '600',
        height: `${s}px`,
        'place-items': 'center',
        width: `${s}px`,
      }}
    >
      {props.initials}
    </span>
  );
}

// Rounded-square company badge (the building tile used on record headers).
function CompanyBadge(props: { size?: number; radius?: number }) {
  const s = props.size ?? 40;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': 'color-mix(in srgb, var(--c4) 12%, var(--b1))',
        border: '1px solid color-mix(in srgb, var(--c4) 20%, transparent)',
        'border-radius': `${props.radius ?? 10}px`,
        color: 'var(--c2)',
        display: 'inline-grid',
        flex: 'none',
        height: `${s}px`,
        'place-items': 'center',
        width: `${s}px`,
      }}
    >
      <IconCompany
        style={{
          display: 'block',
          height: `${Math.round(s * 0.5)}px`,
          width: `${Math.round(s * 0.5)}px`,
        }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

function ChevronGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke={props.color ?? 'var(--c4)'}
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function SparkleGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M12 5c.4 4.6 2.4 6.6 7 7-4.6.4-6.6 2.4-7 7-.4-4.6-2.4-6.6-7-7 4.6-.4 6.6-2.4 7-7z"
        fill={props.color ?? 'currentColor'}
      />
    </svg>
  );
}

function _HashGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 15;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M9 4L7 20 M17 4l-2 16 M4 9h16 M3 15h16"
        fill="none"
        stroke={props.color ?? 'var(--c4)'}
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>
  );
}

function PaperclipGlyph(props: { size?: number }) {
  const s = props.size ?? 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M20 11.5l-7.8 7.8a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.3 4.3l-8 8a1.5 1.5 0 0 1-2.2-2.1l7.1-7.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function SendGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M4 11.5 19 4l-4.2 15-3.3-6.2L4 11.5Z"
        fill="currentColor"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.4"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// The little blue document icon used in the real app.
function DocFileGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <rect
        x="4"
        y="3"
        width="16"
        height="18"
        rx="2.5"
        fill="none"
        stroke={props.color ?? DOC_BLUE}
        stroke-width="1.7"
      />
      <path
        d="M8 8h8 M8 12h8 M8 16h5"
        fill="none"
        stroke={props.color ?? DOC_BLUE}
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>
  );
}

// The green "task list" icon used in the real app.
function TaskListGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 16;
  const c = props.color ?? TASK_GREEN;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M4 7l2 2 3-3 M4 16l2 2 3-3 M12 7h8 M12 17h8"
        fill="none"
        stroke={c}
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function _PhoneGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function GlobeGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke={props.color ?? 'var(--c4)'}
        stroke-width="1.6"
      />
      <path
        d="M3 12h18 M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"
        fill="none"
        stroke={props.color ?? 'var(--c4)'}
        stroke-width="1.6"
      />
    </svg>
  );
}

function MailGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 15;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2.5"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.6"
      />
      <path
        d="M4 7l8 6 8-6"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function _CheckSquareGlyph(props: { size?: number; on?: boolean }) {
  const s = props.size ?? 18;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': props.on ? 'var(--a0)' : 'transparent',
        border: props.on
          ? '1px solid var(--a0)'
          : '1px solid color-mix(in srgb, var(--c4) 40%, transparent)',
        'border-radius': '5px',
        'box-sizing': 'border-box',
        color: 'var(--b0)',
        display: 'inline-grid',
        flex: 'none',
        height: `${s}px`,
        'place-items': 'center',
        width: `${s}px`,
      }}
    >
      <Show when={props.on}>
        <svg
          width={Math.round(s * 0.62)}
          height={Math.round(s * 0.62)}
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block' }}
        >
          <path
            d="M5 12l4.5 4.5L19 7"
            fill="none"
            stroke="currentColor"
            stroke-width="2.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </Show>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline @mention pills
// ---------------------------------------------------------------------------

type MentionKind =
  | 'company'
  | 'contact'
  | 'person'
  | 'doc'
  | 'task'
  | 'channel'
  | 'call';

// Inline @mention: a leading type icon + underlined label, matching how the
// real app renders mentions inside prose — no status/priority/assignee chips.
// Leading avatar / icon inside an inline @mention. Vertically centred against
// the surrounding text while the label itself stays on the text baseline.
const mentionIconWrap: JSX.CSSProperties = {
  display: 'inline-flex',
  'margin-right': '4px',
  'vertical-align': 'middle',
};

function MentionPill(props: {
  kind: MentionKind;
  label: string;
  initials?: string;
  companyIconColor?: string;
}) {
  const isPerson = props.kind === 'person' || props.kind === 'contact';
  const isCompany = props.kind === 'company';
  const isChannel = props.kind === 'channel';
  const isTask = props.kind === 'task';
  return (
    <span
      style={{
        color: 'var(--c1)',
        'font-family': appFont,
        'font-weight': '500',
        margin: '0 2px',
        'white-space': 'nowrap',
      }}
    >
      <Show when={isPerson}>
        <span style={mentionIconWrap}>
          <Avatar initials={props.initials ?? ''} size={16} color="var(--b3)" />
        </span>
      </Show>
      <Show when={isCompany}>
        <span style={mentionIconWrap}>
          <IconCompany
            style={{
              color: props.companyIconColor ?? COMPANY_AMBER,
              display: 'block',
              height: '13px',
              width: '13px',
            }}
          />
        </span>
      </Show>
      <Show when={props.kind === 'doc'}>
        <span style={mentionIconWrap}>
          <IconMacroDocs
            style={{
              color: DOC_BLUE,
              display: 'block',
              height: '13px',
              width: '13px',
            }}
          />
        </span>
      </Show>
      <Show when={isTask}>
        <span style={mentionIconWrap}>
          <IconMacroTasks
            style={{
              color: TASK_GREEN,
              display: 'block',
              height: '13px',
              width: '13px',
            }}
          />
        </span>
      </Show>
      <Show when={props.kind === 'call'}>
        <span style={mentionIconWrap}>
          <IconMacroCall
            style={{
              color: CALL_TEAL,
              display: 'block',
              height: '13px',
              width: '13px',
            }}
          />
        </span>
      </Show>
      <Show when={isChannel}>
        <span
          style={{
            color: 'var(--c4)',
            'font-weight': '700',
            'margin-right': '2px',
          }}
        >
          #
        </span>
      </Show>
      <span
        style={{
          'text-decoration-line': 'underline',
          'text-decoration-color':
            'color-mix(in srgb, var(--c4) 45%, transparent)',
          'text-underline-offset': '2px',
        }}
      >
        {props.label}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared sample data
// ---------------------------------------------------------------------------

const heroContacts = [
  { name: 'Sarah Chen', email: 'sarah@hartwell.com', initials: 'SC' },
  { name: 'Marcus Lee', email: 'marcus@hartwell.com', initials: 'ML' },
  { name: 'Priya Nair', email: 'priya@hartwell.com', initials: 'PN' },
  { name: 'David Okoro', email: 'david@hartwell.com', initials: 'DO' },
];

const heroEmails = [
  {
    who: 'Sarah Chen',
    subject: 'Re: Pilot rollout plan',
    snippet: 'Thanks for the deck. The team is in.',
    date: 'Jun 12',
    unread: true,
  },
  {
    who: 'Marcus Lee',
    subject: 'Security review questionnaire',
    snippet: 'Attaching our SOC 2 and DPA for',
    date: 'Jun 9',
    unread: true,
  },
  {
    who: 'Sarah Chen',
    subject: 'Re: Pricing for 200 seats',
    snippet: "That works on our end. Let's lock",
    date: 'Jun 3',
    unread: false,
  },
  {
    who: 'Priya Nair',
    subject: 'Intro: data platform team',
    snippet: 'Hi, Sarah suggested I reach out about',
    date: 'May 28',
    unread: false,
  },
  {
    who: 'Hartwell Team',
    subject: 'Kickoff scheduled for Tuesday',
    snippet: 'Calendar invite attached. Looking',
    date: 'May 21',
    unread: false,
  },
];

// ---------------------------------------------------------------------------
// Hero: realistic company-record window (record + details rail)
// ---------------------------------------------------------------------------

export function HeroCompanyWindow(props: { flush?: boolean }) {
  const compact = () => mobile();
  const showRail = () => !breakpoint(); // details rail only on full desktop
  // When embedded inside an outer frame (e.g. the homepage browser mockup) the
  // window drops its own chrome and bottom fade so it reads as a full page.
  const flush = () => props.flush === true;

  return (
    <div
      class="crm-hero-window"
      style={{
        'background-color': flush()
          ? 'var(--hero-app-chrome-bg)'
          : 'var(--hero-window-bg)',
        border: flush()
          ? '0'
          : '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
        'border-radius': flush() ? '0' : '12px',
        'box-shadow': flush() ? 'none' : 'var(--shadow-window)',
        'box-sizing': 'border-box',
        '-webkit-mask-image': flush()
          ? 'none'
          : 'linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 68%, rgb(0 0 0 / 0.18) 100%)',
        'mask-image': flush()
          ? 'none'
          : 'linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 68%, rgb(0 0 0 / 0.18) 100%)',
        overflow: 'hidden',
        padding: flush() ? '0' : '7px',
        width: '100%',
      }}
    >
      <style>{`
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           build-time prerender paints correctly on phones before the JS
           bundle loads. */
        .crm-gfx-hero-grid { grid-template-columns: minmax(0, 1fr) 248px; }
        .crm-gfx-hero-record {
          border-right: 1px solid color-mix(in srgb, var(--c4) 10%, transparent);
          gap: 22px;
          padding: 26px 28px 0;
        }
        .crm-gfx-hero-name { font-size: 22px; }
        .crm-gfx-hero-desc { font-size: 13.5px; }
        .crm-gfx-hero-emails { padding-bottom: 14px; }
        .crm-gfx-hero-mail-who { width: 92px; }
        /* The details rail renders only on full desktop; the wrapper stays
           display: contents so the rail sits directly on the window grid. */
        .crm-gfx-hero-rail { display: contents; }
        @media (max-width: 1029px) {
          .crm-gfx-hero-grid { grid-template-columns: minmax(0, 1fr); }
          .crm-gfx-hero-record { border-right: 0; }
          .crm-gfx-hero-rail { display: none; }
        }
        @media (max-width: 699px) {
          .crm-gfx-hero-grid { grid-template-columns: 1fr; }
          .crm-gfx-hero-record { gap: 18px; padding: 20px 16px 0; }
          .crm-gfx-hero-name { font-size: 19px; }
          .crm-gfx-hero-desc { font-size: 13px; }
          .crm-gfx-hero-emails { padding-bottom: 8px; }
          .crm-gfx-hero-mail-who { width: 78px; }
        }
      `}</style>
      <div
        class="crm-gfx-hero-grid"
        style={{
          'background-color': heroAppChromeBg,
          border: flush()
            ? '0'
            : '1px solid color-mix(in srgb, var(--c4) 12%, transparent)',
          'border-radius': flush() ? '0' : '8px',
          display: 'grid',
          overflow: 'hidden',
          'text-align': 'left',
        }}
      >
        {/* Record pane */}
        <div
          class="crm-gfx-hero-record"
          style={{
            display: 'grid',
            'align-content': 'start',
            'min-width': 0,
          }}
        >
          {/* Company header */}
          <div
            style={{
              'align-items': 'flex-start',
              display: 'flex',
              gap: '14px',
            }}
          >
            <CompanyBadge size={46} radius={12} />
            <div style={{ display: 'grid', gap: '6px', 'min-width': 0 }}>
              <span
                class="crm-gfx-hero-name"
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-weight': '700',
                  'letter-spacing': '-0.01em',
                }}
              >
                Hartwell
              </span>
              <p
                class="crm-gfx-hero-desc"
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'line-height': 1.55,
                  margin: 0,
                }}
              >
                Streaming data pipelines for Postgres and Kafka. Founded 2017,
                Austin. <span style={{ color: 'var(--c2)' }}>Show more</span>
              </p>
            </div>
          </div>

          {/* Discussion */}
          <div style={{ display: 'grid', gap: '10px' }}>
            <div
              style={{
                'align-items': 'center',
                color: 'var(--c2)',
                display: 'flex',
                'font-family': appFont,
                'font-size': '12.5px',
                'font-weight': '600',
                gap: '6px',
              }}
            >
              <ChevronGlyph size={12} /> Discussion
            </div>
            <div
              style={{
                'background-color': '#0a0a0a',
                border:
                  '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
                'border-radius': '12px',
                'box-sizing': 'border-box',
                display: 'grid',
                gap: '12px',
                padding: '12px 13px',
              }}
            >
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '13.5px',
                }}
              >
                Leave a comment…
              </span>
              <div
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  gap: '12px',
                }}
              >
                <span style={{ color: 'var(--c4)', display: 'inline-flex' }}>
                  <PaperclipGlyph size={16} />
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '14px',
                    'font-weight': '600',
                  }}
                >
                  Aa
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    'align-items': 'center',
                    'background-color': 'var(--a0)',
                    'border-radius': '999px',
                    color: 'var(--b0)',
                    display: 'inline-flex',
                    flex: 'none',
                    height: '26px',
                    'justify-content': 'center',
                    'margin-left': 'auto',
                    width: '26px',
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    style={{ display: 'block' }}
                  >
                    <path
                      d="M12 19V5M12 5l-6 6M12 5l6 6"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </div>
          </div>

          {/* Emails */}
          <div
            class="crm-gfx-hero-emails"
            style={{
              display: 'grid',
              gap: '10px',
            }}
          >
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}
            >
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '14px',
                  'font-weight': '600',
                }}
              >
                Emails
              </span>
              <span
                style={{
                  'align-items': 'center',
                  'background-color': '#0a0a0a',
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '7px',
                  display: 'inline-flex',
                  'margin-left': 'auto',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    'background-color':
                      'color-mix(in srgb, var(--c1) 8%, transparent)',
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': '11.5px',
                    'font-weight': '600',
                    padding: '4px 11px',
                  }}
                >
                  Team
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '11.5px',
                    padding: '4px 11px',
                  }}
                >
                  Me
                </span>
              </span>
            </div>
            <div style={{ display: 'grid' }}>
              <For each={heroEmails}>
                {(mail, index) => (
                  <div
                    style={{
                      'align-items': 'center',
                      'border-top':
                        index() === 0
                          ? '0'
                          : '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                      display: 'flex',
                      gap: '10px',
                      padding: '9px 2px',
                    }}
                  >
                    <span
                      style={{
                        'background-color': mail.unread
                          ? 'var(--a0)'
                          : 'transparent',
                        'border-radius': '999px',
                        flex: 'none',
                        height: '7px',
                        width: '7px',
                      }}
                    />
                    <span
                      style={{
                        color: 'var(--c4)',
                        display: 'inline-flex',
                        flex: 'none',
                      }}
                    >
                      <MailGlyph size={14} />
                    </span>
                    <span
                      class="crm-gfx-hero-mail-who"
                      style={{
                        color: 'var(--c1)',
                        flex: 'none',
                        'font-family': appFont,
                        'font-size': '13px',
                        'font-weight': mail.unread ? '600' : '500',
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                      }}
                    >
                      {mail.who}
                    </span>
                    <span
                      style={{
                        color: 'var(--c1)',
                        flex: '1',
                        'font-family': appFont,
                        'font-size': '13px',
                        'font-weight': mail.unread ? '600' : '400',
                        'min-width': 0,
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                      }}
                    >
                      {mail.subject}{' '}
                      <span
                        style={{ color: 'var(--c4)', 'font-weight': '400' }}
                      >
                        {mail.snippet}
                      </span>
                    </span>
                    <span
                      style={{
                        color: 'var(--c4)',
                        flex: 'none',
                        'font-family': appFont,
                        'font-size': '11.5px',
                        'white-space': 'nowrap',
                      }}
                    >
                      {mail.date}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>

        {/* Details rail */}
        <Show when={isServer || (showRail() && !compact())}>
          <div class="crm-gfx-hero-rail">
            <div
              style={{
                'background-color':
                  'color-mix(in srgb, var(--b1) 24%, var(--b0))',
                display: 'grid',
                'align-content': 'start',
                gap: '12px',
                padding: '12px 10px',
              }}
            >
              {/* Details */}
              <div
                style={{
                  'background-color': '#0a0a0a',
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '12px',
                  display: 'grid',
                  gap: '9px',
                  padding: '13px 14px',
                }}
              >
                <span
                  style={{
                    'align-items': 'center',
                    color: 'var(--c2)',
                    display: 'flex',
                    'font-family': appFont,
                    'font-size': '12px',
                    'font-weight': '600',
                    gap: '6px',
                  }}
                >
                  <ChevronGlyph size={11} /> Details
                </span>
                <div style={{ display: 'grid', gap: '3px' }}>
                  <span
                    style={{
                      color: 'var(--c4)',
                      'font-family': appFont,
                      'font-size': '11px',
                    }}
                  >
                    Domains
                  </span>
                  <span
                    style={{
                      'align-items': 'center',
                      color: 'var(--c2)',
                      display: 'inline-flex',
                      'font-family': appFont,
                      'font-size': '13px',
                      gap: '6px',
                    }}
                  >
                    <GlobeGlyph size={13} color="var(--c4)" /> hartwell.com
                  </span>
                </div>
              </div>
              {/* Contacts */}
              <div
                style={{
                  'background-color': '#0a0a0a',
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '12px',
                  display: 'grid',
                  gap: '10px',
                  padding: '13px 14px',
                }}
              >
                <span
                  style={{
                    'align-items': 'center',
                    color: 'var(--c2)',
                    display: 'flex',
                    'font-family': appFont,
                    'font-size': '12px',
                    'font-weight': '600',
                    gap: '6px',
                  }}
                >
                  <ChevronGlyph size={11} /> Contacts
                </span>
                <div
                  style={{
                    'align-items': 'center',
                    'background-color': 'var(--b0)',
                    border:
                      '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                    'border-radius': '7px',
                    color: 'var(--c4)',
                    display: 'flex',
                    'font-family': appFont,
                    'font-size': '12px',
                    gap: '7px',
                    padding: '6px 9px',
                  }}
                >
                  <IconSearch
                    style={{
                      color: 'var(--c4)',
                      display: 'block',
                      height: '12px',
                      width: '12px',
                    }}
                  />{' '}
                  Search contacts…
                </div>
                <div style={{ display: 'grid', gap: '13px' }}>
                  <For each={heroContacts}>
                    {(c) => (
                      <div
                        style={{ display: 'grid', gap: '2px', 'min-width': 0 }}
                      >
                        <span
                          style={{
                            color: 'var(--c1)',
                            'font-family': appFont,
                            'font-size': '13px',
                            'font-weight': '500',
                            overflow: 'hidden',
                            'text-overflow': 'ellipsis',
                            'white-space': 'nowrap',
                          }}
                        >
                          {c.name}
                        </span>
                        <span
                          style={{
                            color: 'var(--c4)',
                            'font-family': appFont,
                            'font-size': '11.5px',
                            overflow: 'hidden',
                            'text-overflow': 'ellipsis',
                            'white-space': 'nowrap',
                          }}
                        >
                          {c.email}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
              {/* Sharing */}
              <div
                style={{
                  'align-items': 'center',
                  'background-color': '#0a0a0a',
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '12px',
                  color: 'var(--c2)',
                  display: 'flex',
                  'font-family': appFont,
                  'font-size': '12px',
                  'font-weight': '600',
                  gap: '6px',
                  padding: '13px 14px',
                }}
              >
                <span style={{ transform: 'rotate(-90deg)' }}>
                  <ChevronGlyph size={11} />
                </span>{' '}
                Sharing
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Records build themselves" — inbound email → enriched company record
// ---------------------------------------------------------------------------

const enrichmentChips = [
  { label: 'Developer tools' },
  { label: '237 employees' },
  { label: 'Austin, TX' },
];

export function BuildsThemselvesGraphic() {
  const compact = () => mobile();
  let containerEl: HTMLDivElement | undefined;
  const visible = createVisible(() => containerEl);
  const [revealed, setRevealed] = createSignal(false);
  const [reduce, setReduce] = createSignal(false);

  onMount(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      setReduce(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
  });

  // One-shot latch: once the graphic has scrolled into view it stays revealed.
  createEffect(() => {
    if (visible()) setRevealed(true);
  });

  // Staged fade/rise, all completing within ~500ms of entering the viewport.
  const reveal = (delay: number, duration = 220): JSX.CSSProperties =>
    reduce()
      ? {}
      : {
          opacity: revealed() ? 1 : 0,
          transform: revealed() ? 'translateY(0)' : 'translateY(10px)',
          transition: `opacity ${duration}ms ease ${delay}ms, transform ${duration}ms ease ${delay}ms`,
        };

  return (
    <div
      ref={containerEl}
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '0',
        'justify-items': 'center',
        padding: compact() ? '32px 18px' : '44px 24px',
        width: '100%',
        'max-width': '460px',
      }}
    >
      {/* Inbound email */}
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-sm)',
          'box-sizing': 'border-box',
          display: 'flex',
          gap: '11px',
          padding: '13px 15px',
          width: '100%',
          ...reveal(0),
        }}
      >
        <span
          style={{
            'align-items': 'center',
            'background-color':
              'color-mix(in srgb, var(--c4) 10%, transparent)',
            'border-radius': '8px',
            color: 'var(--c2)',
            display: 'inline-grid',
            flex: 'none',
            height: '32px',
            'place-items': 'center',
            width: '32px',
          }}
        >
          <MailGlyph size={16} />
        </span>
        <div style={{ display: 'grid', gap: '2px', 'min-width': 0 }}>
          <div style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '13.5px',
                'font-weight': '600',
              }}
            >
              Sarah Chen
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '12px',
              }}
            >
              sarah@hartwell.com
            </span>
          </div>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '13px',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            Re: Pilot rollout plan. The team is in.
          </span>
        </div>
      </div>

      {/* Connector */}
      <div
        aria-hidden="true"
        style={{
          'align-items': 'center',
          display: 'grid',
          'justify-items': 'center',
          padding: '4px 0',
          ...reveal(60),
        }}
      >
        <span
          style={{
            'background-color': 'var(--b3)',
            height: '20px',
            width: '2px',
          }}
        />
        <span
          style={{
            'align-items': 'center',
            'background-color': 'color-mix(in srgb, var(--c4) 9%, transparent)',
            border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            'border-radius': '999px',
            color: 'var(--c4)',
            display: 'inline-flex',
            'font-family': appFont,
            'font-size': '11.5px',
            'font-weight': '500',
            gap: '6px',
            padding: '4px 11px',
          }}
        >
          Created from this email
        </span>
        <span
          style={{
            'background-color': 'var(--b3)',
            height: '20px',
            width: '2px',
          }}
        />
      </div>

      {/* Resulting company record */}
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          display: 'grid',
          gap: '12px',
          padding: '15px 16px',
          width: '100%',
          ...reveal(130),
        }}
      >
        <div style={{ 'align-items': 'center', display: 'flex', gap: '12px' }}>
          <CompanyBadge size={42} radius={11} />
          <div style={{ display: 'grid', gap: '2px', 'min-width': 0 }}>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '15.5px',
                'font-weight': '700',
              }}
            >
              Hartwell
            </span>
            <span
              style={{
                'align-items': 'center',
                color: 'var(--c4)',
                display: 'inline-flex',
                'font-family': appFont,
                'font-size': '12px',
                gap: '5px',
              }}
            >
              <GlobeGlyph size={12} /> hartwell.com
            </span>
          </div>
          <span
            style={{
              'align-items': 'center',
              display: 'inline-flex',
              'margin-left': 'auto',
            }}
          >
            <Avatar initials="SC" size={22} color="var(--b3)" />
            <span style={{ 'margin-left': '-7px' }}>
              <Avatar initials="ML" size={22} color="var(--b4)" />
            </span>
            <span style={{ 'margin-left': '-7px' }}>
              <Avatar initials="PN" size={22} color="var(--b3)" />
            </span>
          </span>
        </div>
        <p
          style={{
            color: 'var(--c4)',
            'font-family': appFont,
            'font-size': '12.5px',
            'line-height': 1.5,
            margin: 0,
          }}
        >
          Streaming data pipelines for Postgres and Kafka.
        </p>
        <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '6px' }}>
          <For each={enrichmentChips}>
            {(chip, i) => (
              <span
                style={{
                  'align-items': 'center',
                  'background-color': 'var(--b0)',
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '6px',
                  color: 'var(--c2)',
                  display: 'inline-flex',
                  'font-family': appFont,
                  'font-size': '11.5px',
                  padding: '3px 9px',
                  ...reveal(230 + i() * 45, 180),
                }}
              >
                {chip.label}
              </span>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Discussion on every record" — threads that work like channels
// ---------------------------------------------------------------------------

type ReplyMention = {
  kind: MentionKind;
  label: string;
  detail: string;
  initials?: string;
};

const REPLY_SARAH: ReplyMention = {
  kind: 'contact',
  label: 'Sarah',
  detail: 'Contact',
  initials: 'SC',
};
const REPLY_PROPOSAL: ReplyMention = {
  kind: 'doc',
  label: 'Proposal draft',
  detail: 'Document',
};
type SentReply = {
  author: string;
  initials: string;
  time: string;
  segments: (string | ReplyMention)[];
};

type ReplyFrame = {
  sent: SentReply[];
  commit: (string | ReplyMention)[];
  tail: string;
  query: string | null;
  composing: boolean;
  pressed: boolean;
};

const REPLY_SENT: SentReply = {
  author: 'Mary',
  initials: 'MK',
  time: '9:15 AM',
  segments: ['On it — sending ', REPLY_SARAH, ' the ', REPLY_PROPOSAL, '.'],
};

// Static (prerender / pre-animation) state: the reply already posted so
// crawlers see the whole sentence, and the composer is idle.
const REPLY_STATIC: ReplyFrame = {
  sent: [REPLY_SENT],
  commit: [],
  tail: '',
  query: null,
  composing: false,
  pressed: false,
};

// Type a reply that @mentions a contact then a doc, hit send, and watch the
// finished message append to the thread — then reset and loop.
function buildReplyFrames(): { frame: ReplyFrame; delay: number }[] {
  const TYPE = 52,
    HOLD = 720,
    SELECT = 420;
  const out: { frame: ReplyFrame; delay: number }[] = [];
  let sent: SentReply[] = [];
  let commit: (string | ReplyMention)[] = [];
  let tail = '';
  let query: string | null = null;
  let composing = false;
  let pressed = false;
  const snap = (delay: number) =>
    out.push({
      frame: {
        sent: [...sent],
        commit: [...commit],
        tail,
        query,
        composing,
        pressed,
      },
      delay,
    });

  snap(1100);
  composing = true;
  snap(360);

  for (const ch of 'On it — sending ') {
    tail += ch;
    snap(TYPE);
  }
  commit = [tail];
  tail = '';

  for (const q of ['@', '@s', '@sa', '@sar']) {
    query = q;
    snap(TYPE);
  }
  snap(HOLD);
  query = null;
  commit = [...commit, REPLY_SARAH];
  snap(SELECT);

  for (const ch of ' the ') {
    tail += ch;
    snap(TYPE);
  }
  commit = [...commit, tail];
  tail = '';

  for (const q of ['@', '@p', '@pr', '@pro', '@prop']) {
    query = q;
    snap(TYPE);
  }
  snap(HOLD);
  query = null;
  commit = [...commit, REPLY_PROPOSAL];
  snap(SELECT);

  tail = '.';
  snap(TYPE);
  commit = [...commit, tail];
  tail = '';
  snap(820);

  // press send
  pressed = true;
  snap(200);
  pressed = false;
  // message appends, composer clears
  sent = [
    { author: 'Mary', initials: 'MK', time: '9:15 AM', segments: [...commit] },
  ];
  commit = [];
  composing = false;
  snap(2800);

  // reset for the loop
  sent = [];
  snap(700);
  return out;
}

const REPLY_FRAMES = buildReplyFrames();

function ReplySegments(props: { segments: (string | ReplyMention)[] }) {
  return (
    <For each={props.segments}>
      {(seg) =>
        typeof seg === 'string' ? (
          <span>{seg}</span>
        ) : (
          <MentionPill
            kind={seg.kind}
            label={seg.label}
            initials={seg.initials}
          />
        )
      }
    </For>
  );
}

// Motion for the mention/reply animations: blinking caret and the sent reply
// sliding into the thread. Injected by the graphics that use the classes;
// duplicate <style> tags are harmless.
const crmMotionStyles = `
  @media (prefers-reduced-motion: no-preference) {
    @keyframes crmCaretBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
    .crm-caret { animation: crmCaretBlink 1.05s steps(1) infinite; }
    @keyframes crmReplyIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .crm-reply-in { animation: crmReplyIn 360ms cubic-bezier(0.22, 1, 0.36, 1) both; }
  }
`;

// ---------------------------------------------------------------------------
// The real Macro @-mention typeahead, replicated — same anatomy as the docs
// page's RealMentionMenu (captured from the live editor): muted section
// headers with a "View all (n)" affordance, an → key hint on the first
// section, and an ink/5 highlight on the active row.
// ---------------------------------------------------------------------------

type CrmMenuRow = {
  kind: MentionKind;
  label: string;
  detail?: string;
  initials?: string;
};
type CrmMenuSection = { label: string; count: number; rows: CrmMenuRow[] };

function CrmMentionMenu(props: { sections: CrmMenuSection[] }) {
  const visibleSections = () => props.sections.filter((s) => s.rows.length > 0);
  const headerStyle: JSX.CSSProperties = {
    'align-items': 'center',
    color: 'var(--c4)',
    display: 'flex',
    'font-family': appFont,
    'font-size': '11.5px',
    'font-weight': '500',
    'justify-content': 'space-between',
    padding: '0 12px 5px',
  };
  const rowStyle = (active: boolean): JSX.CSSProperties => ({
    'align-items': 'center',
    'background-color': active
      ? 'color-mix(in srgb, var(--c1) 6%, transparent)'
      : 'transparent',
    'border-radius': '7px',
    display: 'flex',
    gap: '9px',
    margin: '0 6px',
    padding: '7px 9px',
  });
  const labelStyle: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-family': appFont,
    'font-size': '13.5px',
    'font-weight': '500',
    'min-width': 0,
    overflow: 'hidden',
    'text-overflow': 'ellipsis',
    'white-space': 'nowrap',
  };
  return (
    <div
      style={{
        'background-color': 'color-mix(in srgb, var(--b1) 72%, var(--b0))',
        border: '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
        'border-radius': '12px',
        'box-shadow': 'var(--shadow-panel-lg)',
        'box-sizing': 'border-box',
        overflow: 'hidden',
        padding: '9px 0 7px',
        'text-align': 'left',
        width: '100%',
      }}
    >
      <For each={visibleSections()}>
        {(section, sIndex) => (
          <>
            <Show when={sIndex() > 0}>
              <div
                aria-hidden="true"
                style={{
                  'border-bottom':
                    '1px solid color-mix(in srgb, var(--b4) 30%, transparent)',
                  margin: '8px 0',
                }}
              />
            </Show>
            <div style={headerStyle}>
              <span>{section.label}</span>
              <span
                style={{
                  'align-items': 'center',
                  display: 'inline-flex',
                  gap: '5px',
                }}
              >
                <Show when={sIndex() === 0}>
                  <span
                    style={{
                      'background-color': 'var(--b0)',
                      border:
                        '1px solid color-mix(in srgb, var(--b4) 40%, transparent)',
                      'border-radius': '4px',
                      'line-height': 1,
                      padding: '2px 4px',
                    }}
                  >
                    &rarr;
                  </span>
                </Show>
                View all ({section.count})
              </span>
            </div>
            <For each={section.rows}>
              {(row, rIndex) => (
                <div style={rowStyle(sIndex() === 0 && rIndex() === 0)}>
                  <span
                    style={{
                      'align-items': 'center',
                      display: 'inline-flex',
                      flex: 'none',
                      height: '18px',
                      'justify-content': 'center',
                      width: '18px',
                    }}
                  >
                    <Show
                      when={row.kind === 'contact' || row.kind === 'person'}
                    >
                      <Avatar
                        initials={row.initials ?? ''}
                        size={18}
                        color="var(--b3)"
                      />
                    </Show>
                    <Show when={row.kind === 'company'}>
                      <CompanyBadge size={18} radius={5} />
                    </Show>
                    <Show when={row.kind === 'doc'}>
                      <DocFileGlyph size={17} />
                    </Show>
                    <Show when={row.kind === 'task'}>
                      <TaskListGlyph size={16} />
                    </Show>
                  </span>
                  <Show
                    when={row.detail}
                    fallback={<span style={labelStyle}>{row.label}</span>}
                  >
                    <span
                      style={{
                        ...labelStyle,
                        'align-items': 'baseline',
                        display: 'flex',
                        gap: '7px',
                      }}
                    >
                      {row.label}
                      <span
                        style={{
                          color: 'var(--c4)',
                          'font-weight': '400',
                          overflow: 'hidden',
                          'text-overflow': 'ellipsis',
                        }}
                      >
                        {row.detail}
                      </span>
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </>
        )}
      </For>
    </div>
  );
}

export function DiscussionGraphic() {
  const compact = () => mobile();
  let cardEl: HTMLDivElement | undefined;
  const visible = createVisible(() => cardEl);
  const [frame, setFrame] = createSignal<ReplyFrame>(REPLY_STATIC);

  onMount(() => {
    let index = 0;
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const step = REPLY_FRAMES[index];
      setFrame(step.frame);
      index = (index + 1) % REPLY_FRAMES.length;
      timer = setTimeout(tick, step.delay);
    };
    createEffect(() => {
      if (visible() && !started) {
        started = true;
        tick();
      }
    });
    onCleanup(() => timer && clearTimeout(timer));
  });

  const query = () => (frame().query ?? '').replace('@', '').toLowerCase();
  // The real typeahead's section groups, filtered live by the typed query.
  const replySections = (): CrmMenuSection[] => [
    {
      label: 'People',
      count: 8,
      rows: [
        {
          kind: 'contact' as MentionKind,
          label: 'Sarah Chen',
          detail: 'sarah@hartwell.com',
          initials: 'SC',
        },
        {
          kind: 'contact' as MentionKind,
          label: 'Marcus Lee',
          detail: 'marcus@hartwell.com',
          initials: 'ML',
        },
      ].filter((r) => r.label.toLowerCase().includes(query())),
    },
    {
      label: 'Documents, Agents, & Tasks',
      count: 9,
      rows: [
        { kind: 'doc' as MentionKind, label: 'Proposal draft' },
        { kind: 'doc' as MentionKind, label: 'Mutual NDA' },
      ].filter((r) => r.label.toLowerCase().includes(query())),
    },
  ];
  const replyMenuOpen = () =>
    frame().query !== null && replySections().some((s) => s.rows.length > 0);
  const hasContent = () => frame().commit.length > 0 || frame().tail.length > 0;

  const msgText: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-family': appFont,
    'font-size': compact() ? '13.5px' : '14.5px',
    'line-height': 1.55,
    margin: 0,
  };
  const nameStyle: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-family': appFont,
    'font-size': '13px',
    'font-weight': '600',
  };
  const timeStyle: JSX.CSSProperties = {
    color: 'var(--c4)',
    'font-family': appFont,
    'font-size': '11.5px',
    'margin-left': 'auto',
  };
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: compact() ? '32px 18px' : '44px 24px',
        width: '100%',
      }}
    >
      <style>{crmMotionStyles}</style>
      <div
        ref={cardEl}
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'visible',
          width: 'min(460px, 100%)',
        }}
      >
        {/* Record header */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '10px',
            padding: '11px 14px',
          }}
        >
          <CompanyBadge size={28} radius={8} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
              'font-weight': '600',
            }}
          >
            Hartwell
          </span>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '12px',
              'margin-left': 'auto',
            }}
          >
            Discussion
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gap: '14px',
            padding: compact() ? '16px 14px' : '18px 16px',
          }}
        >
          {/* Root comment */}
          <div style={{ display: 'grid', gap: '8px' }}>
            <div
              style={{
                'align-items': 'flex-start',
                display: 'flex',
                gap: '10px',
              }}
            >
              <Avatar initials="JB" size={28} color="var(--b3)" />
              <div
                style={{
                  display: 'grid',
                  gap: '2px',
                  'min-width': 0,
                  width: '100%',
                }}
              >
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '8px',
                  }}
                >
                  <span style={nameStyle}>Jacob</span>
                  <span style={timeStyle}>9:02 AM</span>
                </div>
                <p style={msgText}>
                  <MentionPill kind="contact" label="Sarah" initials="SC" />{' '}
                  wants pricing for 200 seats by Friday.
                </p>
              </div>
            </div>
            {/* Inline replies */}
            <div
              style={{
                'border-left':
                  '2px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                display: 'grid',
                gap: '11px',
                'margin-left': '13px',
                padding: '2px 0 0 16px',
              }}
            >
              <div
                style={{
                  'align-items': 'flex-start',
                  display: 'flex',
                  gap: '9px',
                }}
              >
                <Avatar initials="MK" size={22} color="var(--b3)" />
                <div
                  style={{
                    display: 'grid',
                    gap: '1px',
                    'min-width': 0,
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      'align-items': 'center',
                      display: 'flex',
                      gap: '8px',
                    }}
                  >
                    <span style={nameStyle}>Mary</span>
                    <span style={timeStyle}>9:11 AM</span>
                  </div>
                  <p style={msgText}>
                    On it, draft is in{' '}
                    <MentionPill kind="doc" label="Hartwell proposal" />.
                  </p>
                </div>
              </div>
              <Show when={!compact()}>
                <div
                  style={{
                    'align-items': 'flex-start',
                    display: 'flex',
                    gap: '9px',
                  }}
                >
                  <Avatar initials="JB" size={22} color="var(--b3)" />
                  <div
                    style={{
                      display: 'grid',
                      gap: '1px',
                      'min-width': 0,
                      width: '100%',
                    }}
                  >
                    <div
                      style={{
                        'align-items': 'center',
                        display: 'flex',
                        gap: '8px',
                      }}
                    >
                      <span style={nameStyle}>Jacob</span>
                      <span style={timeStyle}>9:13 AM</span>
                    </div>
                    <p style={msgText}>
                      Perfect. Filed <MentionPill kind="task" label="PRJ-204" />{' '}
                      to track it.
                    </p>
                  </div>
                </div>
              </Show>
              {/* Newly sent reply (animated append) */}
              <For each={frame().sent}>
                {(msg) => (
                  <div
                    class="crm-reply-in"
                    style={{
                      'align-items': 'flex-start',
                      display: 'flex',
                      gap: '9px',
                    }}
                  >
                    <Avatar
                      initials={msg.initials}
                      size={22}
                      color="var(--b3)"
                    />
                    <div
                      style={{
                        display: 'grid',
                        gap: '1px',
                        'min-width': 0,
                        width: '100%',
                      }}
                    >
                      <div
                        style={{
                          'align-items': 'center',
                          display: 'flex',
                          gap: '8px',
                        }}
                      >
                        <span style={nameStyle}>{msg.author}</span>
                        <span style={timeStyle}>{msg.time}</span>
                      </div>
                      <p style={msgText}>
                        <ReplySegments segments={msg.segments} />
                      </p>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
          {/* Composer (typing + @mention + send animation) */}
          <div style={{ position: 'relative' }}>
            {/* The real @ typeahead, opening upward from the composer */}
            <Show when={replyMenuOpen()}>
              <div
                style={{
                  bottom: 'calc(100% + 8px)',
                  left: '0',
                  position: 'absolute',
                  right: '0',
                }}
              >
                <CrmMentionMenu sections={replySections()} />
              </div>
            </Show>

            <div
              style={{
                'align-items': 'center',
                'background-color': '#0a0a0a',
                border:
                  '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
                'border-radius': '999px',
                display: 'flex',
                gap: '10px',
                padding: '8px 8px 8px 14px',
              }}
            >
              <div style={{ flex: '1', 'min-width': 0 }}>
                <Show
                  when={frame().composing || hasContent()}
                  fallback={
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': appFont,
                        'font-size': '13.5px',
                      }}
                    >
                      Reply…
                    </span>
                  }
                >
                  <span
                    style={{
                      color: 'var(--c1)',
                      'font-family': appFont,
                      'font-size': '13.5px',
                      'line-height': 1.5,
                    }}
                  >
                    <ReplySegments segments={frame().commit} />
                    {frame().tail}
                    <Show when={frame().query !== null}>
                      <span
                        style={{
                          'background-color':
                            'color-mix(in srgb, var(--a0) 16%, transparent)',
                          'border-radius': '4px',
                          color: 'var(--c1)',
                          padding: '1px 5px',
                        }}
                      >
                        {frame().query}
                      </span>
                    </Show>
                    <span
                      aria-hidden="true"
                      class="crm-caret"
                      style={{
                        'background-color': 'var(--c1)',
                        display: 'inline-block',
                        height: '15px',
                        'margin-left': '1px',
                        'vertical-align': 'text-bottom',
                        width: '1.5px',
                      }}
                    />
                  </span>
                </Show>
              </div>
              <span
                style={{
                  color: 'var(--c4)',
                  display: 'inline-flex',
                  flex: 'none',
                }}
              >
                <PaperclipGlyph size={15} />
              </span>
              <span
                aria-hidden="true"
                style={{
                  'align-items': 'center',
                  'background-color': hasContent()
                    ? 'var(--a0)'
                    : 'color-mix(in srgb, var(--c4) 14%, transparent)',
                  'border-radius': '999px',
                  color: hasContent() ? 'var(--b0)' : 'var(--c4)',
                  display: 'inline-flex',
                  flex: 'none',
                  height: '28px',
                  'justify-content': 'center',
                  transform: frame().pressed ? 'scale(0.86)' : 'scale(1)',
                  transition:
                    'transform 120ms ease, background-color 160ms ease',
                  width: '28px',
                }}
              >
                <SendGlyph size={15} />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "@mention a company anywhere" — mention menu inside a doc
// ---------------------------------------------------------------------------

type MentionRecord = {
  kind: MentionKind;
  label: string;
  detail: string;
  initials?: string;
};

const mentionMenu: MentionRecord[] = [
  { kind: 'company', label: 'Hartwell', detail: 'Company' },
  { kind: 'contact', label: 'Sarah Chen', detail: 'Contact', initials: 'SC' },
  { kind: 'contact', label: 'Marcus Lee', detail: 'Contact', initials: 'ML' },
];

const MENTION_HARTWELL: MentionRecord = mentionMenu[0];

type MentionDocFrame = {
  commit: (string | MentionRecord)[];
  tail: string;
  query: string | null;
};

// Completed state rendered on the server / before the animation starts, so
// crawlers and the no-JS prerender see the whole sentence (not fragments).
const MENTION_DOC_STATIC: MentionDocFrame = {
  commit: [
    'Biggest open deal is ',
    MENTION_HARTWELL,
    ' — closing this quarter.',
  ],
  tail: '',
  query: null,
};

// Type the sentence, fire an @ mention (filtering the menu live), pick the
// company so it becomes an inline record link, finish the line, then loop.
function buildMentionDocFrames(): { frame: MentionDocFrame; delay: number }[] {
  const TYPE = 58,
    HOLD = 850,
    SELECT = 480;
  const out: { frame: MentionDocFrame; delay: number }[] = [];
  let commit: (string | MentionRecord)[] = [];
  let tail = '';
  let query: string | null = null;
  const snap = (delay: number) =>
    out.push({ frame: { commit: [...commit], tail, query }, delay });

  snap(700);
  for (const ch of 'Biggest open deal is ') {
    tail += ch;
    snap(TYPE);
  }
  commit = [tail];
  tail = '';

  for (const q of ['@', '@h', '@ha', '@har', '@hart']) {
    query = q;
    snap(TYPE);
  }
  snap(HOLD);
  query = null;
  commit = [...commit, MENTION_HARTWELL];
  snap(SELECT);

  for (const ch of ' — closing this quarter.') {
    tail += ch;
    snap(TYPE);
  }
  commit = [...commit, tail];
  tail = '';
  snap(2600);

  // Clear in one beat (select-all + delete) rather than character-by-character
  // backspacing — the doc spends half a second empty instead of two.
  commit = [];
  snap(520);
  return out;
}

const MENTION_DOC_FRAMES = buildMentionDocFrames();

export function MentionsGraphic() {
  const compact = () => mobile();
  const [frame, setFrame] = createSignal<MentionDocFrame>(MENTION_DOC_STATIC);

  onMount(() => {
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const step = MENTION_DOC_FRAMES[index];
      setFrame(step.frame);
      index = (index + 1) % MENTION_DOC_FRAMES.length;
      timer = setTimeout(tick, step.delay);
    };
    tick();
    onCleanup(() => clearTimeout(timer));
  });

  const query = () => (frame().query ?? '').replace('@', '').toLowerCase();
  // The real typeahead's section groups, filtered live by the typed query.
  const docMentionSections = (): CrmMenuSection[] => [
    {
      label: 'Companies',
      count: 3,
      rows: mentionMenu
        .filter((m) => m.kind === 'company')
        .map((m) => ({ kind: m.kind, label: m.label }))
        .filter((m) => m.label.toLowerCase().includes(query())),
    },
    {
      label: 'People',
      count: 8,
      rows: mentionMenu
        .filter((m) => m.kind === 'contact')
        .map((m) => ({
          ...m,
          detail: `${m.label.split(' ')[0].toLowerCase()}@hartwell.com`,
        }))
        .filter((m) => m.label.toLowerCase().includes(query())),
    },
  ];
  const docMenuOpen = () =>
    frame().query !== null &&
    docMentionSections().some((s) => s.rows.length > 0);

  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: compact() ? '32px 18px' : '44px 24px',
        width: '100%',
      }}
    >
      <style>{crmMotionStyles}</style>
      {/* Composer with @ menu */}
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '14px',
          'box-shadow': 'var(--shadow-panel-wide)',
          'box-sizing': 'border-box',
          'min-height': compact() ? '236px' : '268px',
          position: 'relative',
          width: 'min(520px, 100%)',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '8px',
            padding: '13px 18px',
          }}
        >
          <DocFileGlyph size={16} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '15px',
              'font-weight': '600',
            }}
          >
            Q3 pipeline review
          </span>
        </div>
        <div
          style={{
            'box-sizing': 'border-box',
            padding: compact() ? '18px' : '22px',
          }}
        >
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '15px' : '17px',
              'line-height': 1.6,
              'white-space': 'pre-wrap',
            }}
          >
            <For each={frame().commit}>
              {(seg) =>
                typeof seg === 'string' ? (
                  <span>{seg}</span>
                ) : (
                  <MentionPill
                    kind={seg.kind}
                    label={seg.label}
                    initials={seg.initials}
                  />
                )
              }
            </For>
            {frame().tail}
            <Show when={frame().query !== null}>
              <span
                style={{
                  'background-color':
                    'color-mix(in srgb, var(--a0) 16%, transparent)',
                  'border-radius': '4px',
                  color: 'var(--c1)',
                  padding: '1px 5px',
                }}
              >
                {frame().query}
              </span>
            </Show>
            <span
              aria-hidden="true"
              class="crm-caret"
              style={{
                'background-color': 'var(--c1)',
                display: 'inline-block',
                height: '18px',
                'margin-left': '1px',
                'vertical-align': 'text-bottom',
                width: '1.5px',
              }}
            />
          </span>
        </div>
        {/* The real @ typeahead, anchored under the query */}
        <Show when={docMenuOpen()}>
          <div
            style={{
              left: compact() ? '14px' : '20px',
              position: 'absolute',
              right: compact() ? '14px' : '20px',
              top: compact() ? '92px' : '100px',
            }}
          >
            <CrmMentionMenu sections={docMentionSections()} />
          </div>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto-enriched — the details rail fills itself in. Two rows carry a slow
// "just filled" wash so the enrichment reads as live, not typed by a human.
// ---------------------------------------------------------------------------

const enrichedRows: {
  label: string;
  value: string;
  glyph?: 'globe';
  fresh?: boolean;
}[] = [
  { label: 'Domain', value: 'hartwell.com', glyph: 'globe' },
  { label: 'Industry', value: 'Developer tools' },
  { label: 'Headcount', value: '237', fresh: true },
  { label: 'HQ', value: 'Austin, TX' },
  { label: 'Last raise', value: 'Series B · $34M', fresh: true },
];

export function EnrichedDetailsGraphic() {
  const compact = () => mobile();
  const keyStyle: JSX.CSSProperties = {
    color: 'var(--c4)',
    'font-family': appFont,
    'font-size': '12.5px',
    flex: 'none',
    width: '88px',
  };
  const valStyle: JSX.CSSProperties = {
    'align-items': 'center',
    color: 'var(--c1)',
    display: 'flex',
    'font-family': appFont,
    'font-size': '12.5px',
    gap: '7px',
    'min-width': 0,
  };
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: compact() ? '32px 18px' : '44px 24px',
        width: '100%',
      }}
    >
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes crmEnrichWash {
            0%, 55%, 100% { background-color: transparent; }
            70%, 85% { background-color: color-mix(in srgb, var(--a0) 7%, transparent); }
          }
          .crm-enrich-fresh { animation: crmEnrichWash 6.4s ease-in-out infinite; }
          .crm-enrich-fresh--late { animation-delay: 1.1s; }
        }
      `}</style>
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(380px, 100%)',
        }}
      >
        {/* Record header */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '10px',
            padding: '11px 14px',
          }}
        >
          <CompanyBadge size={26} radius={7} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
              'font-weight': '600',
            }}
          >
            Hartwell
          </span>
          <span
            style={{
              'align-items': 'center',
              color: 'var(--c4)',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '11.5px',
              gap: '5px',
              'margin-left': 'auto',
            }}
          >
            <ChevronGlyph size={11} /> Details
          </span>
        </div>
        {/* Enriched fields */}
        <div style={{ display: 'grid', padding: '8px 0' }}>
          <For each={enrichedRows}>
            {(row, i) => (
              <div
                class={
                  row.fresh
                    ? `crm-enrich-fresh${i() > 2 ? ' crm-enrich-fresh--late' : ''}`
                    : undefined
                }
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  gap: '12px',
                  padding: '8px 14px',
                }}
              >
                <span style={keyStyle}>{row.label}</span>
                <span style={valStyle}>
                  <Show when={row.glyph === 'globe'}>
                    <span
                      style={{ color: 'var(--c4)', display: 'inline-flex' }}
                    >
                      <GlobeGlyph size={13} />
                    </span>
                  </Show>
                  <span
                    style={{
                      overflow: 'hidden',
                      'text-overflow': 'ellipsis',
                      'white-space': 'nowrap',
                    }}
                  >
                    {row.value}
                  </span>
                </span>
                <Show when={row.fresh}>
                  <span
                    style={{
                      color: 'var(--a0)',
                      display: 'inline-flex',
                      flex: 'none',
                      'margin-left': 'auto',
                    }}
                  >
                    <SparkleGlyph size={12} />
                  </span>
                </Show>
              </div>
            )}
          </For>
        </div>
        {/* Audit line */}
        <div
          style={{
            'align-items': 'center',
            'border-top':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            color: 'var(--c4)',
            display: 'flex',
            'font-family': appFont,
            'font-size': '12px',
            gap: '7px',
            padding: '10px 14px',
          }}
        >
          <SparkleGlyph size={12} color="var(--a0)" />
          Filled in by the agent · 2 min ago
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared by default — the Team / Me toggle over the account list
// ---------------------------------------------------------------------------

const teamAccounts: { name: string; stage: string; people: string[] }[] = [
  { name: 'Hartwell', stage: 'Enterprise pilot', people: ['SC', 'ML', 'PN'] },
  { name: 'Northbeam', stage: 'Renewal · Q3', people: ['JB', 'JW'] },
  { name: 'Acme Robotics', stage: 'New lead', people: ['SC'] },
];

export function TeamSharingGraphic() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: compact() ? '32px 18px' : '44px 24px',
        width: '100%',
      }}
    >
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(400px, 100%)',
        }}
      >
        {/* Header: Team | Me segmented control */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '10px',
            padding: '10px 14px',
          }}
        >
          <span
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--c4) 10%, transparent)',
              'border-radius': '8px',
              display: 'inline-flex',
              padding: '2px',
            }}
          >
            <span
              style={{
                'background-color':
                  'color-mix(in srgb, var(--c1) 10%, var(--b1))',
                'border-radius': '6px',
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '12px',
                'font-weight': '600',
                padding: '4px 12px',
              }}
            >
              Team
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '12px',
                padding: '4px 12px',
              }}
            >
              Me
            </span>
          </span>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '11.5px',
              'margin-left': 'auto',
            }}
          >
            28 accounts
          </span>
        </div>
        <For each={teamAccounts}>
          {(account, i) => (
            <div
              style={{
                'align-items': 'center',
                'border-bottom':
                  i() === teamAccounts.length - 1
                    ? '0'
                    : '1px solid color-mix(in srgb, var(--c4) 8%, transparent)',
                display: 'flex',
                gap: '11px',
                padding: '11px 14px',
              }}
            >
              <CompanyBadge size={26} radius={7} />
              <div style={{ display: 'grid', gap: '1px', 'min-width': 0 }}>
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': '13px',
                    'font-weight': '600',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'white-space': 'nowrap',
                  }}
                >
                  {account.name}
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '11.5px',
                  }}
                >
                  {account.stage}
                </span>
              </div>
              <span
                style={{
                  'align-items': 'center',
                  display: 'inline-flex',
                  'margin-left': 'auto',
                }}
              >
                <For each={account.people}>
                  {(initials, p) => (
                    <span
                      style={{
                        'border-radius': '999px',
                        'box-shadow': '0 0 0 2px #0a0a0a',
                        display: 'inline-flex',
                        'margin-left': p() === 0 ? '0' : '-6px',
                      }}
                    >
                      <Avatar
                        initials={initials}
                        size={20}
                        color={p() % 2 ? 'var(--b4)' : 'var(--b3)'}
                      />
                    </span>
                  )}
                </For>
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent flags risk — a proactive nudge before a deal slips
// ---------------------------------------------------------------------------

export function RiskFlagGraphic() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: compact() ? '32px 18px' : '44px 24px',
        width: '100%',
      }}
    >
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(420px, 100%)',
        }}
      >
        {/* Agent header */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '9px',
            padding: '11px 14px',
          }}
        >
          <span
            style={{
              'align-items': 'center',
              background:
                'linear-gradient(135deg, var(--a0), color-mix(in srgb, var(--a0) 55%, var(--b0)))',
              'border-radius': '999px',
              color: 'var(--b0)',
              display: 'inline-flex',
              flex: 'none',
              height: '22px',
              'justify-content': 'center',
              width: '22px',
            }}
          >
            <SparkleGlyph size={13} />
          </span>
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13px',
              'font-weight': '600',
            }}
          >
            Macro Agent
          </span>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '11.5px',
              'margin-left': 'auto',
            }}
          >
            flagged 1 account
          </span>
        </div>
        {/* Flag body */}
        <div
          style={{
            display: 'grid',
            gap: '12px',
            padding: compact() ? '14px' : '16px',
          }}
        >
          <p
            style={{
              color: 'var(--c2)',
              'font-family': appFont,
              'font-size': compact() ? '13px' : '14px',
              'line-height': 1.6,
              margin: 0,
            }}
          >
            <MentionPill kind="company" label="Hartwell" /> may be slipping — no
            reply from{' '}
            <MentionPill kind="contact" label="Sarah" initials="SC" /> in 12
            days, and the pilot decision is due Friday.
          </p>
          <div style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}>
            <span
              style={{
                'align-items': 'center',
                'background-color':
                  'color-mix(in srgb, var(--a0) 14%, transparent)',
                'border-radius': '7px',
                color: 'var(--a0)',
                display: 'inline-flex',
                'font-family': appFont,
                'font-size': '12.5px',
                'font-weight': '600',
                gap: '6px',
                padding: '6px 12px',
              }}
            >
              Draft follow-up
            </span>
            <span
              style={{
                'align-items': 'center',
                border:
                  '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
                'border-radius': '7px',
                color: 'var(--c2)',
                display: 'inline-flex',
                'font-family': appFont,
                'font-size': '12.5px',
                gap: '6px',
                padding: '6px 12px',
              }}
            >
              Snooze
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// @Macro agent uses the CRM as context
// ---------------------------------------------------------------------------

function SearchTinyGlyph(props: { size?: number }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <circle
        cx="11"
        cy="11"
        r="6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
      <path
        d="M20 20l-4-4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  );
}

function CheckTinyGlyph(props: { size?: number }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M5 12l4.5 4.5L19 7"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function FunnelTinyGlyph(props: { size?: number }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M4 5h16l-6 7v6l-4 2v-8z"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
  );
}

const crmReasoningSteps = [
  { label: 'Scanning Hartwell emails', icon: <SearchTinyGlyph size={11} /> },
  { label: 'Found 6 calls · 4 open tasks', icon: <CheckTinyGlyph size={11} /> },
  { label: 'Reading Monday call notes', icon: <FunnelTinyGlyph size={11} /> },
  { label: 'Thought for 18 seconds', icon: <SparkleGlyph size={11} /> },
];

// The agent reply is streamed like an LLM chat: the intro sentence types out
// token by token, then the snapshot card drops in and its bullets stream in.
const CRM_INTRO_TEXT = "Pilot is approved. Here's the snapshot:";
const crmIntroTokens = CRM_INTRO_TEXT.match(/\s*\S+\s*/g) ?? [CRM_INTRO_TEXT];

type CrmBodyToken =
  | { t: 'text'; v: string }
  | { t: 'pill'; kind: MentionKind; label: string; initials?: string };

// Split text segments into word tokens (mentions stay atomic) so the snapshot
// bullets stream a word at a time, the way a model emits tokens.
function tokenizeCrmBody(parts: CrmBodyToken[]): CrmBodyToken[] {
  const out: CrmBodyToken[] = [];
  for (const part of parts) {
    if (part.t === 'pill') {
      out.push(part);
      continue;
    }
    for (const word of part.v.match(/\s*\S+\s*/g) ?? [part.v]) {
      out.push({ t: 'text', v: word });
    }
  }
  return out;
}

const crmRawBodyLines: CrmBodyToken[][] = [
  [
    { t: 'text', v: '200 seats approved in ' },
    { t: 'pill', kind: 'call', label: 'Monday call' },
  ],
  [
    { t: 'text', v: 'Security docs due: ' },
    { t: 'pill', kind: 'task', label: 'PRJ-204' },
  ],
  [
    { t: 'text', v: 'Legal review: ' },
    { t: 'pill', kind: 'doc', label: 'Mutual NDA' },
  ],
];
const crmBodyLines: CrmBodyToken[][] = crmRawBodyLines.map(tokenizeCrmBody);

const crmBodyFlat = crmBodyLines.flat();
const crmBodyTotal = crmBodyFlat.length;

type CrmStage = {
  steps: number;
  intro: number;
  card: boolean;
  body: number;
  done: boolean;
};

const CRM_STAGE_EMPTY: CrmStage = {
  steps: 0,
  intro: 0,
  card: false,
  body: 0,
  done: false,
};
const CRM_STAGE_FULL: CrmStage = {
  steps: crmReasoningSteps.length,
  intro: crmIntroTokens.length,
  card: true,
  body: crmBodyTotal,
  done: true,
};

// One linear script: hold on the question, reveal the thinking steps one by
// one, type the reply, drop in the card, then stream its bullets before
// returning to the prompt and replaying.
function buildCrmAgentFrames(): { stage: CrmStage; delay: number }[] {
  const out: { stage: CrmStage; delay: number }[] = [];
  const stage: CrmStage = { ...CRM_STAGE_EMPTY };
  const snap = (delay: number) => out.push({ stage: { ...stage }, delay });

  snap(620); // beat on the question before the agent starts thinking
  for (let s = 1; s <= crmReasoningSteps.length; s++) {
    stage.steps = s;
    snap(s === crmReasoningSteps.length ? 560 : 470);
  }
  for (let i = 1; i <= crmIntroTokens.length; i++) {
    stage.intro = i;
    snap(58);
  }
  snap(340); // beat before the snapshot card drops in
  stage.card = true;
  snap(440);
  for (let i = 1; i <= crmBodyTotal; i++) {
    stage.body = i;
    snap(crmBodyFlat[i - 1].t === 'pill' ? 150 : 54);
  }
  stage.done = true;
  snap(0);
  return out;
}

const CRM_AGENT_FRAMES = buildCrmAgentFrames();

function renderCrmBodyToken(tok: CrmBodyToken) {
  if (tok.t === 'pill') {
    return (
      <MentionPill kind={tok.kind} label={tok.label} initials={tok.initials} />
    );
  }
  return tok.v;
}

export function CrmAgentPanel(
  props: { height?: string; bottomAnchor?: boolean; header?: JSX.Element } = {}
) {
  const compact = () => true;
  let rootEl: HTMLDivElement | undefined;
  let contentEl: HTMLDivElement | undefined;
  const visible = createVisible(() => rootEl);
  const prefersReduced =
    !isServer &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [stage, setStage] = createSignal<CrmStage>(
    isServer || prefersReduced ? CRM_STAGE_FULL : CRM_STAGE_EMPTY
  );

  onMount(() => {
    if (prefersReduced) return;
    let index = 0;
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shiftFrame: number | undefined;
    const setAnimatedStage = (nextStage: CrmStage) => {
      if (!props.bottomAnchor || !contentEl) {
        setStage(nextStage);
        return;
      }

      contentEl.getAnimations().forEach((animation) => animation.cancel());
      const beforeTop = contentEl.getBoundingClientRect().top;
      setStage(nextStage);
      shiftFrame = requestAnimationFrame(() => {
        if (!contentEl) return;
        const shift = beforeTop - contentEl.getBoundingClientRect().top;
        if (shift > 0.5) {
          contentEl.animate(
            [
              { transform: `translateY(${shift}px)` },
              { transform: 'translateY(0)' },
            ],
            { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
          );
        }
      });
    };
    const tick = () => {
      const frame = CRM_AGENT_FRAMES[index];
      setAnimatedStage(frame.stage);
      index += 1;
      if (index < CRM_AGENT_FRAMES.length) {
        timer = setTimeout(tick, frame.delay);
      } else {
        index = 0;
        timer = setTimeout(tick, 3200);
      }
    };
    createEffect(() => {
      if (visible() && !started) {
        started = true;
        tick();
      }
    });
    onCleanup(() => {
      if (timer) clearTimeout(timer);
      if (shiftFrame) cancelAnimationFrame(shiftFrame);
      contentEl?.getAnimations().forEach((animation) => animation.cancel());
    });
  });

  const bodyText: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-family': appFont,
    'font-size': compact() ? '12.5px' : '13.5px',
    'line-height': 1.5,
    margin: 0,
  };

  // How many tokens of bullet `b` are revealed at the current stage.
  const revealedInBullet = (b: number) => {
    let remaining = stage().body;
    for (let i = 0; i < b; i++) remaining -= crmBodyLines[i].length;
    return Math.max(0, Math.min(remaining, crmBodyLines[b].length));
  };
  const activeBullet = () => {
    for (let b = crmBodyLines.length - 1; b >= 0; b--) {
      if (revealedInBullet(b) > 0) return b;
    }
    return -1;
  };
  const introCaret = () => !stage().card && stage().intro > 0;
  const bodyCaret = () => stage().card && !stage().done;

  return (
    // One solid surface: the trace and typed recap sit on their own card, so
    // the lifted panel stays legible over a dimmed window behind it.
    <div
      ref={rootEl}
      style={{
        'background-color': '#0a0a0a',
        border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
        'border-radius': '14px',
        'box-shadow': props.bottomAnchor ? 'none' : 'var(--shadow-panel-md)',
        'box-sizing': 'border-box',
        display: 'grid',
        'align-content': props.bottomAnchor ? 'end' : undefined,
        gap: '12px',
        height: props.height,
        'mask-image': props.bottomAnchor
          ? 'linear-gradient(to bottom, #000 0%, #000 76%, transparent 100%)'
          : undefined,
        '-webkit-mask-image': props.bottomAnchor
          ? 'linear-gradient(to bottom, #000 0%, #000 76%, transparent 100%)'
          : undefined,
        overflow: props.height ? 'hidden' : undefined,
        padding: props.header
          ? props.bottomAnchor
            ? '60px 14px 90px'
            : '60px 14px 14px'
          : '14px',
        position: 'relative',
        'text-align': 'left',
        width: '100%',
      }}
    >
      <style>{`
          @keyframes crmagentTokIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes crmagentStepIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
          @keyframes crmagentCardIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
          @keyframes crmagentCaret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
          .crmagent-tok { animation: crmagentTokIn 200ms ease both; }
          .crmagent-step { animation: crmagentStepIn 320ms cubic-bezier(0.4, 0, 0.2, 1) both; }
          .crmagent-card { animation: crmagentCardIn 380ms cubic-bezier(0.4, 0, 0.2, 1) both; }
          .crmagent-caret {
            background: var(--c3);
            border-radius: 1px;
            display: inline-block;
            height: 1em;
            margin-left: 1.5px;
            vertical-align: -0.16em;
            width: 2px;
            animation: crmagentCaret 1s steps(1, end) infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .crmagent-tok, .crmagent-step, .crmagent-card { animation: none; }
          .crmagent-caret { display: none; }
          }
        `}</style>
      <Show when={props.header}>
        <div
          style={{
            'align-items': 'center',
            'background-color': '#0a0a0a',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--b4) 36%, transparent)',
            'border-radius': '13px 13px 0 0',
            'box-sizing': 'border-box',
            height: '46px',
            left: 0,
            position: 'absolute',
            right: 0,
            top: 0,
            'z-index': 1,
          }}
        >
          {props.header}
        </div>
      </Show>
      <div ref={contentEl} style={{ display: 'grid', gap: '12px' }}>
        <div
          style={{
            'background-color': 'color-mix(in srgb, var(--b1) 92%, var(--c1))',
            border: '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
            'border-radius': '14px 14px 4px 14px',
            'box-sizing': 'border-box',
            'justify-self': 'end',
            'margin-bottom': '18px',
            'max-width': '84%',
            padding: '11px 14px',
            position: 'relative',
          }}
        >
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '13px' : '14px',
              'line-height': 1.5,
            }}
          >
            What's the latest with{' '}
            <MentionPill
              kind="company"
              label="Hartwell"
              companyIconColor="var(--c3)"
            />
            ? Need a recap before today's{' '}
            <span
              style={{
                'align-items': 'center',
                'background-color':
                  'color-mix(in srgb, var(--c4) 12%, transparent)',
                'border-radius': '5px',
                color: 'var(--c2)',
                display: 'inline-flex',
                'font-weight': '600',
                gap: '4px',
                padding: '1px 6px',
                'white-space': 'nowrap',
              }}
            >
              2pm call
            </span>
            .
          </span>
          <span
            aria-hidden="true"
            style={{
              'background-color':
                'color-mix(in srgb, var(--b1) 92%, var(--c1))',
              'border-right':
                '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
              'border-bottom':
                '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
              bottom: '-6px',
              height: '11px',
              position: 'absolute',
              right: '14px',
              transform: 'rotate(45deg)',
              width: '11px',
            }}
          />
        </div>

        <div style={{ display: 'grid', gap: '10px' }}>
          <div
            style={{
              display: 'grid',
              'grid-template-columns': '18px 1fr',
              'column-gap': '10px',
            }}
          >
            <For each={crmReasoningSteps}>
              {(step, i) => (
                <Show when={i() < stage().steps}>
                  <div
                    class="crmagent-step"
                    style={{
                      'align-items': 'center',
                      display: 'flex',
                      'flex-direction': 'column',
                      'row-gap': '3px',
                    }}
                  >
                    <span
                      style={{
                        'align-items': 'center',
                        'background-color':
                          'color-mix(in srgb, var(--c1) 8%, transparent)',
                        'border-radius': '999px',
                        color: 'var(--c2)',
                        display: 'inline-flex',
                        flex: 'none',
                        height: '18px',
                        'justify-content': 'center',
                        width: '18px',
                      }}
                    >
                      {step.icon}
                    </span>
                    <Show when={i() < crmReasoningSteps.length - 1}>
                      <span
                        aria-hidden="true"
                        style={{
                          'background-color':
                            'color-mix(in srgb, var(--c1) 22%, transparent)',
                          'border-radius': '1px',
                          flex: '1',
                          'min-height': '14px',
                          width: '2px',
                        }}
                      />
                    </Show>
                  </div>
                  <span
                    class="crmagent-step"
                    style={{
                      'align-self': 'center',
                      color:
                        i() === crmReasoningSteps.length - 1
                          ? 'var(--c2)'
                          : 'var(--c4)',
                      'font-family': appFont,
                      'font-size': '12.5px',
                      'line-height': 1.4,
                      'padding-bottom':
                        i() < crmReasoningSteps.length - 1 ? '16px' : '0',
                    }}
                  >
                    {step.label}
                  </span>
                </Show>
              )}
            </For>
          </div>

          <Show when={stage().intro > 0}>
            <p
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': compact() ? '12.5px' : '13.5px',
                'line-height': 1.5,
                margin: 0,
              }}
            >
              <Index each={crmIntroTokens.slice(0, stage().intro)}>
                {(tok) => <span class="crmagent-tok">{tok()}</span>}
              </Index>
              <Show when={introCaret()}>
                <span class="crmagent-caret" aria-hidden="true" />
              </Show>
            </p>
          </Show>
        </div>

        <Show when={stage().card}>
          <div
            class="crmagent-card"
            style={{
              'background-color':
                'color-mix(in srgb, var(--b1) 94%, var(--c1))',
              border:
                '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
              'border-radius': '10px',
              'box-shadow': 'var(--shadow-panel-sm)',
              'box-sizing': 'border-box',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                'align-items': 'center',
                'border-bottom':
                  '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                display: 'flex',
                gap: '10px',
                padding: '11px 14px',
              }}
            >
              <IconCompany
                style={{
                  color: 'var(--c3)',
                  display: 'block',
                  flex: 'none',
                  height: '15px',
                  width: '15px',
                }}
              />
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '13.5px',
                  'font-weight': '600',
                }}
              >
                Hartwell
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '12px',
                  'margin-left': 'auto',
                }}
              >
                Enterprise pilot
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gap: '8px',
                padding: '14px 14px 16px',
              }}
            >
              <p
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '12.5px',
                  'font-weight': '500',
                  'line-height': 1.4,
                  margin: 0,
                }}
              >
                Pilot approved — close items remain.
              </p>
              <ul
                style={{
                  ...bodyText,
                  color: 'var(--c2)',
                  display: 'grid',
                  gap: '7px',
                  margin: 0,
                  'padding-left': '18px',
                }}
              >
                <For each={crmBodyLines}>
                  {(line, b) => (
                    <Show when={revealedInBullet(b()) > 0}>
                      <li style={{ 'white-space': 'nowrap' }}>
                        <Index each={line.slice(0, revealedInBullet(b()))}>
                          {(tok) => (
                            <span class="crmagent-tok">
                              {renderCrmBodyToken(tok())}
                            </span>
                          )}
                        </Index>
                        <Show when={bodyCaret() && activeBullet() === b()}>
                          <span class="crmagent-caret" aria-hidden="true" />
                        </Show>
                      </li>
                    </Show>
                  )}
                </For>
              </ul>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

export function CrmAgentGraphic() {
  return (
    <PhoneFrame>
      <PhoneScreenContent>
        <CrmAgentPanel />
      </PhoneScreenContent>
    </PhoneFrame>
  );
}

// ---------------------------------------------------------------------------
// Comparison table (Macro vs Salesforce vs HubSpot vs Attio)
// ---------------------------------------------------------------------------

type Cell = boolean | 'partial' | string;

const comparisonColumns = ['Macro', 'Salesforce', 'HubSpot', 'Attio'];

const comparisonRows: { feature: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  {
    feature: 'Builds itself from your email (no data entry)',
    cells: [true, false, 'partial', 'partial'],
  },
  {
    feature: 'Automatic company enrichment',
    cells: [true, 'partial', true, true],
  },
  {
    feature: 'Discussion threads on every record',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: '@mention records in docs, tasks & chat',
    cells: [true, false, false, false],
  },
  {
    feature: 'One customer view across email, calls, docs & tasks',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: 'Built-in email, calls, docs & tasks',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: 'Agents with full-workspace context',
    cells: [true, 'partial', 'partial', 'partial'],
  },
  {
    feature: 'Unified search across everything',
    cells: [true, false, false, false],
  },
  { feature: 'Open source (AGPLv3)', cells: [true, false, false, false] },
  { feature: 'Price / seat / month', cells: ['$40', '$165', '$90', '$34'] },
];

function CheckMark() {
  return (
    <svg
      width="16"
      height="13"
      viewBox="0 0 16 13"
      aria-label="Yes"
      role="img"
      style={{ display: 'block' }}
    >
      <path
        d="M1.5 6.5 L5.8 11 L14.5 1.6"
        fill="none"
        stroke="var(--a0)"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
function PartialMark() {
  return (
    <span
      aria-label="Partial"
      role="img"
      style={{
        'background-color': 'color-mix(in srgb, var(--c4) 55%, transparent)',
        'border-radius': '999px',
        display: 'block',
        height: '4px',
        width: '14px',
      }}
    />
  );
}
function CrossMark() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      aria-label="No"
      role="img"
      style={{ display: 'block', opacity: 0.45 }}
    >
      <path
        d="M2 2 L11 11 M11 2 L2 11"
        fill="none"
        stroke="var(--c4)"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

function ComparisonCell(props: { value: Cell; macro: boolean }) {
  const isPrice = () =>
    typeof props.value === 'string' && props.value !== 'partial';
  return (
    <div
      style={{
        'align-items': 'center',
        display: 'flex',
        'justify-content': 'center',
        'min-height': '22px',
      }}
    >
      <Show
        when={isPrice()}
        fallback={
          <Show
            when={props.value === true}
            fallback={
              <Show when={props.value === 'partial'} fallback={<CrossMark />}>
                <PartialMark />
              </Show>
            }
          >
            <CheckMark />
          </Show>
        }
      >
        <span
          style={{
            color: props.macro ? 'var(--a0)' : 'var(--c2)',
            'font-family': 'rajdhani, body',
            'font-size': mobile() ? '13px' : '15px',
            'font-weight': '700',
            'letter-spacing': '0.02em',
            'white-space': 'nowrap',
          }}
        >
          {props.value as string}
        </span>
      </Show>
    </div>
  );
}

function _ComparisonTable() {
  const gridTemplate = () =>
    mobile()
      ? 'minmax(160px, 1.6fr) repeat(4, minmax(58px, 1fr))'
      : 'minmax(0, 2.4fr) repeat(4, minmax(0, 1fr))';

  const headerCellStyle = (macro: boolean): JSX.CSSProperties => ({
    'align-items': 'center',
    'background-color': macro
      ? 'color-mix(in srgb, var(--a0) 12%, var(--b0))'
      : 'transparent',
    color: macro ? 'var(--a0)' : 'var(--c2)',
    display: 'flex',
    'font-family': 'rajdhani, body',
    'font-size': mobile() ? '12px' : '15px',
    'font-weight': '700',
    'justify-content': 'center',
    'letter-spacing': '0.04em',
    'line-height': 1.1,
    padding: mobile() ? '14px 6px' : '18px 12px',
    'text-align': 'center',
    'text-transform': 'uppercase',
  });

  return (
    <div
      style={{
        'overflow-x': mobile() ? 'auto' : 'visible',
        width: '100%',
        'min-width': '0',
        'max-width': '100%',
        '-webkit-overflow-scrolling': 'touch',
      }}
    >
      <div
        style={{
          border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': gridTemplate(),
          'min-width': mobile() ? '520px' : 'auto',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            'background-color': 'var(--b0)',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          }}
        />
        <For each={comparisonColumns}>
          {(col, index) => (
            <div
              style={{
                ...headerCellStyle(index() === 0),
                'border-bottom':
                  index() === 0
                    ? '1px solid var(--a0)'
                    : '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
              }}
            >
              {col}
            </div>
          )}
        </For>

        <For each={comparisonRows}>
          {(row, rowIndex) => (
            <>
              <div
                style={{
                  'align-items': 'center',
                  'background-color': 'var(--b0)',
                  'border-bottom':
                    rowIndex() === comparisonRows.length - 1
                      ? '0'
                      : '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  color: 'var(--c2)',
                  display: 'flex',
                  'font-size': mobile() ? '13px' : '16px',
                  'line-height': 1.25,
                  padding: mobile() ? '13px 12px 13px 14px' : '15px 20px',
                  position: mobile() ? 'sticky' : 'static',
                  left: mobile() ? '0' : 'auto',
                  'z-index': mobile() ? 1 : 'auto',
                }}
              >
                {row.feature}
              </div>
              <For each={row.cells}>
                {(cell, cellIndex) => (
                  <div
                    style={{
                      'align-items': 'center',
                      'background-color':
                        cellIndex() === 0
                          ? 'color-mix(in srgb, var(--a0) 7%, var(--b0))'
                          : 'var(--b0)',
                      'border-bottom':
                        rowIndex() === comparisonRows.length - 1
                          ? '0'
                          : '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                      'border-left':
                        cellIndex() === 0
                          ? '1px solid color-mix(in srgb, var(--a0) 28%, transparent)'
                          : '0',
                      'border-right':
                        cellIndex() === 0
                          ? '1px solid color-mix(in srgb, var(--a0) 28%, transparent)'
                          : '0',
                      display: 'flex',
                      'justify-content': 'center',
                      padding: mobile() ? '13px 6px' : '15px 12px',
                    }}
                  >
                    <ComparisonCell value={cell} macro={cellIndex() === 0} />
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const faqItems: { q: string; a: JSX.Element }[] = [
  {
    q: 'Do I have to enter data into the CRM?',
    a: (
      <>
        No, that's the whole point. Because your team's email already flows
        through Macro, contact and company records are created and kept up to
        date automatically as you work. There's no importer to run and no fields
        to type in. Most CRMs die because nobody fills them in. Macro's fills
        itself.
      </>
    ),
  },
  {
    q: 'How are companies and contacts created?',
    a: (
      <>
        When someone on your team emails an external contact, Macro creates a
        contact record and groups contacts into companies by email domain, so
        everyone <code>@acme.com</code> rolls up to one Acme record. Each
        contact tracks its first and last interaction, and generic vendor / tool
        domains are filtered out so the CRM stays focused on your actual
        customers.
      </>
    ),
  },
  {
    q: 'What is automatic enrichment?',
    a: (
      <>
        New companies are enriched with public data: name, description, logo,
        website, industry, headcount, funding, location, and social links. A
        useful record exists the moment the company appears, without anyone
        touching it.
      </>
    ),
  },
  {
    q: 'How do discussion threads work?',
    a: (
      <>
        Every company and contact has its own discussion thread, so deal notes
        and context live on the record itself instead of a side channel. Threads
        work just like Macro channels, with inline replies, the same rich
        editor, and @mentions of people, docs, tasks, and other records.
      </>
    ),
  },
  {
    q: 'Can I @mention a company or contact elsewhere?',
    a: (
      <>
        Yes. Like everything in Macro, CRM records are blocks. @mention a
        company or contact in a doc, task, or channel and it becomes a live,
        traceable link. From the record you can see everywhere it's been
        referenced across channels, docs, and calls. Note that sharing of CRM
        records is controlled by your team, so @mentioning a record doesn't
        change who can see it.
      </>
    ),
  },
  {
    q: 'How does email sharing work?',
    a: (
      <>
        CRM is where Macro Mail's auto-sharing lives. With{' '}
        <strong>Sync Emails</strong> on for a company, your team's threads with
        that company become visible to teammates in the CRM, so nobody has to
        forward a thread to share context. Turn it off and the record stays, but
        its threads are private to their participants. Admins can also hide a
        company or contact entirely.
      </>
    ),
  },
  {
    q: 'Can agents use my CRM?',
    a: (
      <>
        Yes. Agents use your CRM as context like the rest of your team memory.
        Ask "what's the latest with Hartwell?" and the agent reads the company's
        emails, calls, tasks, and docs to answer, instead of you stitching the
        story together across tools.
      </>
    ),
  },
  {
    q: 'Is the CRM available yet, and is it open source?',
    a: (
      <>
        CRM is rolling out now. If you don't see the <strong>Companies</strong>{' '}
        view in your workspace yet, it hasn't reached your account. And like the
        rest of Macro, it's fully open source under the AGPLv3, not "open core."
        To build on Macro under a different license, contact{' '}
        <a href="mailto:licensing@macro.com">licensing@macro.com</a>.
      </>
    ),
  },
];

function _FaqSection() {
  return (
    <section
      aria-label="Frequently asked questions"
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '24px' : '40px',
        'justify-items': 'center',
        width: '100%',
      }}
    >
      <style>{`
        .crm-faq__item { border-bottom: 1px solid color-mix(in srgb, var(--c4) 10%, transparent); }
        .crm-faq__item > summary {
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
        .crm-faq__item > summary::-webkit-details-marker { display: none; }
        .crm-faq__item > summary .crm-faq__chevron { color: var(--c4); flex-shrink: 0; transition: transform 220ms ease; }
        .crm-faq__item[open] > summary .crm-faq__chevron { transform: rotate(180deg); }
        .crm-faq__answer { color: var(--c4); font-size: 16px; line-height: 1.6; margin: 0; padding: 0 4px 24px; max-width: 760px; }
        .crm-faq__answer a { color: var(--a0); text-decoration: none; }
        .crm-faq__answer code { background: color-mix(in srgb, var(--c4) 12%, transparent); border-radius: 4px; font-size: 13px; padding: 1px 5px; }
        @media (hover) {
          .crm-faq__item > summary:hover { color: var(--a0); }
          .crm-faq__answer a:hover { text-decoration: underline; }
        }
        @media (max-width: 700px) {
          .crm-faq__item > summary { font-size: 17px; padding: 18px 4px; }
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
        <h2
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            'font-size': mobile() ? '32px' : breakpoint() ? '38px' : '44px',
            'font-weight': '410',
            'letter-spacing': '-0.015em',
            'line-height': 1.1,
            margin: 0,
          }}
        >
          Questions, answered
        </h2>
      </div>
      <div
        style={{
          'border-top':
            '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          width: '100%',
          'max-width': '860px',
        }}
      >
        <For each={faqItems}>
          {(item) => (
            <details class="crm-faq__item">
              <summary>
                <span>{item.q}</span>
                <svg
                  class="crm-faq__chevron"
                  width="16"
                  height="16"
                  viewBox="0 0 256 256"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
                </svg>
              </summary>
              <p class="crm-faq__answer">{item.a}</p>
            </details>
          )}
        </For>
      </div>
    </section>
  );
}
