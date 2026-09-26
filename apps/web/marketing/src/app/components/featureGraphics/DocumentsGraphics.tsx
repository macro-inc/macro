import {
  type Component,
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import IconAi from '../../../assets/icons/icon-ai.svg';
import IconCall from '../../../assets/icons/icon-call.svg';
import IconChannels from '../../../assets/icons/icon-channels.svg';
import IconEmail from '../../../assets/icons/icon-email.svg';
import IconFolder from '../../../assets/icons/icon-folder.svg';
import IconGithub from '../../../assets/icons/icon-github.svg';
import IconHome from '../../../assets/icons/icon-home.svg';
import IconInbox from '../../../assets/icons/icon-inbox.svg';
import IconPlus from '../../../assets/icons/icon-plus.svg';
import IconSearch from '../../../assets/icons/icon-search.svg';
import IconTasks from '../../../assets/icons/icon-tasks.svg';
import StatusInProgress from '../../../assets/icons/square-task-in-progress-circle.svg';
import IconChannelMacro from '../../../assets/icons/wide-channel.svg';
import IconClaude from '../../../assets/icons/wide-claude.svg';
import IconFileMd from '../../../assets/icons/wide-file-md.svg';
import IconShareMacro from '../../../assets/icons/wide-share.svg';
import IconAgentStar from '../../../assets/icons/wide-star.svg';
import IconTaskMacro from '../../../assets/icons/wide-task.svg';
import avatarJulia from '../../../assets/people/julia.webp';
import { isMobileViewport } from '../../utils/utilBreakpoint';
import {
  CtaIcon,
  ctaHref,
  ctaLabel,
  handleCtaClick,
} from '../../utils/utilCta';
import { PREVIEW_INNER_BG, PreviewWindow } from '../graphics/PreviewWindow';
import { LiveDocEditor, TryMePointer } from '../utils/UtilLiveEditor';
import { PhoneFrame, PhoneScreenContent } from '../utils/UtilPhoneFrame';

const _HERO_DEMO_VIDEO_ID = 'hyU1XYmxkYM'; // "What We Learned from Notion"
const MACRO_REPO_URL = 'https://github.com/macro-inc/macro';

// ---------------------------------------------------------------------------
// Shared style fragments (matching the homepage / email / tasks bento language)
// ---------------------------------------------------------------------------

const mobile = isMobileViewport;

// Faux-app chrome uses a neutral UI sans so the mocks read as real product
// screenshots rather than marketing copy.
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Linear-style surface stack above page bg (--b0).
const docsSurfaceL1 = '#080808';
const docsSurfaceL2 = '#0a0a0a';
const docsPanelBorder = 'color-mix(in srgb, var(--c4) 10%, transparent)';

// Per-collaborator accent colors reused across the realtime / mention mocks.
const COLLAB_A = 'var(--a0)';
const COLLAB_B = 'var(--a2)';
const COLLAB_C = 'var(--a4)';

function _ConnectGoogleButton(props: { buttonName: string; large?: boolean }) {
  return (
    <a
      href={ctaHref()}
      class="docs-cta-button"
      onClick={(event) => handleCtaClick(event, props.buttonName)}
      style={{
        'align-items': 'center',
        'background-color': 'var(--a0)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--b0)',
        cursor: 'default',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': mobile() ? '15px' : props.large ? '18px' : '16px',
        'font-weight': '700',
        gap: '8px',
        height: mobile() ? '40px' : props.large ? '42px' : '36px',
        'justify-content': 'center',
        'letter-spacing': '0.045em',
        'line-height': 1,
        overflow: 'hidden',
        padding: mobile() ? '0 20px' : props.large ? '0 26px' : '0 20px',
        'text-decoration': 'none',
        'text-transform': 'uppercase',
        transition: 'transform 160ms ease',
        'white-space': 'nowrap',
        width: mobile() ? '100%' : 'max-content',
      }}
    >
      <CtaIcon size={mobile() ? 16 : 15} />
      {ctaLabel('Connect with Google')}
    </a>
  );
}

function StarGlyph(props: { size?: number }) {
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
        d="M12 2.5l2.9 6.05 6.6.86-4.85 4.55 1.2 6.59L12 18.9l-5.85 2.65 1.2-6.59L2.5 9.41l6.6-.86z"
        fill="currentColor"
      />
    </svg>
  );
}

function formatStarCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

// "Star on GitHub" CTA. The star count is fetched client-side (onMount only, so
// it never runs during SSR / prerender) and revealed once loaded; the button
// reads fine without it for crawlers and no-JS visitors.
export function GithubStarButton() {
  const [stars, setStars] = createSignal<string | null>(null);
  onMount(() => {
    let cancelled = false;
    fetch('https://api.github.com/repos/macro-inc/macro')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || typeof data.stargazers_count !== 'number')
          return;
        setStars(formatStarCount(data.stargazers_count));
      })
      .catch(() => {});
    onCleanup(() => {
      cancelled = true;
    });
  });
  return (
    <a
      href={MACRO_REPO_URL}
      target="_blank"
      rel="noreferrer"
      class="docs-cta-button"
      style={{
        'align-items': 'center',
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--b4) 28%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        cursor: 'default',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': mobile() ? '14px' : '15px',
        'font-weight': '700',
        gap: '9px',
        height: mobile() ? '40px' : '38px',
        'justify-content': 'center',
        'letter-spacing': '0.045em',
        'line-height': 1,
        padding: '0 18px',
        'text-decoration': 'none',
        'text-transform': 'uppercase',
        transition: 'transform 160ms ease',
        'white-space': 'nowrap',
      }}
    >
      <IconGithub
        style={{
          display: 'block',
          flex: 'none',
          height: '17px',
          width: '17px',
        }}
      />
      Star on GitHub
      <Show when={stars()}>
        {(count) => (
          <>
            <span
              aria-hidden="true"
              style={{
                'background-color':
                  'color-mix(in srgb, var(--b4) 45%, transparent)',
                flex: 'none',
                height: '16px',
                width: '1px',
              }}
            />
            <span
              style={{
                'align-items': 'center',
                color: 'var(--c1)',
                display: 'inline-flex',
                'font-family': 'rajdhani, body',
                'font-size': mobile() ? '15px' : '16px',
                'font-weight': '700',
                gap: '5px',
                'letter-spacing': '0.02em',
              }}
            >
              <span style={{ color: 'var(--a0)', display: 'inline-flex' }}>
                <StarGlyph size={14} />
              </span>
              {count()}
            </span>
          </>
        )}
      </Show>
    </a>
  );
}

// ---------------------------------------------------------------------------
// App-chrome icons (Macro product nav set)
// ---------------------------------------------------------------------------

const NAV_ICONS: Record<string, Component<{ style?: JSX.CSSProperties }>> = {
  create: IconPlus,
  home: IconHome,
  inbox: IconInbox,
  search: IconSearch,
  agents: IconAi,
  email: IconEmail,
  files: IconFolder,
  tasks: IconTasks,
  channels: IconChannels,
  calls: IconCall,
};

function navIconStyle(props: {
  active?: boolean;
  accent?: boolean;
  size?: number;
}): JSX.CSSProperties {
  const s = props.size ?? 16;
  return {
    color: props.accent
      ? 'var(--a0)'
      : props.active
        ? 'var(--c1)'
        : 'var(--c4)',
    display: 'block',
    flex: 'none',
    height: `${s}px`,
    overflow: 'visible',
    width: `${s}px`,
  };
}

function MacroNavIcon(props: {
  name: string;
  active?: boolean;
  accent?: boolean;
  size?: number;
}) {
  const Icon = NAV_ICONS[props.name];
  if (!Icon) return null;
  return <Icon aria-hidden="true" style={navIconStyle(props)} />;
}

function Avatar(props: {
  initials: string;
  size?: number;
  color?: string;
  image?: string;
}) {
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
        overflow: 'hidden',
        'place-items': 'center',
        width: `${s}px`,
      }}
    >
      <Show when={props.image} fallback={props.initials}>
        <img
          src={props.image}
          alt=""
          width={s}
          height={s}
          style={{
            display: 'block',
            height: '100%',
            'object-fit': 'cover',
            width: '100%',
          }}
        />
      </Show>
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

function ShareGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 13;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M5 13v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M12 15V4M8 7.5 12 3.6 16 7.5"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// Numbered/checklist glyph for the "Task" toolbar action.
function _ListTaskGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
  const stroke = props.color ?? 'currentColor';
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M3.6 6.4l1.5 1.5 2.4-2.6M3.6 12.4l1.5 1.5 2.4-2.6M3.6 18.4l1.5 1.5 2.4-2.6"
        fill="none"
        stroke={stroke}
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M11.5 6.2h9M11.5 12.2h9M11.5 18.2h6"
        fill="none"
        stroke={stroke}
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>
  );
}

// Chain/link glyph for the "copy link" toolbar action.
function _LinkGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
  const stroke = props.color ?? 'currentColor';
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M10.2 13.8a4 4 0 0 0 5.66 0l2.3-2.3a4 4 0 1 0-5.66-5.66l-1.3 1.3"
        fill="none"
        stroke={stroke}
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M13.8 10.2a4 4 0 0 0-5.66 0l-2.3 2.3a4 4 0 1 0 5.66 5.66l1.3-1.3"
        fill="none"
        stroke={stroke}
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// Right-panel / split-view glyph for the toolbar.
function _PanelGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
  const stroke = props.color ?? 'currentColor';
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <rect
        x="3.5"
        y="5"
        width="17"
        height="14"
        rx="2.6"
        fill="none"
        stroke={stroke}
        stroke-width="1.7"
      />
      <path d="M14.5 5v14" fill="none" stroke={stroke} stroke-width="1.7" />
    </svg>
  );
}

function ClockTinyGlyph(props: { size?: number }) {
  const s = props.size ?? 13;
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
        r="8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
      />
      <path
        d="M12 8v4.4l3 1.8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// The little blue document icon used in the real Files list.
function DocFileGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 16;
  // Macro app document icon (wide-file-md), inherits color via currentColor.
  return (
    <IconFileMd
      aria-hidden="true"
      style={{
        color: props.color ?? 'var(--a0)',
        display: 'block',
        flex: 'none',
        height: `${s}px`,
        width: `${s}px`,
      }}
    />
  );
}

// Compact monochrome glyphs for the slash / block menu.
function BlockGlyph(props: { name: string; size?: number }) {
  const s = props.size ?? 16;
  const common = {
    width: s,
    height: s,
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    style: { display: 'block', flex: 'none' } as JSX.CSSProperties,
  };
  switch (props.name) {
    case 'text':
      return (
        <svg {...common}>
          <path
            d="M5 6h14 M5 11h14 M5 16h9"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
      );
    case 'todo':
      return (
        <svg {...common}>
          <rect
            x="4"
            y="4"
            width="16"
            height="16"
            rx="3"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
          />
          <path
            d="M8.5 12l2.4 2.4L16 9.4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      );
    case 'code':
      return (
        <svg {...common}>
          <path
            d="M9 8l-4 4 4 4 M15 8l4 4-4 4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      );
    case 'table':
      return (
        <svg {...common}>
          <rect
            x="4"
            y="5"
            width="16"
            height="14"
            rx="2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
          />
          <path
            d="M4 10h16 M4 14.5h16 M11 5v14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
          />
        </svg>
      );
    case 'math':
      return (
        <svg {...common}>
          <path
            d="M7 5h10l-6 7 6 7H7"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      );
    case 'image':
      return (
        <svg {...common}>
          <rect
            x="4"
            y="5"
            width="16"
            height="14"
            rx="2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
          />
          <circle cx="9" cy="10" r="1.6" fill="currentColor" />
          <path
            d="M5 17l4.5-4.5 3 3L16 11l3 3"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      );
    case 'quote':
      return (
        <svg {...common}>
          <path
            d="M9 7c-2 0-3.5 1.6-3.5 3.8C5.5 13 7 14 8.4 14c.2 1.7-.7 2.6-2.4 3 2.9-.1 5-2.2 5-5.4C11 8.6 10.3 7 9 7zM18 7c-2 0-3.5 1.6-3.5 3.8 0 2.2 1.5 3.2 2.9 3.2.2 1.7-.7 2.6-2.4 3 2.9-.1 5-2.2 5-5.4C20 8.6 19.3 7 18 7z"
            fill="currentColor"
          />
        </svg>
      );
    case 'divider':
      return (
        <svg {...common}>
          <path
            d="M4 12h16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      );
    case 'task':
      return (
        <svg {...common}>
          <circle
            cx="12"
            cy="12"
            r="8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
          />
          <path
            d="M8.6 12l2.2 2.2 4.6-4.8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Inline @mention pill (person / doc / task / channel)
// ---------------------------------------------------------------------------

type MentionKind = 'person' | 'doc' | 'task' | 'channel' | 'agent';

function MentionPill(props: {
  kind: MentionKind;
  label: string;
  initials?: string;
}) {
  // Person mentions render as a compact accent pill (@name, no avatar); docs,
  // tasks, channels, and agents render as an inline icon + underlined name —
  // matching how the real Macro editor distinguishes user vs. entity mentions
  // (see UserMention.tsx / DocumentMention.tsx in the app repo).
  if (props.kind === 'person') {
    return (
      <span
        style={{
          'background-color': 'color-mix(in srgb, var(--a0) 8%, transparent)',
          'border-radius': '6px',
          color: 'var(--a0)',
          'font-family': appFont,
          padding: '1px 4px',
          'white-space': 'nowrap',
        }}
      >
        @{props.label}
      </span>
    );
  }
  const iconColor = props.kind === 'channel' ? 'var(--c2)' : 'var(--a0)';
  return (
    <span style={{ 'white-space': 'nowrap' }}>
      <span
        aria-hidden="true"
        style={{
          color: iconColor,
          display: 'inline-flex',
          margin: '0 3px 0 1px',
          'vertical-align': '-0.16em',
        }}
      >
        <Show when={props.kind === 'doc'}>
          <DocFileGlyph size={13} color={iconColor} />
        </Show>
        <Show when={props.kind === 'task'}>
          <BlockGlyph name="task" size={13} />
        </Show>
        <Show when={props.kind === 'agent'}>
          <IconAgentStar
            style={{ height: '13px', width: '13px', flex: 'none' }}
          />
        </Show>
        <Show when={props.kind === 'channel'}>
          <IconChannels
            style={{ height: '13px', width: '13px', flex: 'none' }}
          />
        </Show>
      </span>
      <span
        style={{
          color: 'var(--c1)',
          'text-decoration-line': 'underline',
          'text-decoration-color':
            'color-mix(in srgb, var(--c1) 22%, transparent)',
          'text-decoration-thickness': 'max(1px, 0.06em)',
          'text-underline-offset': '2px',
        }}
      >
        {props.label}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hero: realistic app window (document editor + Ask-AI bar)
// ---------------------------------------------------------------------------

export function HeroDocWindow() {
  const compact = () => mobile();
  const contentColumn = () =>
    ({
      'box-sizing': 'border-box',
      margin: '0 auto',
      'max-width': compact() ? '100%' : '620px',
      width: '100%',
    }) as const;
  const bodyText: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-family': appFont,
    'font-size': compact() ? '13px' : '14px',
    'line-height': 1.6,
    margin: '0',
  };
  const checklist = [
    {
      done: true,
      text: 'Lock the launch date with ',
      pill: { kind: 'channel' as MentionKind, label: 'go-to-market' },
    },
    { done: true, text: 'Draft the announcement post', pill: null },
    {
      done: false,
      text: 'Brief investors, see ',
      pill: { kind: 'doc' as MentionKind, label: 'Investor update' },
    },
  ];
  const timelineItems = [
    'Jun 17 — freeze copy and screenshots',
    'Jun 24 — investor briefings go out',
    'Jul 1 — Product Hunt launch',
  ];

  return (
    <PreviewWindow
      class="docs-hero-window"
      background={docsSurfaceL1}
      innerBackground={docsSurfaceL1}
      mask="linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 78%, rgb(0 0 0 / 0.22) 100%)"
    >
      {/* Document pane */}
      <div
        style={{
          display: 'grid',
          'grid-template-rows': 'auto 1fr auto',
          'min-width': 0,
        }}
      >
        {/* Toolbar: title + collaborators + share */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--b4) 18%, transparent)',
            'box-sizing': 'border-box',
            display: 'flex',
            gap: '12px',
            height: compact() ? '42px' : '46px',
            overflow: 'hidden',
            padding: compact() ? '0 13px' : '0 16px',
          }}
        >
          <DocFileGlyph size={16} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '14px' : '15px',
              'font-weight': '500',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            Q3 launch plan
          </span>
          <span
            style={{
              'align-items': 'center',
              display: 'flex',
              'margin-left': 'auto',
            }}
          >
            <span style={{ display: 'inline-flex' }}>
              <span
                style={{
                  'border-radius': '999px',
                  'box-shadow': '0 0 0 2px var(--b0)',
                  display: 'inline-flex',
                }}
              >
                <Avatar initials="JB" size={22} color="var(--b3)" />
              </span>
              <span
                style={{
                  'border-radius': '999px',
                  'box-shadow': '0 0 0 2px var(--b0)',
                  display: 'inline-flex',
                  'margin-left': '-7px',
                }}
              >
                <Avatar initials="JW" size={22} color="var(--b4)" />
              </span>
              <span
                style={{
                  'border-radius': '999px',
                  'box-shadow': '0 0 0 2px var(--b0)',
                  display: 'inline-flex',
                  'margin-left': '-7px',
                }}
              >
                <Avatar initials="GS" size={22} color="var(--b3)" />
              </span>
            </span>
          </span>
          <Show when={!compact()}>
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
                padding: '5px 10px',
                'white-space': 'nowrap',
              }}
            >
              <ShareGlyph size={13} color="var(--c2)" /> Share
            </span>
          </Show>
        </div>

        {/* Document body */}
        <div
          style={{
            display: 'grid',
            'justify-items': 'center',
            'min-height': compact() ? '0' : '380px',
            padding: compact() ? '16px 14px' : '22px 26px',
          }}
        >
          <div
            style={{
              ...contentColumn(),
              'align-content': 'start',
              display: 'grid',
              gap: compact() ? '12px' : '15px',
            }}
          >
            <h3
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': compact() ? '16px' : '18px',
                'font-weight': '600',
                'letter-spacing': '-0.01em',
                margin: '0',
              }}
            >
              Q3 launch plan
            </h3>
            <div
              style={{
                'align-items': 'center',
                display: 'flex',
                'flex-wrap': 'wrap',
                gap: '7px',
              }}
            >
              <PinnedProp label="Owner" value="JB" person />
              <PinnedProp label="Task" value="PRJ-128" />
              <PinnedProp label="Urgency" value="High" accent />
            </div>
            <p style={bodyText}>
              We ship the V1 of Macro as the open-source company OS. Looping in{' '}
              <MentionPill kind="person" label="Julia Westphal" initials="JW" />{' '}
              to own GTM and <MentionPill kind="agent" label="research agent" />{' '}
              to pull the competitive landscape. Everything in this doc stays
              @linked to tasks, channels, and agents.
            </p>
            <p
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': compact() ? '14px' : '15px',
                'font-weight': '600',
                margin: '0',
              }}
            >
              Goals
            </p>
            <div style={{ display: 'grid', gap: '9px' }}>
              <For each={checklist}>
                {(item) => (
                  <div
                    style={{
                      'align-items': 'center',
                      display: 'flex',
                      gap: '10px',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        'align-items': 'center',
                        'background-color': item.done
                          ? 'var(--a0)'
                          : 'transparent',
                        border: item.done
                          ? '1px solid var(--a0)'
                          : '1px solid var(--b4)',
                        'border-radius': '4px',
                        'box-sizing': 'border-box',
                        display: 'inline-grid',
                        flex: 'none',
                        height: '17px',
                        'place-items': 'center',
                        width: '17px',
                      }}
                    >
                      <Show when={item.done}>
                        <svg
                          width="10"
                          height="8"
                          viewBox="0 0 10 8"
                          aria-hidden="true"
                        >
                          <path
                            d="M1 4l2.6 2.6L9 1"
                            fill="none"
                            stroke="var(--b0)"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          />
                        </svg>
                      </Show>
                    </span>
                    <span
                      style={{
                        ...bodyText,
                        color: item.done ? 'var(--c4)' : 'var(--c1)',
                        'text-decoration': item.done ? 'line-through' : 'none',
                      }}
                    >
                      {item.text}
                      <Show when={item.pill}>
                        {(p) => (
                          <MentionPill kind={p().kind} label={p().label} />
                        )}
                      </Show>
                      <Show when={!item.pill}>
                        <span
                          aria-hidden="true"
                          class="docs-caret"
                          style={{
                            'background-color': 'var(--c1)',
                            display: 'inline-block',
                            height: '15px',
                            'margin-left': '1px',
                            'vertical-align': 'text-bottom',
                            width: '1.5px',
                          }}
                        />
                      </Show>
                    </span>
                  </div>
                )}
              </For>
            </div>
            <p
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': compact() ? '14px' : '15px',
                'font-weight': '600',
                margin: '0',
              }}
            >
              Timeline
            </p>
            <div style={{ display: 'grid', gap: '7px' }}>
              <For each={timelineItems}>
                {(item) => (
                  <p style={{ ...bodyText, color: 'var(--c2)' }}>{item}</p>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </PreviewWindow>
  );
}

// ---------------------------------------------------------------------------
// Home variant — full document with several people co-editing the same line in
// real time, used to show off the conflict-free CRDT editor. The document body
// is itself about how the editor works (Durable Object CRDTs, ultra-fast).
// ---------------------------------------------------------------------------

// A blinking named caret belonging to one live collaborator.
function CollabCaret(props: { name: string; color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        position: 'relative',
        'vertical-align': 'text-bottom',
        width: '2px',
      }}
    >
      <span
        class="doccollab-caret"
        style={{
          'background-color': props.color,
          display: 'inline-block',
          height: '17px',
          width: '2px',
        }}
      />
      <span
        style={{
          'background-color': props.color,
          'border-radius': '4px 4px 4px 0',
          color: 'var(--b0)',
          'font-family': appFont,
          'font-size': '10px',
          'font-weight': '700',
          left: '0',
          'line-height': 1,
          padding: '2px 5px',
          position: 'absolute',
          top: '-16px',
          'white-space': 'nowrap',
        }}
      >
        {props.name}
      </span>
    </span>
  );
}

// A live selection (highlight + underline) belonging to one collaborator.
function CollabSelection(props: {
  name: string;
  color: string;
  children: JSX.Element;
  labelLeft?: string;
  labelWeight?: string;
}) {
  return (
    <span
      style={{
        'background-color': `color-mix(in srgb, ${props.color} 20%, transparent)`,
        'border-radius': '3px',
        'box-shadow': `inset 0 -2px 0 ${props.color}`,
        padding: '1px 2px',
        position: 'relative',
      }}
    >
      {props.children}
      <span
        aria-hidden="true"
        style={{
          'background-color': props.color,
          'border-radius': '4px 4px 4px 0',
          color: 'var(--b0)',
          'font-family': appFont,
          'font-size': '10px',
          'font-weight': props.labelWeight ?? '700',
          left: props.labelLeft ?? '-2px',
          'line-height': 1,
          padding: '2px 5px',
          position: 'absolute',
          top: '-16px',
          'white-space': 'nowrap',
        }}
      >
        {props.name}
      </span>
    </span>
  );
}

const COEDIT_SUFFIX = ' — and it never conflicts.';
const collabBullets = [
  'Edits apply locally first, then reconcile in the background.',
  'No round-trips to a central database. The actor is the source of truth.',
  'Offline changes replay when you reconnect.',
];

// A deliberately static, mobile-first Docs mockup for the home page. Keep this
// separate from HeroDocCollabWindow: that component is the richer desktop demo
// and should not be constrained by refinements to the compact marketing shot.
export function HomeMobileDocsShot() {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
      }}
    >
      <style>{`
        .home-docs-user-caret { opacity: 1; }
        .home-mobile-docs-more-markdown { display: none; }
        @media (min-height: 760px) {
          .home-mobile-docs-shot {
            display: flex;
            flex-direction: column;
          }
          .home-mobile-docs-body {
            align-content: start;
            flex: 1;
            grid-template-rows: auto auto auto auto;
          }
          .home-mobile-docs-more-markdown {
            align-self: end;
            display: grid;
            gap: 8px;
            margin-top: clamp(18px, 3.5svh, 30px);
          }
          .home-mobile-docs-mentions {
            display: grid;
            gap: 8px;
            padding-left: 13px;
          }
          .home-mobile-docs-mention {
            align-items: center;
            color: var(--c1);
            display: inline-flex;
            font-family: ${appFont};
            font-size: 12px;
            gap: 4px;
            text-decoration: underline;
            text-decoration-color: color-mix(in srgb, var(--c1) 24%, transparent);
            text-decoration-thickness: 1px;
            text-underline-offset: 2px;
            white-space: nowrap;
            width: max-content;
          }
          .home-mobile-docs-task-mention {
            width: 100%;
          }
        }
      `}</style>
      <div
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(100% 112% at 50% 100%, color-mix(in srgb, var(--b1) 54%, var(--ambient-ink) 16%) 0%, transparent 84%)',
          inset: '-34% -14%',
          'pointer-events': 'none',
          position: 'absolute',
          'z-index': 0,
        }}
      />
      <div
        aria-hidden="true"
        class="home-mobile-docs-shot"
        style={{
          background: 'color-mix(in srgb, var(--b1) 86%, var(--b0))',
          border: '1px solid color-mix(in srgb, var(--b4) 28%, transparent)',
          'border-radius': '14px',
          'box-shadow': '0 24px 48px -30px rgb(0 0 0 / 0.9)',
          'box-sizing': 'border-box',
          color: 'var(--c1)',
          overflow: 'hidden',
          position: 'relative',
          'text-align': 'left',
          width: '100%',
          'z-index': 1,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--c1) 34%, transparent) 0%, color-mix(in srgb, var(--c1) 12%, transparent) 24%, transparent 48%)',
            'border-radius': 'inherit',
            inset: 0,
            '-webkit-mask':
              'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            '-webkit-mask-composite': 'xor',
            mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            'mask-composite': 'exclude',
            padding: '1px',
            'pointer-events': 'none',
            position: 'absolute',
            'z-index': 1,
          }}
        />
        <div
          style={{
            transform: 'scale(0.8)',
            'transform-origin': 'top left',
            width: '125%',
          }}
        >
          <div
            style={{
              'align-items': 'center',
              'border-bottom':
                '1px solid color-mix(in srgb, var(--b4) 22%, transparent)',
              display: 'flex',
              gap: '10px',
              padding: '11px 13px',
            }}
          >
            <IconFileMd
              aria-hidden="true"
              style={{
                color: 'var(--a0)',
                display: 'block',
                flex: 'none',
                height: '17px',
                width: '17px',
              }}
            />
            <span
              style={{
                'font-family': appFont,
                'font-size': '13px',
                'font-weight': '500',
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
              }}
            >
              How realtime editing works
            </span>
            <span
              style={{
                'align-items': 'center',
                display: 'flex',
                'margin-left': 'auto',
              }}
            >
              <span
                style={{
                  'align-items': 'center',
                  background: 'var(--a0)',
                  border: '2px solid var(--b1)',
                  'border-radius': '999px',
                  color: 'var(--b0)',
                  display: 'inline-flex',
                  'font-family': appFont,
                  'font-size': '9px',
                  'font-weight': '500',
                  height: '19px',
                  'justify-content': 'center',
                  width: '19px',
                }}
              >
                A
              </span>
              <span
                style={{
                  'align-items': 'center',
                  background: 'var(--a2)',
                  border: '2px solid var(--b1)',
                  'border-radius': '999px',
                  color: 'var(--b0)',
                  display: 'inline-flex',
                  'font-family': appFont,
                  'font-size': '9px',
                  'font-weight': '500',
                  height: '19px',
                  'justify-content': 'center',
                  'margin-left': '-6px',
                  width: '19px',
                }}
              >
                R
              </span>
              <span
                style={{
                  'align-items': 'center',
                  background: 'var(--a4)',
                  border: '2px solid var(--b1)',
                  'border-radius': '999px',
                  color: 'var(--b0)',
                  display: 'inline-flex',
                  height: '19px',
                  'justify-content': 'center',
                  'margin-left': '-6px',
                  width: '19px',
                }}
              >
                <IconClaude
                  aria-hidden="true"
                  style={{ display: 'block', height: '11px', width: '11px' }}
                />
              </span>
            </span>
          </div>

          <div
            class="home-mobile-docs-body"
            style={{ display: 'grid', gap: '16px', padding: '24px 16px' }}
          >
            <h3
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': 'calc(21px * 0.94)',
                'font-weight': '550',
                'letter-spacing': '-0.025em',
                'line-height': 1.08,
                margin: '0',
              }}
            >
              Write together,{' '}
              <CollabSelection
                name="Rahul"
                color={COLLAB_B}
                labelLeft="0"
                labelWeight="500"
              >
                seamlessly
              </CollabSelection>
            </h3>
            <p
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': 'calc(13px * 0.94)',
                'line-height': 1.55,
                margin: '0',
              }}
            >
              Every document is a CRDT backed by its own Durable Object, so
              edits merge in order and stay consistent for everyone.
            </p>
            <p
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': 'calc(13px * 0.94)',
                'line-height': 1.55,
                margin: '0',
              }}
            >
              <CollabSelection
                name="Claude"
                color={COLLAB_C}
                labelLeft="0"
                labelWeight="500"
              >
                Stable online and offline.
              </CollabSelection>
              <span
                aria-hidden="true"
                class="home-docs-user-caret"
                style={{
                  background: 'var(--a0)',
                  display: 'inline-block',
                  height: '1.25em',
                  'margin-left': '3px',
                  'vertical-align': '-0.12em',
                  width: '1px',
                }}
              />
            </p>
            <div class="home-mobile-docs-more-markdown">
              <h4
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '14px',
                  'font-weight': '520',
                  'letter-spacing': '-0.012em',
                  margin: '0',
                }}
              >
                @mention any Macro entity
              </h4>
              <div class="home-mobile-docs-mentions">
                <span class="home-mobile-docs-mention">
                  <IconAgentStar
                    aria-hidden="true"
                    style={{
                      color: 'var(--a0)',
                      display: 'block',
                      height: '13px',
                      width: '13px',
                    }}
                  />
                  agent chat
                </span>
                <span class="home-mobile-docs-mention">
                  <IconChannelMacro
                    aria-hidden="true"
                    style={{
                      color: 'var(--c2)',
                      display: 'block',
                      height: '13px',
                      width: '13px',
                    }}
                  />
                  channel
                </span>
                <span class="home-mobile-docs-mention">
                  <span
                    aria-hidden="true"
                    style={{
                      'align-items': 'center',
                      background: 'var(--a0)',
                      'border-radius': '50%',
                      color: 'var(--b0)',
                      display: 'inline-flex',
                      'font-size': '8px',
                      height: '13px',
                      'justify-content': 'center',
                      width: '13px',
                    }}
                  >
                    A
                  </span>
                  username
                </span>
                <span class="home-mobile-docs-mention home-mobile-docs-task-mention">
                  <IconTaskMacro
                    aria-hidden="true"
                    style={{
                      color: 'var(--a2)',
                      display: 'block',
                      height: '13px',
                      width: '13px',
                    }}
                  />
                  task
                  <StatusInProgress
                    aria-label="In progress"
                    style={{
                      color: 'var(--a0)',
                      display: 'block',
                      height: '11px',
                      'margin-left': '3px',
                      width: '11px',
                    }}
                  />
                  <span
                    aria-label="Assigned to Aidan"
                    style={{
                      'align-items': 'center',
                      background: 'var(--a0)',
                      'border-radius': '50%',
                      color: 'var(--b0)',
                      display: 'inline-flex',
                      'font-size': '7px',
                      height: '11px',
                      'justify-content': 'center',
                      'margin-left': '3px',
                      width: '11px',
                    }}
                  >
                    A
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HeroDocCollabWindow() {
  const compact = () => mobile();
  // True once the user types into the live editor — dismisses the hint.
  const [engaged, setEngaged] = createSignal(false);
  // The window chrome's filename, reported up by the live editor so it tracks
  // the document's first heading as the visitor edits it. Seeded with the
  // editor's own starting heading so the chrome is right before the iframe
  // loads (and stays right for the prerender and mobile fallbacks).
  const [docTitle, setDocTitle] = createSignal('Why Macro Docs?');
  // Where the intro sentence ends, measured inside the editor iframe, so the
  // "START TYPING" arrow can point at it instead of floating mid-document.
  const [anchor, setAnchor] = createSignal<{ x: number; y: number } | null>(
    null
  );
  // The live editor has a document up. Gates the callout: while the frame is
  // still showing its loading skeleton the arrow would be aimed at a
  // placeholder, which is worse than not being there yet.
  const [editorReady, setEditorReady] = createSignal(false);
  // Responsive max-width lives on .docs-gfx-collab-column so the prerendered
  // HTML carries no viewport-signal values.
  const contentColumn: JSX.CSSProperties = {
    'box-sizing': 'border-box',
    margin: '0 auto',
    width: '100%',
  };
  // Responsive font-size lives on .docs-gfx-collab-body-text.
  const bodyText: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-family': appFont,
    'line-height': 1.6,
    margin: '0',
  };

  // Julia types live at the end of the shared line (SSR shows the full string).
  // On mobile we render the static fallback, and an animating tail length
  // reflows the whole document body — janking the page — so skip the typing
  // animation there and leave the full sentence in place.
  const [typed, setTyped] = createSignal(COEDIT_SUFFIX);
  onMount(() => {
    if (compact()) return;
    let i = COEDIT_SUFFIX.length;
    let dir = 1;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setTyped(COEDIT_SUFFIX.slice(0, i));
      if (dir > 0) {
        i++;
        if (i > COEDIT_SUFFIX.length) {
          dir = -1;
          i = COEDIT_SUFFIX.length;
          timer = setTimeout(tick, 2600);
          return;
        }
      } else {
        i -= 2;
        if (i <= 0) {
          dir = 1;
          i = 0;
          timer = setTimeout(tick, 900);
          return;
        }
      }
      timer = setTimeout(tick, dir > 0 ? 58 : 26);
    };
    timer = setTimeout(tick, 1400);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <style>{`
        @keyframes docCollabBlink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0.25; } }
        @media (prefers-reduced-motion: no-preference) {
          .doccollab-caret { animation: docCollabBlink 1s steps(1) infinite; }
        }
        /* Desktop clips hard at the window's bottom edge; only the static
           mobile fallback fades.

           The fade used to run on both, positioned at 88% so it sat over the
           Ask AI bar rather than the editor: the editor's mention and slash
           menus render fixed to the iframe's own viewport and can open
           anywhere in the document, so a fade across the editor region would
           ghost a menu opened low in the doc. With that bar gone the fade
           would land inside the editor, so desktop drops it. The compact
           fallback is static, has no live menus, and keeps its 68% fade.

           In CSS rather than an inline style so the prerendered HTML carries
           no viewport-signal value. */
        .docs-gfx-collab-column { max-width: 640px; }
        .docs-gfx-collab-toolbar { padding: 11px 16px; }
        .docs-gfx-collab-title { font-size: 15px; }
        .docs-gfx-collab-editor-region { height: 508px; min-height: 508px; }
        .docs-gfx-collab-fallback { padding: 26px 26px; }
        .docs-gfx-collab-fallback-column { gap: 16px; }
        .docs-gfx-collab-heading { font-size: 24px; }
        .docs-gfx-collab-body-text { font-size: 16px; }
        .docs-gfx-collab-subhead { font-size: 18px; }
        .docs-gfx-collab-bullet-dot { margin-top: 9px; }
        @media (max-width: 699px) {
          .docs-gfx-collab-window {
            -webkit-mask-image: linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 68%, rgb(0 0 0 / 0) 100%);
            mask-image: linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 68%, rgb(0 0 0 / 0) 100%);
          }
          .docs-gfx-collab-column { max-width: 100%; }
          .docs-gfx-collab-toolbar { padding: 11px 13px; }
          .docs-gfx-collab-title { font-size: 14px; }
          .docs-gfx-collab-editor-region { height: auto; min-height: 0; }
          .docs-gfx-collab-fallback { padding: 16px 14px; }
          .docs-gfx-collab-fallback-column { gap: 13px; }
          .docs-gfx-collab-heading { font-size: 21px; }
          .docs-gfx-collab-body-text { font-size: 14px; }
          .docs-gfx-collab-subhead { font-size: 16px; }
          .docs-gfx-collab-bullet-dot { margin-top: 8px; }
        }
      `}</style>
      {/* The shared app-window chrome, as used by the email, tasks, channels
          and calls demos. This window used to hand-roll the same shell and had
          drifted from it: a heavier hairline (c4 16% vs 10%), a non-concentric
          inner radius (8px where 12px card - 7px padding = 5px), and a second
          border on the inner surface, which read as a double frame. The shared
          component has no inner border, so nesting in it removes that. */}
      <PreviewWindow class="docs-hero-window docs-gfx-collab-window">
        <div
          style={{
            display: 'grid',
            'grid-template-rows': 'auto 1fr',
            'min-width': 0,
          }}
        >
          {/* Header: file glyph + the document's live title */}
          <div
            class="docs-gfx-collab-toolbar"
            style={{
              'align-items': 'center',
              'border-bottom': '1px solid var(--b2)',
              display: 'flex',
              gap: '12px',
              overflow: 'hidden',
            }}
          >
            <DocFileGlyph size={16} />
            <span
              class="docs-gfx-collab-title"
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-weight': '500',
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
              }}
            >
              {docTitle() || 'New Note'}
            </span>
          </div>

          {/* Document body — activates the website-owned editor demo;
              the static collaborative doc below is the prerender/mobile fallback. */}
          <div
            class="docs-gfx-collab-editor-region"
            style={{ position: 'relative' }}
          >
            <LiveDocEditor
              active={!compact()}
              pauseWhenOffscreen
              background={PREVIEW_INNER_BG}
              onInteract={() => setEngaged(true)}
              onTitleChange={setDocTitle}
              onAnchor={setAnchor}
              onReady={() => setEditorReady(true)}
              fallback={() => (
                <div
                  class="docs-gfx-collab-fallback"
                  style={{
                    display: 'grid',
                    height: '100%',
                    'justify-items': 'center',
                  }}
                >
                  <div
                    class="docs-gfx-collab-column docs-gfx-collab-fallback-column"
                    style={{
                      ...contentColumn,
                      'align-content': 'start',
                      display: 'grid',
                    }}
                  >
                    <h3
                      class="docs-gfx-collab-heading"
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-weight': '600',
                        'letter-spacing': '-0.01em',
                        margin: '0',
                      }}
                    >
                      Why Macro Docs?
                    </h3>
                    <p
                      class="docs-gfx-collab-body-text"
                      style={{ ...bodyText, 'line-height': 1.95 }}
                    >
                      Every document is a CRDT with its own{' '}
                      <strong
                        style={{ color: 'var(--c1)', 'font-weight': '700' }}
                      >
                        Durable Object
                      </strong>{' '}
                      in the cloud. Edits merge in order, so{' '}
                      <CollabSelection name="Rahul" color="var(--a0)">
                        two people can type on the same line
                      </CollabSelection>{' '}
                      without overwriting each other.
                    </p>

                    {/* Everyone co-edits the same line live, shown inline as plain doc text */}
                    <p
                      class="docs-gfx-collab-body-text"
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'line-height': 2.1,
                        margin: '0',
                      }}
                    >
                      Everyone can{' '}
                      <CollabSelection name="Claude" color="var(--a4)">
                        type on this line
                      </CollabSelection>{' '}
                      at the same time{typed()}
                      <CollabCaret name="Julia" color="var(--a2)" />
                    </p>

                    <p
                      class="docs-gfx-collab-subhead"
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-weight': '600',
                        margin: '0',
                      }}
                    >
                      How it stays in sync
                    </p>
                    <div style={{ display: 'grid', gap: '9px' }}>
                      <For each={collabBullets}>
                        {(bullet) => (
                          <div
                            style={{
                              'align-items': 'flex-start',
                              display: 'flex',
                              gap: '10px',
                            }}
                          >
                            <span
                              aria-hidden="true"
                              class="docs-gfx-collab-bullet-dot"
                              style={{
                                'background-color': 'var(--c2)',
                                'border-radius': '999px',
                                flex: 'none',
                                height: '6px',
                                width: '6px',
                              }}
                            />
                            <span
                              class="docs-gfx-collab-body-text"
                              style={{ ...bodyText, color: 'var(--c2)' }}
                            >
                              {bullet}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              )}
            />

            {/* Aimed with a measurement taken inside the iframe so the arrow
                lands just past the period ending the intro sentence, at any
                width. Sits in the iframe's own box, which is what those
                coordinates are relative to. Centred near the bottom until the
                measurement arrives, so it never flashes in the wrong place. */}
            <div
              style={{
                'pointer-events': 'none',
                position: 'absolute',
                transform: 'translateX(-50%)',
                'z-index': 3,
                ...(anchor()
                  ? {
                      left: `${anchor()!.x + 8}px`,
                      top: `${anchor()!.y + 4}px`,
                    }
                  : { bottom: '150px', left: '50%' }),
              }}
            >
              <TryMePointer
                active={!compact()}
                dismissed={engaged()}
                ready={editorReady()}
              />
            </div>
          </div>
        </div>
      </PreviewWindow>
    </div>
  );
}

function PinnedProp(props: {
  label: string;
  value: string;
  person?: boolean;
  accent?: boolean;
}) {
  return (
    <span
      style={{
        'align-items': 'center',
        'background-color': 'color-mix(in srgb, var(--c4) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
        'border-radius': '6px',
        display: 'inline-flex',
        'font-family': appFont,
        'font-size': '12px',
        gap: '6px',
        padding: '3px 8px 3px 7px',
      }}
    >
      <span style={{ color: 'var(--c4)' }}>{props.label}</span>
      <Show
        when={props.person}
        fallback={
          <span
            style={{
              color: props.accent ? 'var(--a0)' : 'var(--c1)',
              'font-weight': '600',
            }}
          >
            {props.value}
          </span>
        }
      >
        <Avatar initials={props.value} size={16} color="var(--b3)" />
      </Show>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Zoomed detail graphics
//
// The @link and agent sections used to render whole document windows: chrome, a
// filename, several content lines, two collaborator colours, a checklist and an
// ask bar. All of it moved, and none of it told the reader which part was the
// claim. Both are now one line of document text at roughly 1.5x the app's size,
// cropped and faded at the edges so the surrounding document dissolves and the
// single example is the only thing in focus.
// ---------------------------------------------------------------------------

/**
 * Frames a fragment as a zoomed detail rather than a cut-off panel.
 *
 * The radial mask fades every edge, so there is no hard boundary implying a
 * window. Content is centred and the box keeps a fixed minimum height, so a
 * graphic whose example changes length does not shift the section's layout.
 */
function ZoomCrop(props: { children: JSX.Element }) {
  const fade = () =>
    `radial-gradient(${mobile() ? '140% 155%' : '112% 132%'} at 50% 50%, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 40%, rgb(0 0 0 / 0) 84%)`;
  return (
    <div
      style={{
        'align-content': 'center',
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        '-webkit-mask-image': fade(),
        'mask-image': fade(),
        'min-height': mobile() ? '170px' : '210px',
        padding: mobile() ? '30px 14px' : '48px 24px',
        width: '100%',
      }}
    >
      <style>{`
        @keyframes docsZoomBlink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0.2; } }
        @media (prefers-reduced-motion: no-preference) {
          .docs-zoom-caret { animation: docsZoomBlink 1.1s steps(1) infinite; }
        }
      `}</style>
      {props.children}
    </div>
  );
}

/** A plain text caret, sized in em so it tracks the zoomed type. */
function ZoomCaret(props: { color?: string }) {
  return (
    <span
      aria-hidden="true"
      class="docs-zoom-caret"
      style={{
        'background-color': props.color ?? 'var(--c1)',
        display: 'inline-block',
        height: '1.05em',
        'margin-left': '1px',
        'vertical-align': '-0.2em',
        width: '2px',
      }}
    />
  );
}

/**
 * The resolved mention: an avatar and a real name, which is the whole point of
 * the section — it resolved to an object, not a URL.
 */
function AtLinkPill() {
  const compact = () => mobile();
  return (
    <span
      style={{
        'align-items': 'center',
        'background-color': 'color-mix(in srgb, var(--a0) 15%, transparent)',
        'border-radius': '7px',
        display: 'inline-flex',
        gap: compact() ? '5px' : '7px',
        padding: compact() ? '1px 7px 1px 4px' : '2px 9px 2px 5px',
        'vertical-align': '-0.2em',
      }}
    >
      <Avatar initials="JW" size={compact() ? 17 : 21} color="var(--b3)" />
      <span style={{ color: 'var(--a0)', 'font-weight': '600' }}>
        Julia Westphal
      </span>
    </span>
  );
}

export function ConnectedGraphic() {
  const compact = () => mobile();
  const size = () => (compact() ? '17px' : '22px');
  const [phase, setPhase] = createSignal<'typing' | 'menu' | 'resolved'>(
    'typing'
  );
  const [typed, setTyped] = createSignal('');

  onMount(() => {
    // One deliberately slow loop, one example: type the query, show the single
    // match, resolve it to the object, then hold long enough to read.
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      setPhase('typing');
      setTyped('');
      const query = '@jul';
      let i = 0;
      const type = () => {
        i += 1;
        setTyped(query.slice(0, i));
        if (i < query.length) {
          timer = setTimeout(type, 155);
          return;
        }
        timer = setTimeout(() => {
          setPhase('menu');
          timer = setTimeout(() => {
            setPhase('resolved');
            timer = setTimeout(run, 3600);
          }, 1500);
        }, 420);
      };
      timer = setTimeout(type, 800);
    };
    run();
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <ZoomCrop>
      <div
        style={{
          display: 'grid',
          gap: compact() ? '14px' : '18px',
          'justify-items': 'start',
          width: 'min(100%, 460px)',
        }}
      >
        <p
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': size(),
            'line-height': 1.5,
            margin: '0',
            'white-space': 'nowrap',
          }}
        >
          Handing the launch to{' '}
          <Show
            when={phase() === 'resolved'}
            fallback={
              <>
                <span style={{ color: 'var(--a0)' }}>{typed()}</span>
                <ZoomCaret />
              </>
            }
          >
            <AtLinkPill />
          </Show>
        </p>

        {/* One row, and its height is reserved whether or not it is showing:
            the crop centres its content, so appearing rows would otherwise
            nudge the line the reader is looking at. */}
        <div style={{ height: compact() ? '38px' : '46px', width: '100%' }}>
          <div
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--b1) 80%, var(--b0))',
              border:
                '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
              'border-radius': '9px',
              'box-sizing': 'border-box',
              display: 'flex',
              gap: compact() ? '8px' : '10px',
              height: '100%',
              opacity: phase() === 'menu' ? '1' : '0',
              padding: compact() ? '0 10px' : '0 12px',
              transition: 'opacity 220ms ease',
              width: '100%',
            }}
          >
            <Avatar
              initials="JW"
              size={compact() ? 19 : 23}
              color="var(--b3)"
            />
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': compact() ? '13px' : '14.5px',
                'font-weight': '500',
              }}
            >
              Julia Westphal
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': compact() ? '12px' : '13px',
                'margin-left': 'auto',
              }}
            >
              Person
            </span>
          </div>
        </div>
      </div>
    </ZoomCrop>
  );
}

// ---------------------------------------------------------------------------
// Slash-menu graphic — "/" opens the block menu
// ---------------------------------------------------------------------------

const slashItems: { name: string; label: string; hint: string }[] = [
  { name: 'text', label: 'Text', hint: '' },
  { name: 'todo', label: 'To-do list', hint: '[]' },
  { name: 'code', label: 'Code block', hint: '```' },
  { name: 'table', label: 'Table', hint: '' },
  { name: 'math', label: 'Equation', hint: '/latex' },
  { name: 'image', label: 'Image', hint: '' },
];

// The bare slash "/" block menu dropdown (no doc chrome), so it can be lifted
// into a spotlight composition. Width is fluid to its container.
export function SlashMenuPanel(props: { highlightIndex?: number } = {}) {
  const highlight = () => props.highlightIndex ?? 0;
  return (
    <div
      style={{
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
        'border-radius': '10px',
        'box-shadow': 'var(--shadow-panel-lg)',
        'box-sizing': 'border-box',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <div
        style={{
          color: 'var(--c4)',
          'font-family': appFont,
          'font-size': '11px',
          'font-weight': '600',
          padding: '9px 12px 5px',
        }}
      >
        Basic blocks
      </div>
      <For each={slashItems}>
        {(item, i) => (
          <div
            style={{
              'align-items': 'center',
              'background-color':
                i() === highlight()
                  ? 'color-mix(in srgb, var(--c1) 6%, transparent)'
                  : 'transparent',
              display: 'flex',
              gap: '11px',
              padding: '8px 12px',
            }}
          >
            <span
              style={{
                'align-items': 'center',
                'background-color':
                  'color-mix(in srgb, var(--c4) 10%, transparent)',
                'border-radius': '6px',
                color: 'var(--c2)',
                display: 'inline-grid',
                flex: 'none',
                height: '28px',
                'place-items': 'center',
                width: '28px',
              }}
            >
              <BlockGlyph name={item.name} size={16} />
            </span>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '13.5px',
              }}
            >
              {item.label}
            </span>
            <Show when={item.hint}>
              <span
                style={{
                  'background-color':
                    'color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '4px',
                  color: 'var(--c4)',
                  'font-family':
                    "ui-monospace, 'SFMono-Regular', Menlo, monospace",
                  'font-size': '11px',
                  'margin-left': 'auto',
                  padding: '2px 6px',
                }}
              >
                {item.hint}
              </span>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

// A faithful static replica of the real Macro editor's @-mention typeahead menu
// (captured from the live editor): People / Documents, Agents & Tasks / Channels
// sections, each with a "View all" affordance, avatars, and entity icons.
type MentionMenuRow =
  | {
      kind: 'person';
      initials: string;
      name: string;
      detail: string;
      active?: boolean;
    }
  | { kind: 'doc'; label: string }
  | { kind: 'channel'; label: string };

type MentionMenuSection = {
  label: string;
  count: number;
  rows: MentionMenuRow[];
};

const mentionMenuSections: MentionMenuSection[] = [
  {
    label: 'People',
    count: 8,
    rows: [
      {
        kind: 'person',
        initials: 'AK',
        name: 'Alex Kim',
        detail: 'alex@example.com',
        active: true,
      },
      {
        kind: 'person',
        initials: 'SC',
        name: 'Sarah Chen',
        detail: 'sarah@example.com',
      },
    ],
  },
  {
    label: 'Documents, Agents, & Tasks',
    count: 9,
    rows: [
      { kind: 'doc', label: 'Q3 Product Roadmap' },
      { kind: 'doc', label: 'Architecture Decision Record' },
    ],
  },
  {
    label: 'Channels',
    count: 3,
    rows: [
      { kind: 'channel', label: 'go-to-market' },
      { kind: 'channel', label: 'engineering' },
    ],
  },
];

// The "note" document glyph the real menu uses (rounded rect + two text lines).
function NoteGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 -4 24 24"
      fill="none"
      stroke={props.color ?? 'var(--a0)'}
      stroke-linecap="round"
      stroke-width="1.5"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <rect width="22.75" height="14.75" x="0.625" y="0.625" rx="2" />
      <path d="M4 6h16M4 10h10.667" />
    </svg>
  );
}

// The channel hash glyph from the real menu.
function ChannelHashGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 -4 24 24"
      fill="none"
      stroke={props.color ?? 'var(--c2)'}
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.5"
      overflow="visible"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path d="M2 5h22M0 11h22M6.5 15.5l5-15M12.5 15.5l5-15" />
    </svg>
  );
}

export function RealMentionMenu() {
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
  const rowStyle = (active?: boolean): JSX.CSSProperties => ({
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
        width: '100%',
      }}
    >
      <For each={mentionMenuSections}>
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
              {(row) => (
                <div style={rowStyle('active' in row ? row.active : false)}>
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
                    <Show when={row.kind === 'person'}>
                      {row.kind === 'person' && (
                        <Avatar
                          initials={row.initials}
                          size={18}
                          color="var(--b3)"
                        />
                      )}
                    </Show>
                    <Show when={row.kind === 'doc'}>
                      <NoteGlyph size={17} />
                    </Show>
                    <Show when={row.kind === 'channel'}>
                      <ChannelHashGlyph size={16} />
                    </Show>
                  </span>
                  <Show
                    when={row.kind === 'person'}
                    fallback={
                      <span style={labelStyle}>
                        {row.kind !== 'person' ? row.label : ''}
                      </span>
                    }
                  >
                    {row.kind === 'person' && (
                      <span
                        style={{
                          ...labelStyle,
                          'align-items': 'baseline',
                          display: 'flex',
                          gap: '7px',
                        }}
                      >
                        {row.name}
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
                    )}
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

export function SlashMenuGraphic(
  props: { highlightIndex?: number; hideMenu?: boolean; trigger?: string } = {}
) {
  const compact = () => mobile();
  const trigger = () => props.trigger ?? '/';
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
          'background-color': 'color-mix(in srgb, var(--b1) 70%, var(--b0))',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          position: 'relative',
          width: 'min(440px, 100%)',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            'border-bottom': '1px solid var(--b2)',
            display: 'flex',
            gap: '10px',
            padding: '11px 14px',
          }}
        >
          <DocFileGlyph size={15} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
              'font-weight': '600',
            }}
          >
            Untitled
          </span>
        </div>
        <div
          style={{
            'box-sizing': 'border-box',
            'min-height': compact() ? '236px' : '252px',
            padding: compact() ? '16px 14px' : '18px 16px',
            position: 'relative',
          }}
        >
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '14px' : '15px',
              'line-height': 1.7,
            }}
          >
            <span
              style={{
                'background-color':
                  'color-mix(in srgb, var(--a0) 22%, transparent)',
                'border-radius': '4px',
                color: 'var(--c1)',
                padding: '1px 4px',
              }}
            >
              {trigger()}
            </span>
            <span
              aria-hidden="true"
              class="docs-caret"
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
          <Show when={!props.hideMenu}>
            <div
              style={{
                left: compact() ? '14px' : '16px',
                position: 'absolute',
                top: compact() ? '42px' : '46px',
                width: compact() ? 'calc(100% - 28px)' : '270px',
              }}
            >
              <SlashMenuPanel highlightIndex={props.highlightIndex} />
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Real-time collaboration graphic — live cursors + offline
// ---------------------------------------------------------------------------

const COLLAB_SENTENCE = 'and keep working even with no connection.';

export function CollabGraphic() {
  const compact = () => mobile();
  // SSR / first paint shows the full sentence (crawlers see whole words); the
  // type/untype animation only runs client-side in onMount.
  const [typed, setTyped] = createSignal(COLLAB_SENTENCE);

  onMount(() => {
    let i = 0;
    let dir = 1;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setTyped(COLLAB_SENTENCE.slice(0, i));
      if (dir > 0) {
        i++;
        if (i > COLLAB_SENTENCE.length) {
          dir = -1;
          i = COLLAB_SENTENCE.length;
          timer = setTimeout(tick, 2400);
          return;
        }
      } else {
        i -= 2;
        if (i <= 0) {
          dir = 1;
          i = 0;
          timer = setTimeout(tick, 700);
          return;
        }
      }
      timer = setTimeout(tick, dir > 0 ? 52 : 24);
    };
    timer = setTimeout(tick, 600);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '14px',
        'justify-items': 'center',
        padding: compact() ? '8px 18px 8px' : '8px 24px',
        width: '100%',
        'max-width': '620px',
      }}
    >
      <div
        style={{
          'background-color': 'color-mix(in srgb, var(--b1) 70%, var(--b0))',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            'border-bottom': '1px solid var(--b2)',
            display: 'flex',
            gap: '10px',
            padding: '11px 14px',
          }}
        >
          <DocFileGlyph size={15} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
              'font-weight': '600',
            }}
          >
            Collaborative editor (jacob rewrite)
          </span>
        </div>
        <div
          style={{
            'box-sizing': 'border-box',
            'min-height': compact() ? '150px' : '168px',
            padding: compact() ? '24px 16px' : '30px 22px',
          }}
        >
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '15px' : '17px',
              'line-height': 2,
            }}
          >
            Edits resolve instantly and never thrash:{' '}
            {/* Owen's live selection */}
            <span
              style={{
                'background-color':
                  'color-mix(in srgb, var(--a4) 20%, transparent)',
                'border-radius': '3px',
                'box-shadow': `inset 0 -2px 0 ${COLLAB_C}`,
                padding: '1px 2px',
                position: 'relative',
              }}
            >
              multiple people can type at once
              <span
                aria-hidden="true"
                style={{
                  'background-color': COLLAB_C,
                  'border-radius': '4px 4px 4px 0',
                  color: 'var(--b0)',
                  'font-family': appFont,
                  'font-size': '10px',
                  'font-weight': '700',
                  left: '-2px',
                  'line-height': 1,
                  padding: '2px 5px',
                  position: 'absolute',
                  top: '-16px',
                  'white-space': 'nowrap',
                }}
              >
                Owen
              </span>
            </span>
            {', '}
            {/* Julia typing live */}
            {typed()}
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                position: 'relative',
                'vertical-align': 'text-bottom',
                width: '2px',
              }}
            >
              <span
                class="docs-collab-caret"
                style={{
                  'background-color': COLLAB_B,
                  display: 'inline-block',
                  height: '17px',
                  width: '2px',
                }}
              />
              <span
                style={{
                  'background-color': COLLAB_B,
                  'border-radius': '4px 4px 4px 0',
                  color: 'var(--b0)',
                  'font-family': appFont,
                  'font-size': '10px',
                  'font-weight': '700',
                  left: '0',
                  'line-height': 1,
                  padding: '2px 5px',
                  position: 'absolute',
                  top: '-16px',
                  'white-space': 'nowrap',
                }}
              >
                Julia
              </span>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent live-edit graphic — an agent editing beside a human, same primitives
// ---------------------------------------------------------------------------

const AGENT_EDIT_SENTENCE = 'keep typing right beside it.';

export function AgentEditGraphic() {
  const compact = () => mobile();
  // SSR / first paint shows the full sentence (crawlers see whole words); the
  // type/untype animation only runs client-side in onMount. The HUMAN is the
  // one typing here — the agent holds the selection — so the scene reads as
  // both editing at once rather than the person waiting on the machine.
  const [typed, setTyped] = createSignal(AGENT_EDIT_SENTENCE);

  onMount(() => {
    let i = 0;
    let dir = 1;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setTyped(AGENT_EDIT_SENTENCE.slice(0, i));
      if (dir > 0) {
        i++;
        if (i > AGENT_EDIT_SENTENCE.length) {
          dir = -1;
          i = AGENT_EDIT_SENTENCE.length;
          timer = setTimeout(tick, 2400);
          return;
        }
      } else {
        i -= 2;
        if (i <= 0) {
          dir = 1;
          i = 0;
          timer = setTimeout(tick, 700);
          return;
        }
      }
      timer = setTimeout(tick, dir > 0 ? 52 : 24);
    };
    timer = setTimeout(tick, 600);
    onCleanup(() => clearTimeout(timer));
  });

  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '14px',
        'justify-items': 'center',
        padding: compact() ? '8px 18px 8px' : '8px 24px',
        width: '100%',
        'max-width': '620px',
      }}
    >
      <div
        style={{
          'background-color': 'color-mix(in srgb, var(--b1) 70%, var(--b0))',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            'border-bottom': '1px solid var(--b2)',
            display: 'flex',
            gap: '10px',
            padding: '11px 14px',
          }}
        >
          <DocFileGlyph size={15} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
              'font-weight': '600',
            }}
          >
            Launch plan (agent rewrite)
          </span>
        </div>
        <div
          style={{
            'box-sizing': 'border-box',
            'min-height': compact() ? '150px' : '168px',
            padding: compact() ? '24px 16px' : '30px 22px',
          }}
        >
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '15px' : '17px',
              'line-height': 2,
            }}
          >
            <MentionPill kind="agent" label="Claude" /> is rewriting{' '}
            {/* The agent's live selection — the same highlight + name pill a
                person gets, because it is the same kind of edit. */}
            <span
              style={{
                'background-color':
                  'color-mix(in srgb, var(--a4) 20%, transparent)',
                'border-radius': '3px',
                'box-shadow': `inset 0 -2px 0 ${COLLAB_C}`,
                padding: '1px 2px',
                position: 'relative',
              }}
            >
              this very sentence
              <span
                aria-hidden="true"
                style={{
                  'background-color': COLLAB_C,
                  'border-radius': '4px 4px 4px 0',
                  color: 'var(--b0)',
                  'font-family': appFont,
                  'font-size': '10px',
                  'font-weight': '700',
                  left: '-2px',
                  'line-height': 1,
                  padding: '2px 5px',
                  position: 'absolute',
                  top: '-16px',
                  'white-space': 'nowrap',
                }}
              >
                Claude
              </span>
            </span>
            {' while you '}
            {/* The human typing live, unbothered, in their own colour */}
            {typed()}
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                position: 'relative',
                'vertical-align': 'text-bottom',
                width: '2px',
              }}
            >
              <span
                class="docs-collab-caret"
                style={{
                  'background-color': COLLAB_A,
                  display: 'inline-block',
                  height: '17px',
                  width: '2px',
                }}
              />
              <span
                style={{
                  'background-color': COLLAB_A,
                  'border-radius': '4px 4px 4px 0',
                  color: 'var(--b0)',
                  'font-family': appFont,
                  'font-size': '10px',
                  'font-weight': '700',
                  left: '0',
                  'line-height': 1,
                  padding: '2px 5px',
                  position: 'absolute',
                  top: '-16px',
                  'white-space': 'nowrap',
                }}
              >
                You
              </span>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agents-as-teammates graphic
// ---------------------------------------------------------------------------

/**
 * Presence tag for an agent: its name, then a bullet and the word Agent.
 *
 * Spelled out rather than marked with the star glyph the mention pills use for
 * kind 'agent'. At the 9px the tag allows, that star reduced to a light smudge
 * that read as a rendering fault rather than a mark, and it is carrying the
 * whole distinction between an agent's cursor and a person's.
 *
 * Sits ON the selection rather than floating above it: bottom:100% puts its
 * bottom edge exactly on the highlight's top edge, and left:0 lines its left
 * edge up with the highlight's, so the square bottom-left corner reads as the
 * label being attached to that selection. A fixed top offset left a 2px gap
 * and a 2px overhang, which read as two unrelated marks.
 */
function AgentTag(props: {
  name: string;
  color: string;
  left?: string;
  ref?: (el: HTMLSpanElement) => void;
}) {
  return (
    <span
      aria-hidden="true"
      ref={(el) => props.ref?.(el)}
      style={{
        'align-items': 'center',
        'background-color': props.color,
        'border-radius': '4px 4px 4px 0',
        bottom: '100%',
        color: 'var(--b0)',
        display: 'inline-flex',
        'font-family': appFont,
        'font-size': '10px',
        'font-weight': '600',
        gap: '3px',
        left: props.left ?? '0',
        'line-height': 1,
        padding: '2px 5px',
        position: 'absolute',
        'white-space': 'nowrap',
      }}
    >
      {props.name}
      <span style={{ 'font-weight': '500', opacity: 0.75 }}>&bull; Agent</span>
    </span>
  );
}

/**
 * An agent's selection: a rounded highlight, a straight rule under it, and its
 * tag attached on top.
 *
 * The rule is its own element, not an inset box-shadow. A shadow is clipped by
 * the highlight's border-radius, so it curled up at both ends and read as a
 * lozenge rather than an underline.
 *
 * 1px, below the 2px this started at. Straightening it was most of what made
 * it read as heavy: an inset shadow's 2px is interrupted by the radius at both
 * ends, so it never covered the full width, and matching that number on a rule
 * that does looked thicker than the thing it replaced.
 */
/**
 * How long the drag dwells on each character.
 *
 * 26ms is 38 characters a second, which is faster than anyone drags a mouse
 * and about right for something that is not using one. Slower than this and
 * the longer of the two selections takes over a second to make, which stops
 * reading as an agent working and starts reading as a progress bar.
 */
const AGENT_CHAR_MS = 26;

/** How long a finished selection stands before it is released. */
const AGENT_HOLD_MS = 4000;

/** How long the agent sits with a bare caret before selecting again. */
const AGENT_REST_MS = 1100;

/** The full loop for a selection of `chars` characters. */
const agentCycleMs = (chars: number) =>
  chars * AGENT_CHAR_MS + AGENT_HOLD_MS + AGENT_REST_MS;

/**
 * Where the agent's cursor is at a point in the cycle, as a character INDEX,
 * and whether it is dragging a selection behind it.
 *
 * An index, not a fraction: a selection can only ever end on a character
 * boundary, which is the whole difference between this and a width that sweeps
 * smoothly through the middle of a letter.
 *
 * Nothing fades. A selection is not a thing that dims -- it is made by
 * dragging and it is gone the instant it is released -- so the loop is a drag
 * to the end of the run, a hold, and then nothing. What does NOT go is the
 * agent: through the collapse its caret and its name stay exactly where the
 * drag ended, which is where releasing one actually leaves a cursor, and which
 * is the state the third presence on this graphic is already showing.
 *
 * That leaves one jump per loop, from the head back to the anchor, and it
 * lands on the frame the next drag begins -- so it reads as the click that
 * starts it rather than as a reset.
 */
function agentFrame(elapsed: number, chars: number) {
  if (elapsed >= chars * AGENT_CHAR_MS + AGENT_HOLD_MS)
    return { head: chars, selected: false };
  return {
    head: Math.min(chars, Math.floor(elapsed / AGENT_CHAR_MS)),
    selected: true,
  };
}

/**
 * The x of every character boundary in a run of text, in layout pixels from
 * its own left edge.
 *
 * Measured with a Range rather than stepped in equal fractions, because the
 * letters are not equal widths: stepping a percentage lands the selection's
 * edge inside an "m" as often as beside it, which is exactly the thing that
 * gives a fake selection away.
 *
 * The page paints at a scale factor, so the rects come back in visual pixels
 * while the offsets are written back as layout ones -- the same correction
 * DocCropBand makes for the same reason. It cannot be taken from the run
 * itself the way DocCropBand takes it from its wrapper: this host is an inline
 * span, and getComputedStyle reports width:auto for those, which would leave
 * the ratio NaN and every offset silently in the wrong unit.
 */
function visualScale(from: HTMLElement) {
  for (let el: HTMLElement | null = from; el; el = el.parentElement) {
    const layout = parseFloat(getComputedStyle(el).width);
    if (layout > 0) return el.getBoundingClientRect().width / layout;
  }
  return 1;
}

function measureCharacterStops(host: HTMLElement) {
  const node = host.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return [];
  const box = host.getBoundingClientRect();
  const scale = visualScale(host) || 1;
  const range = document.createRange();
  const stops: number[] = [];
  for (let i = 0; i <= (node.textContent?.length ?? 0); i += 1) {
    range.setStart(node, 0);
    range.setEnd(node, i);
    stops.push((range.getBoundingClientRect().right - box.left) / scale);
  }
  // A collapsed range at offset 0 has no rect of its own in some engines, so
  // the first stop can come back as the host's right edge rather than its
  // left. Pin it: nothing is selected before the first character.
  stops[0] = 0;
  return stops;
}

/**
 * An agent's selection: a rounded highlight, a straight rule under it, and its
 * tag attached on top.
 *
 * The rule is its own element, not an inset box-shadow. A shadow is clipped by
 * the highlight's border-radius, so it curled up at both ends and read as a
 * lozenge rather than an underline.
 *
 * 1px, below the 2px this started at. Straightening it was most of what made
 * it read as heavy: an inset shadow's 2px is interrupted by the radius at both
 * ends, so it never covered the full width, and matching that number on a rule
 * that does looked thicker than the thing it replaced.
 *
 * The drag
 * ---------------------------------------------------------------------------
 * The highlight grows one character at a time, and the caret and the name tag
 * ride its LEADING edge -- which is where a collaborator's presence actually
 * sits, at their cursor, not at the far end of what they have selected. All
 * three come off one clock and one measured table of character boundaries, so
 * the label cannot be a character ahead of or behind the edge it marks.
 *
 * Nothing is written until the band is on screen, and nothing at all under
 * reduced motion: the selection then renders exactly as it was drawn -- whole,
 * its tag at the left edge, no caret -- rather than frozen on some frame of a
 * drag it is never going to make.
 */
function AgentSelection(props: {
  name: string;
  color: string;
  children: JSX.Element;
  phase?: number;
}) {
  let words!: HTMLSpanElement;
  let mark!: HTMLSpanElement;
  let caret: HTMLSpanElement | undefined;
  let tag: HTMLSpanElement | undefined;
  const [stops, setStops] = createSignal<number[]>([]);
  const [elapsed, setElapsed] = createSignal(0);
  const [running, setRunning] = createSignal(false);

  // Re-measured when the crop's type scale flips, since the run is a different
  // string at a different size on a phone, and again once the web font lands.
  createEffect(() => {
    mobile();
    if (words) setStops(measureCharacterStops(words));
  });

  onMount(() => {
    if (document.fonts)
      void document.fonts.ready.then(() =>
        setStops(measureCharacterStops(words))
      );
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let id = 0;
    // null, not a negative number, as the "not started" sentinel: a phased
    // origin is legitimately negative for the first `phase` ms, and a `< 0`
    // test re-seeds it on every one of those frames. That leaves the clock
    // pinned until now catches up with the phase and then starts it from zero,
    // which looks like the stagger working and then quietly not.
    let origin: number | null = null;
    const tick = (now: number) => {
      if (origin === null) origin = now - (props.phase ?? 0);
      const cycle = agentCycleMs(Math.max(1, stops().length - 1));
      setElapsed((((now - origin) % cycle) + cycle) % cycle);
      id = requestAnimationFrame(tick);
    };
    // Off screen it does not run at all, and every arrival restarts it, so the
    // drag plays for whoever scrolls to it.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting === Boolean(id)) return;
        if (entry.isIntersecting) {
          origin = null;
          setRunning(true);
          id = requestAnimationFrame(tick);
        } else {
          cancelAnimationFrame(id);
          id = 0;
        }
      },
      { rootMargin: '160px 0px' }
    );
    observer.observe(mark);
    onCleanup(() => {
      observer.disconnect();
      if (id) cancelAnimationFrame(id);
    });
  });

  createEffect(() => {
    const table = stops();
    if (!running() || table.length < 2) return;
    const { head, selected } = agentFrame(elapsed(), table.length - 1);
    // The 4px is the wrapper's own side padding, both sides: the highlight
    // sits 2px outside the text at each end, so a selection of `head`
    // characters is that run plus both.
    const edge = table[head] ?? 0;
    mark.style.width = selected && head ? `${edge + 4}px` : '0px';
    // The caret is the highlight's right EDGE, not the text boundary 2px
    // inside it -- so it is placed off the same number the width is, less its
    // own 1px, rather than off the text. Held there through the collapse too,
    // where there is no highlight left to be flush with but the cursor has not
    // moved.
    if (caret) caret.style.left = `${edge + 3}px`;
    if (tag) tag.style.left = `${edge + 2}px`;
  });

  return (
    <span style={{ padding: '1px 2px', position: 'relative' }}>
      {/* The tint and the rule moved off the wrapper and into a layer of their
          own, so the pair can grow across the words while the words stay put.
          A background on the wrapper cannot do that: background-size has no
          effect on a colour, and clipping the wrapper would take the text with
          it. Anchored left and sized by width, so the rule underneath grows
          with the tint and stays one element rather than becoming a border the
          radius would curl.

          Full width until something drives it, and only then a pixel width:
          left-anchored with no width of its own it would shrink to fit, and
          since everything inside it is absolutely positioned that is nothing
          at all. Reduced motion would get a selection with no highlight. */}
      <span
        aria-hidden="true"
        ref={mark}
        style={{
          bottom: '0',
          left: '0',
          position: 'absolute',
          top: '0',
          width: '100%',
        }}
      >
        <span
          style={{
            'background-color': `color-mix(in srgb, ${props.color} 20%, transparent)`,
            'border-radius': '3px',
            inset: '0',
            position: 'absolute',
          }}
        />
        <span
          style={{
            'background-color': props.color,
            bottom: '0',
            height: '1px',
            left: '0',
            position: 'absolute',
            right: '0',
          }}
        />
      </span>
      {/* Positioned, and after the mark in source order, so the words paint
          over it: a positioned element outranks inline text in the painting
          order regardless of which came first, so leaving this static would
          bury the sentence under its own highlight. */}
      <span ref={words} style={{ position: 'relative' }}>
        {props.children}
      </span>
      {/* Only while it is being driven. Between drags the selection is zero
          wide, and a caret is the only thing left saying the agent is still
          there -- but a caret drawn on a graphic that never animates would be
          a mark the artwork was not drawn with. */}
      <Show when={running()}>
        <span
          aria-hidden="true"
          class="docs-agent-caret"
          ref={caret}
          style={{
            'background-color': props.color,
            height: '1.05em',
            left: '2px',
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '1px',
          }}
        />
      </Show>
      <AgentTag
        name={props.name}
        color={props.color}
        ref={(el) => (tag = el)}
      />
    </span>
  );
}

/**
 * An agent's caret, sized in em so it tracks the type.
 *
 * 1px, the width a text caret actually is. At 2px it was as heavy as the rule
 * under a selection and read as a mark on the page rather than a cursor in it.
 */
function AgentCaretMark(props: { name: string; color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        position: 'relative',
        'vertical-align': '-0.2em',
        width: '1px',
      }}
    >
      <span
        class="docs-agent-caret"
        style={{
          'background-color': props.color,
          display: 'inline-block',
          height: '1.05em',
          width: '1px',
        }}
      />
      <AgentTag name={props.name} color={props.color} left="0" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Document crop bands
//
// The treatment the version-history timeline earned, applied to type. Four
// things make that band work, and all four have to travel together:
//
//   1. The ink is a thin horizontal ribbon sitting in a tall, mostly empty
//      band, so the section reads as air with one incident in it.
//   2. It is dimmer than the section's own copy, so it reads as texture you
//      scan rather than as sentences you are asked to finish.
//   3. It runs past both viewport edges and dissolves into them, which is what
//      makes it a crop of something real instead of a boxed figure.
//   4. Exactly one place is fully present, and that is where the eye lands.
//
// The pass before this one broke (1) and (2): the crop was sized as a
// percentage of the viewport, which blew a single word up larger than the
// section headline and left three near-white lines chopped off mid-sentence.
// Hence the fixed pixel type scale below, at the size the app itself renders
// at; narrow viewports simply see less of the document, which is how a crop
// should behave.
// ---------------------------------------------------------------------------

/** Ink levels, both deliberately dimmer than the section's own body copy. */
const CROP_INK =
  'var(--docs-crop-ink, color-mix(in srgb, var(--c4) 74%, transparent))';
const CROP_INK_SOFT = 'color-mix(in srgb, var(--c4) 44%, transparent)';

/**
 * Type scale of the crop: what the app renders a document at.
 *
 * A phone gets a notch smaller, and the focal runs get shorter labels (see
 * cropShort), because a fixed pixel crop cannot scale its way out of a 375px
 * viewport: at the desktop scale the four mention pills measure 545px, so two
 * of them are simply outside the band and the claim arrives half told.
 */
const cropFont = () => (mobile() ? 13 : 15);

/** Distance between lines, wide enough to clear the agent presence tags. */
const cropPitch = () => (mobile() ? 15 : 18);

/**
 * How far past the focal cluster the bloom keeps any density, in pixels.
 *
 * Tuned against the line pitch (roughly twice it) rather than the band height:
 * it leaves the focal line fully present, its neighbours around 60%, and
 * everything beyond them a ghost, which is the ribbon shape the timeline has.
 */
const cropBloomPad = () => (mobile() ? 76 : 88);

/** Short form of a focal label, so the cluster still fits a phone. */
const cropShort = (long: string, short: string) => (mobile() ? short : long);

function cropLine(soft?: boolean): JSX.CSSProperties {
  return {
    color: soft ? CROP_INK_SOFT : CROP_INK,
    'font-family': appFont,
    'font-size': `${cropFont()}px`,
    'line-height': 1.75,
    margin: '0',
    'white-space': 'nowrap',
  };
}

/**
 * A two-axis fade that is opaque only around the focal cluster.
 *
 * Horizontal-only (what the timeline uses) is not enough for type: a fade that
 * leaves five full-brightness lines standing reads as a wall of copy no matter
 * how far it runs. Falling away vertically as well is what turns the crop into
 * a ribbon, and it is the "more drastic" part of the fade.
 *
 * Radii are mixed on purpose: horizontal as a percentage, so it always reaches
 * the far viewport edge, and vertical in pixels, so the ribbon is the same
 * number of lines thick at every width.
 */
function cropBloom(peak: number, ry: number, cy: number) {
  const ramp = [
    [0, 1],
    [0.2, 1],
    [0.34, 0.82],
    [0.48, 0.58],
    [0.62, 0.34],
    [0.76, 0.16],
    [0.89, 0.05],
    [1, 0],
  ] as const;
  const stops = ramp
    .map(([t, a]) => `rgb(0 0 0 / ${a}) ${Math.round(t * 100)}%`)
    .join(', ');
  const rx = (Math.max(peak, 100 - peak) * 0.95).toFixed(1);
  return `radial-gradient(${rx}% ${Math.round(ry)}px at ${peak}% ${Math.round(cy)}px, ${stops})`;
}

/** A run of the document the band should bloom around. */
function CropFocus(props: { children: JSX.Element }) {
  return (
    <span data-band-focus style={{ 'white-space': 'nowrap' }}>
      {props.children}
    </span>
  );
}

/**
 * A crop of a document, run past both viewport edges and bloomed around its
 * focal cluster.
 *
 * The placement is measured rather than declared: every element marked
 * data-band-focus is unioned, the crop is offset so that union's centre lands
 * at peak% across the viewport, and the bloom is centred and sized on the same
 * box. Hand-tuned offsets are what drifted apart on the timeline (the
 * artwork's focal point and the fade's peak were two separate numbers that had
 * to be kept in agreement by hand), and measuring also survives copy edits and
 * a web font that arrives after first paint.
 */
function DocCropBand(props: {
  children: JSX.Element;
  label: string;
  peak?: number;
}) {
  // Centred on a phone: the cluster is wide relative to the viewport there, so
  // any peak off centre spends the room it needs on one side.
  const peak = () => (mobile() ? 50 : (props.peak ?? 48));
  let wrap!: HTMLDivElement;
  let crop!: HTMLDivElement;
  const [shift, setShift] = createSignal(0);
  const [bloom, setBloom] = createSignal('');

  const measure = () => {
    if (!wrap || !crop) return;
    const marks = Array.from(
      crop.querySelectorAll<HTMLElement>('[data-band-focus]')
    );
    if (!marks.length) return;
    // The page paints at a scale factor, so getBoundingClientRect returns
    // visual pixels while the margin and mask we write back are in layout
    // pixels. Divide the measured offsets by the ratio between the two, or the
    // focal point lands short of its peak by exactly that factor.
    const layoutWidth = parseFloat(getComputedStyle(wrap).width);
    if (!layoutWidth) return;
    const box = wrap.getBoundingClientRect();
    const scale = box.width / layoutWidth || 1;

    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const mark of marks) {
      // Descendants included: an agent's name tag is absolutely positioned, so
      // it sits outside its own mark's box. Leave it out and the union is a
      // caret's 2px wide, which parks the tag itself past the band's edge.
      for (const node of [mark, ...Array.from(mark.querySelectorAll('*'))]) {
        const rect = node.getBoundingClientRect();
        left = Math.min(left, rect.left);
        right = Math.max(right, rect.right);
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
      }
    }

    // Offsets are taken against the crop, not the viewport, so re-measuring
    // once the offset is applied gives the same answer.
    const focusX =
      ((left + right) / 2 - crop.getBoundingClientRect().left) / scale;
    setShift((layoutWidth * peak()) / 100 - focusX);
    setBloom(
      cropBloom(
        peak(),
        (bottom - top) / 2 / scale + cropBloomPad(),
        ((top + bottom) / 2 - box.top) / scale
      )
    );
  };

  onMount(() => {
    measure();
    if (document.fonts) void document.fonts.ready.then(measure);
    const observer = new ResizeObserver(() => measure());
    observer.observe(wrap);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      ref={wrap}
      role="img"
      aria-label={props.label}
      style={{
        '-webkit-mask-image': bloom() || undefined,
        'mask-image': bloom() || undefined,
        'margin-top': mobile() ? '30px' : '52px',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <div
        ref={crop}
        style={{
          display: 'grid',
          gap: `${cropPitch()}px`,
          'margin-left': `${Math.round(shift())}px`,
          'padding-block': '14px',
          width: 'max-content',
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

/**
 * @mentions: a crop of a planning doc whose dependencies are linked inline.
 *
 * Four mentions of four different kinds, side by side in one sentence, is the
 * whole claim in a single glance: a person, a doc, a task and a channel all
 * resolve as objects. Static, like the timeline. The animated version cycled
 * one mention through those kinds instead, which meant the claim was only ever
 * one quarter visible, and it was borrowed from the chat page (a message
 * bubble, complete with its own card and border) so at band scale it read as a
 * giant chat message floating in a ghost box.
 */
export function DocsMentionCropGraphic() {
  return (
    <DocCropBand label="A crop of a planning document whose dependencies are @mentioned inline: a person, a doc, a task and a channel, each resolving to the object itself">
      <p style={cropLine(true)}>
        Everything for the beta cut lives here, so nobody has to reconstruct the
        state of it out of three different channels. The release note is
        drafted, the rollback is written but never rehearsed, and the embargo
        window still overlaps the announcement by four hours.
      </p>
      <p style={cropLine()}>
        Sequencing is the only thing still open. We can hold the announcement,
        or we can ship behind the flag on Wednesday night and let the note go
        out on time.
      </p>
      <p style={cropLine()}>
        Everything this depends on is linked rather than pasted, because half of
        it gets renamed before Thursday and this doc should still be right
        afterwards:{' '}
        <CropFocus>
          <MentionPill kind="person" label={cropShort('Julia Chen', 'Julia')} />
          ,{' '}
          <MentionPill
            kind="doc"
            label={cropShort('Rollback runbook', 'Runbook')}
          />
          ,{' '}
          <MentionPill
            kind="task"
            label={cropShort('Ship beta to 5% of accounts', 'Ship beta')}
          />
          , <MentionPill kind="channel" label="launch" />
        </CropFocus>
        . None of them are URLs, so renaming or moving any of them changes
        nothing here.
      </p>
      <p style={cropLine()}>
        Priya runs the go/no-go at eight. The only thing she wants answered is
        whether the rollback has been rehearsed end to end against the staging
        fleet rather than a single worker.
      </p>
      <p style={cropLine(true)}>
        If the numbers hold through the first hour we widen to twenty percent
        the same afternoon. If they do not, we roll back and take the whole
        thing to the Monday review instead of patching it in place.
      </p>
    </DocCropBand>
  );
}

/**
 * Agents as teammates: a crop of an incident review with three agents in it.
 *
 * All three presences held at once, and clustered on adjacent lines so they
 * bloom as one focal point rather than three competing ones. The section's
 * claim is that several agents work alongside you, which a sequence showing
 * one agent at a time could never make.
 */
export function DocsAgentTeammateGraphic(
  props: { launchReview?: boolean } = {}
) {
  return (
    <>
      <style>{`
        /* All the way out and all the way back, on steps(1), because that is
           what a text cursor does. The two carets elsewhere on this page blink
           to a floor of 0.25 and 0.2, but those sit in editor chrome where the
           caret is one mark among many; this one is standing in for a person
           in the document, and a cursor that only half leaves reads as a
           flicker rather than a blink.

           Every other part of this graphic is driven from a clock in
           AgentSelection instead, because it has to land on measured character
           boundaries and CSS cannot know where those are. */
        @keyframes docsAgentCaretBlink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0; } }
        @media (prefers-reduced-motion: no-preference) {
          .docs-agent-caret { animation: docsAgentCaretBlink 1.06s steps(1) infinite; }
        }
      `}</style>
      <DocCropBand
        label="Q3 launch plan: agents correct the launch date to Thursday and check it against Dana’s email"
        peak={46}
      >
        <p style={cropLine(true)}>
          Q3 launch plan. Gabriel owns the checklist, Teo is checking the invite
          flow, and Dana is waiting for the final plan before the team call.
        </p>
        <p style={cropLine()}>
          The team will run through onboarding before we share the plan. Every
          invited teammate should arrive with the right workspace and context.
        </p>
        <p style={cropLine()}>
          Launch is confirmed for <del style={{ opacity: 0.45 }}>Friday</del>{' '}
          <CropFocus>
            <AgentSelection name="Claude" color={COLLAB_A}>
              {cropShort('Thursday, 9:00 AM', 'Thursday')}
            </AgentSelection>
          </CropFocus>
          {cropShort(', matching the email sent to Dana', ', per Dana’s email')}
          <Show when={!props.launchReview}>
            <CropFocus>
              <AgentCaretMark name="Reviewer" color={COLLAB_B} />
            </CropFocus>
          </Show>
          . Gabriel will share the checklist with everyone before the call.
        </p>
        <p style={cropLine()}>
          Before the plan goes out, Teo will{' '}
          <CropFocus>
            <Show
              when={!props.launchReview}
              fallback={cropShort(
                'check the team invite flow',
                'check invites'
              )}
            >
              <AgentSelection name="Researcher" color={COLLAB_C} phase={2900}>
                {cropShort('check the team invite flow', 'check invites')}
              </AgentSelection>
            </Show>
          </CropFocus>
          . Invited teammates should land in onboarding with their team intact.
        </p>
        <p style={cropLine(true)}>
          Share the updated plan in the launch channel. Send Dana the link once
          the invite check is complete, keeping the original email attached.
        </p>
      </DocCropBand>
    </>
  );
}

// ---------------------------------------------------------------------------
// Comments & history graphic
// ---------------------------------------------------------------------------

export function CommentsGraphic() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '14px',
        'justify-items': 'center',
        padding: compact() ? '32px 18px' : '44px 24px',
        width: '100%',
      }}
    >
      {/* Comment thread anchored to a selection */}
      <div
        style={{
          'background-color': 'color-mix(in srgb, var(--b1) 70%, var(--b0))',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(440px, 100%)',
          '-webkit-mask-image':
            'linear-gradient(to bottom, #000 0%, #000 72%, transparent 100%)',
          'mask-image':
            'linear-gradient(to bottom, #000 0%, #000 72%, transparent 100%)',
        }}
      >
        <div
          style={{
            'box-sizing': 'border-box',
            padding: compact() ? '16px 14px 4px' : '18px 16px 6px',
          }}
        >
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '14px' : '15px',
              'line-height': 1.7,
            }}
          >
            Aiming for #1 Product of the Day:{' '}
            <span
              style={{
                'background-color':
                  'color-mix(in srgb, var(--a0) 24%, transparent)',
                'border-bottom': '2px solid var(--a0)',
                padding: '1px 1px',
              }}
            >
              the first hour matters
            </span>
          </span>
        </div>
        {/* Thread */}
        <div
          style={{
            'border-top': '1px solid var(--b2)',
            display: 'grid',
            gap: '14px',
            'margin-top': '12px',
            padding: compact() ? '14px' : '14px 16px',
          }}
        >
          <div style={{ display: 'grid', gap: '6px' }}>
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
            >
              <Avatar initials="JW" size={22} image={avatarJulia} />
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '13px',
                  'font-weight': '600',
                }}
              >
                Julia Westphal
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '11.5px',
                }}
              >
                11:38 AM
              </span>
              <span
                style={{
                  'align-items': 'center',
                  color: 'var(--c4)',
                  display: 'inline-flex',
                  gap: '5px',
                  'margin-left': 'auto',
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    d="M5 12l4.5 4.5L19 7"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </span>
            </div>
            <p
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': '13.5px',
                'line-height': 1.5,
                margin: '0',
                'padding-left': '30px',
              }}
            >
              Can <MentionPill kind="person" label="Jacob" initials="JB" />{' '}
              confirm the embargo time?
            </p>
          </div>
          <div
            style={{
              'align-items': 'center',
              'background-color': 'var(--b0)',
              border:
                '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
              'border-radius': '999px',
              display: 'flex',
              gap: '8px',
              padding: '7px 14px',
            }}
          >
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '13px',
              }}
            >
              Reply…
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties graphic — Notion-like database panel
// ---------------------------------------------------------------------------

// The bare Notion-style details/properties panel card (no surrounding padding),
// so it can be dropped into a spotlight composition or the padded standalone
// graphic below.
export function PropertiesPanel() {
  const rowStyle: JSX.CSSProperties = {
    'align-items': 'center',
    display: 'flex',
    gap: '12px',
    padding: '8px 14px',
  };
  const keyStyle: JSX.CSSProperties = {
    color: 'var(--c4)',
    'font-family': appFont,
    'font-size': '12.5px',
    width: '96px',
    flex: 'none',
  };
  const valStyle: JSX.CSSProperties = {
    'align-items': 'center',
    color: 'var(--c1)',
    display: 'flex',
    'font-family': appFont,
    'font-size': '12.5px',
    gap: '7px',
  };
  return (
    <div
      style={{
        'background-color': docsSurfaceL2,
        border: `1px solid ${docsPanelBorder}`,
        'border-radius': '12px',
        'box-shadow': '0 22px 60px rgb(0 0 0 / 0.5)',
        'box-sizing': 'border-box',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      {/* toolbar */}
      <div
        style={{
          'align-items': 'center',
          'border-bottom': `1px solid ${docsPanelBorder}`,
          display: 'flex',
          gap: '8px',
          'justify-content': 'flex-end',
          padding: '10px 12px',
        }}
      >
        <span
          style={{
            'align-items': 'center',
            border: '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
            'border-radius': '7px',
            color: 'var(--c2)',
            display: 'inline-flex',
            'font-family': appFont,
            'font-size': '12px',
            gap: '6px',
            padding: '4px 9px',
          }}
        >
          <IconAgentStar
            style={{
              color: 'var(--c2)',
              display: 'block',
              flex: 'none',
              height: '13px',
              width: '13px',
            }}
          />{' '}
          Chat
        </span>
        <span
          style={{
            'align-items': 'center',
            border: '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
            'border-radius': '7px',
            color: 'var(--c2)',
            display: 'inline-flex',
            'font-family': appFont,
            'font-size': '12px',
            gap: '6px',
            padding: '4px 9px',
          }}
        >
          <IconShareMacro
            style={{
              color: 'var(--c2)',
              display: 'block',
              flex: 'none',
              height: '13px',
              width: '13px',
            }}
          />{' '}
          Share
        </span>
      </div>
      {/* Details */}
      <div style={{ padding: '10px 0 6px' }}>
        <div
          style={{
            'align-items': 'center',
            color: 'var(--c4)',
            display: 'flex',
            'font-family': appFont,
            'font-size': '11.5px',
            'font-weight': '600',
            gap: '6px',
            padding: '2px 14px 8px',
          }}
        >
          <ChevronGlyph size={11} /> Details
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>Owner</span>
          <span style={valStyle}>
            <Avatar initials="JW" size={18} image={avatarJulia} /> Julia
            Westphal
          </span>
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>Created</span>
          <span style={{ ...valStyle, color: 'var(--c2)' }}>
            <span style={{ color: 'var(--c4)' }}>
              <ClockTinyGlyph size={13} />
            </span>{' '}
            05/20/26 at 10:05 AM
          </span>
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>Last updated</span>
          <span style={{ ...valStyle, color: 'var(--c2)' }}>
            <span style={{ color: 'var(--c4)' }}>
              <ClockTinyGlyph size={13} />
            </span>{' '}
            05/20/26 at 10:10 AM
          </span>
        </div>
      </div>
      {/* Properties */}
      <div
        style={{
          'border-top': `1px solid ${docsPanelBorder}`,
          padding: '10px 0 6px',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            color: 'var(--c4)',
            display: 'flex',
            'font-family': appFont,
            'font-size': '11.5px',
            'font-weight': '600',
            gap: '6px',
            padding: '2px 14px 8px',
          }}
        >
          <ChevronGlyph size={11} /> Properties
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>Assignee</span>
          <span style={valStyle}>
            <Avatar initials="JB" size={18} color="var(--b3)" /> Jacob B.
          </span>
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>Task</span>
          <span style={valStyle}>
            <span style={{ color: 'var(--a0)', display: 'inline-flex' }}>
              <BlockGlyph name="task" size={13} />
            </span>{' '}
            PRJ-128
          </span>
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>Urgency</span>
          <span
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--a0) 16%, transparent)',
              'border-radius': '5px',
              color: 'var(--a0)',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '11.5px',
              padding: '2px 8px',
            }}
          >
            High
          </span>
        </div>
        <div style={{ ...rowStyle, color: 'var(--c4)' }}>
          <span
            style={{
              'align-items': 'center',
              color: 'var(--c4)',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '12.5px',
              gap: '7px',
            }}
          >
            <span style={{ 'font-size': '14px' }}>+</span> Add property
          </span>
        </div>
      </div>
      {/* Stats */}
      <div
        style={{
          'border-top': `1px solid ${docsPanelBorder}`,
          padding: '10px 0 12px',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            color: 'var(--c4)',
            display: 'flex',
            'font-family': appFont,
            'font-size': '11.5px',
            'font-weight': '600',
            gap: '6px',
            padding: '2px 14px 8px',
          }}
        >
          <ChevronGlyph size={11} /> Stats
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>Words</span>
          <span style={{ ...valStyle, color: 'var(--c2)' }}>642</span>
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>Characters</span>
          <span style={{ ...valStyle, color: 'var(--c2)' }}>3,914</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown autoformat graphic — type markdown, get blocks
// ---------------------------------------------------------------------------

const markdownRules: { token: string; label: string }[] = [
  { token: '#', label: 'Heading 1' },
  { token: '##', label: 'Heading 2' },
  { token: '-', label: 'Bullet' },
  { token: '1.', label: 'Numbered' },
  { token: '[]', label: 'To-do' },
  { token: '>', label: 'Quote' },
  { token: '```', label: 'Code' },
  { token: '---', label: 'Divider' },
];

export function MarkdownGraphic(props: { columns?: number } = {}) {
  const columns = () => props.columns ?? (mobile() ? 2 : 4);
  return (
    <div
      style={{
        display: 'grid',
        gap: mobile() ? '10px' : '12px',
        'grid-template-columns': `repeat(${columns()}, minmax(0, 1fr))`,
        width: '100%',
        'max-width': '760px',
      }}
    >
      <For each={markdownRules}>
        {(rule) => (
          <div
            style={{
              'align-items': 'center',
              'box-sizing': 'border-box',
              display: 'flex',
              gap: '10px',
              padding: mobile() ? '12px 12px' : '14px 16px',
            }}
          >
            <span
              style={{
                'align-items': 'center',
                'background-color': 'var(--b0)',
                border:
                  '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
                'border-radius': '6px',
                color: 'var(--a0)',
                display: 'inline-grid',
                flex: 'none',
                'font-family':
                  "ui-monospace, 'SFMono-Regular', Menlo, monospace",
                'font-size': '13px',
                'font-weight': '700',
                'min-width': '34px',
                padding: '5px 7px',
                'place-items': 'center',
              }}
            >
              {rule.token}
            </span>
            <span
              style={{ color: 'var(--c4)', flex: 'none', 'font-size': '13px' }}
            >
              →
            </span>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': mobile() ? '13px' : '13.5px',
                'min-width': 0,
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
              }}
            >
              {rule.label}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notion import graphic — agent migrates your docs
// ---------------------------------------------------------------------------

const importSteps = [
  { label: 'Connecting to Notion via MCP' },
  { label: 'Found 42 pages in "Engineering"' },
  { label: 'Converting to markdown' },
  { label: 'Rebuilding pages as docs' },
];
const importedDocs = [
  'Engineering wiki',
  'RFC · Realtime sync',
  'On-call runbook',
  'Architecture overview',
];

function _ImportGraphic() {
  // The import flow now lives inside a phone screen, so it always uses the
  // narrow/compact type scale regardless of the surrounding viewport.
  const compact = () => true;
  return (
    <PhoneFrame>
      <PhoneScreenContent>
        {/* User prompt */}
        <div
          style={{
            'background-color': 'color-mix(in srgb, var(--b1) 80%, var(--b0))',
            border: '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
            'border-radius': '14px 14px 4px 14px',
            'box-sizing': 'border-box',
            'justify-self': 'end',
            'margin-bottom': '14px',
            'max-width': '84%',
            padding: '11px 14px',
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
            Import my Notion docs from the{' '}
            <span
              style={{
                'background-color':
                  'color-mix(in srgb, var(--a0) 16%, transparent)',
                'border-radius': '5px',
                color: 'var(--a0)',
                padding: '1px 6px',
                'white-space': 'nowrap',
              }}
            >
              Engineering
            </span>{' '}
            workspace as Macro docs. Skip anything archived.
          </span>
        </div>

        {/* Agent response */}
        <div style={{ display: 'grid', gap: '10px' }}>
          <div style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}>
            <span
              style={{
                'align-items': 'center',
                background:
                  'linear-gradient(135deg, var(--a0), color-mix(in srgb, var(--a0) 55%, var(--b0)))',
                'border-radius': '999px',
                color: 'var(--b0)',
                display: 'inline-flex',
                flex: 'none',
                height: '20px',
                'justify-content': 'center',
                width: '20px',
              }}
            >
              <SparkleGlyph size={12} />
            </span>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '12.5px',
                'font-weight': '600',
              }}
            >
              Macro Agent
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              'grid-template-columns': '18px 1fr',
              'column-gap': '10px',
            }}
          >
            <For each={importSteps}>
              {(step, i) => (
                <>
                  <div
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
                          'color-mix(in srgb, var(--a0) 18%, transparent)',
                        'border-radius': '999px',
                        color: 'var(--a0)',
                        display: 'inline-flex',
                        flex: 'none',
                        height: '18px',
                        'justify-content': 'center',
                        width: '18px',
                      }}
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          d="M5 12l4.5 4.5L19 7"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2.6"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </span>
                    <Show when={i() < importSteps.length - 1}>
                      <span
                        aria-hidden="true"
                        style={{
                          'background-color':
                            'color-mix(in srgb, var(--c1) 22%, transparent)',
                          'border-radius': '1px',
                          flex: '1',
                          'min-height': '12px',
                          width: '2px',
                        }}
                      />
                    </Show>
                  </div>
                  <span
                    style={{
                      'align-self': 'start',
                      color: 'var(--c4)',
                      'font-family': appFont,
                      'font-size': '12.5px',
                      'line-height': 1.4,
                      'padding-bottom':
                        i() < importSteps.length - 1 ? '12px' : '0',
                    }}
                  >
                    {step.label}
                  </span>
                </>
              )}
            </For>
          </div>

          {/* Imported docs card */}
          <div
            style={{
              'background-color': 'var(--b0)',
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
                'border-bottom': '1px solid var(--b2)',
                display: 'flex',
                gap: '8px',
                padding: '10px 14px',
              }}
            >
              <MacroNavIcon name="files" size={14} />
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '12.5px',
                  'font-weight': '600',
                }}
              >
                Engineering
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '11.5px',
                  'margin-left': 'auto',
                }}
              >
                42 imported
              </span>
            </div>
            <For each={importedDocs}>
              {(doc, i) => (
                <div
                  style={{
                    'align-items': 'center',
                    'border-bottom':
                      i() === importedDocs.length - 1
                        ? '0'
                        : '1px solid var(--b2)',
                    display: 'flex',
                    gap: '10px',
                    padding: '9px 14px',
                  }}
                >
                  <DocFileGlyph size={15} />
                  <span
                    style={{
                      color: 'var(--c1)',
                      'font-family': appFont,
                      'font-size': '13.5px',
                    }}
                  >
                    {doc}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </PhoneScreenContent>
    </PhoneFrame>
  );
}

// ---------------------------------------------------------------------------
// Comparison table (Macro vs Notion vs Obsidian vs Google Docs vs Confluence)
// ---------------------------------------------------------------------------

type Cell = boolean | 'partial' | string;

const comparisonColumns = [
  'Macro',
  'Notion',
  'Obsidian',
  'Google Docs',
  'Confluence',
];

const comparisonRows: {
  feature: string;
  cells: [Cell, Cell, Cell, Cell, Cell];
}[] = [
  {
    feature: 'Markdown-native documents',
    cells: [true, 'partial', true, false, false],
  },
  {
    feature: 'Built-in tasks, CRM & email',
    cells: [true, 'partial', false, false, false],
  },
  {
    feature: '@mention people, docs, tasks & channels',
    cells: [true, 'partial', 'partial', false, 'partial'],
  },
  {
    feature: 'Real-time, offline-capable editing (CRDT)',
    cells: [true, 'partial', 'partial', 'partial', false],
  },
  { feature: 'Inline comment threads', cells: [true, true, false, true, true] },
  {
    feature: 'Version history & fork a past version',
    cells: [true, 'partial', 'partial', 'partial', 'partial'],
  },
  {
    feature: 'Properties / database experience',
    cells: [true, true, 'partial', false, 'partial'],
  },
  {
    feature: 'One unified search across everything',
    cells: [true, false, false, false, false],
  },
  {
    feature: 'Agents with full-workspace context',
    cells: [true, 'partial', false, false, false],
  },
  {
    feature: 'Open source (AGPLv3)',
    cells: [true, false, false, false, false],
  },
  { feature: 'Price / seat / month', cells: ['$40', '$10', '$4', '$12', '$6'] },
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
      ? 'minmax(140px, 1.5fr) repeat(5, minmax(56px, 1fr))'
      : 'minmax(0, 2.2fr) minmax(0, 1fr) repeat(4, minmax(0, 1fr))';

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
          border: '1px solid var(--b2)',
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': gridTemplate(),
          'min-width': mobile() ? '560px' : 'auto',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            'background-color': 'var(--b0)',
            'border-bottom': '1px solid var(--b2)',
          }}
        />
        <For each={comparisonColumns}>
          {(col, index) => (
            <div
              style={{
                ...headerCellStyle(index() === 0),
                'border-bottom':
                  index() === 0 ? '1px solid var(--a0)' : '1px solid var(--b2)',
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
                      : '1px solid var(--b2)',
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
                          : '1px solid var(--b2)',
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
    q: 'How is Macro different from Notion?',
    a: (
      <>
        Notion asks you to build your own tools out of markdown pages and
        databases. Macro gives you purpose-built blocks (docs, tasks, CRM,
        email, and channels) that share one data model and one search index. You
        give up some freeform database flexibility, but each block works like a
        real product and agents can read all of it as one context. See our{' '}
        <a href="https://youtu.be/hyU1XYmxkYM" target="_blank" rel="noreferrer">
          comparison video
        </a>
        .
      </>
    ),
  },
  {
    q: 'Can I import my Notion docs?',
    a: (
      <>
        Yes. Connect Notion under <strong>Settings → Connectors</strong>, then
        open an agent chat and ask it to import. For example: "Import my Notion
        docs from the Engineering workspace, skip archived." Both sides are
        markdown-native, so the import is clean. You can also keep Notion
        connected via MCP so agents can reference legacy content.
      </>
    ),
  },
  {
    q: 'Are documents really just markdown?',
    a: (
      <>
        Yes. Documents are markdown-native text files. The editor supports the
        full set of block nodes (headings, lists, checkboxes, tables, code with
        syntax highlighting, images, video, and inline/block math with KaTeX),
        and markdown autoformatting works as you type. You can export any
        document back to plain markdown at any time.
      </>
    ),
  },
  {
    q: 'How does collaboration work?',
    a: (
      <>
        Edits from teammates appear almost instantly, as if you were on the same
        machine, and edits to the same line resolve without thrashing. Macro
        uses CRDTs so multiple people can type in the same doc simultaneously,
        and you can keep working with no network connection.
      </>
    ),
  },
  {
    q: 'What does @mentioning a doc do?',
    a: (
      <>
        @mentions tie a document to the rest of your workspace. Mention a
        person, task, channel, or another doc and it renders as a collapsible
        inline pill. Mentioning something in a <strong>channel</strong> shares
        it with every member automatically, so no more "can you give me access?"
        Note that mentioning a person in a document's body does not notify them;
        mentioning them in a comment does.
      </>
    ),
  },
  {
    q: 'Who can see a document I share?',
    a: (
      <>
        Documents use standard access levels: owner, editor, commenter, and
        viewer. You can share with people outside Macro by email, or with a
        public URL link if you enable the Public Link. People who aren't signed
        in see a preview without having to create an account.
      </>
    ),
  },
  {
    q: 'Is Macro open source?',
    a: (
      <>
        Yes. Macro is fully open source under the AGPLv3 (as of May 31 2026),
        not "open core." To build on Macro under a different license, contact{' '}
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
        'align-items': 'center',
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '24px' : '40px',
        'justify-items': 'center',
        padding: mobile() ? '48px 0' : '72px 0',
        width: '100%',
      }}
    >
      <style>{`
        .docs-faq__item { border-bottom: 1px solid var(--b2); }
        .docs-faq__item > summary {
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
        .docs-faq__item > summary::-webkit-details-marker { display: none; }
        .docs-faq__item > summary .docs-faq__chevron { color: var(--c4); flex-shrink: 0; transition: transform 220ms ease; }
        .docs-faq__item[open] > summary .docs-faq__chevron { transform: rotate(180deg); }
        .docs-faq__answer { color: var(--c4); font-size: 16px; line-height: 1.6; margin: 0; padding: 0 4px 24px; max-width: 760px; }
        .docs-faq__answer a { color: var(--a0); text-decoration: none; }
        @media (hover) {
          .docs-faq__item > summary:hover { color: var(--a0); }
          .docs-faq__answer a:hover { text-decoration: underline; }
        }
        @media (max-width: 700px) {
          .docs-faq__item > summary { font-size: 17px; padding: 18px 4px; }
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
        <h2
          style={{
            'font-family': 'display',
            'font-size': mobile() ? '34px' : '42px',
            'font-weight': '420',
            'letter-spacing': '-0.018em',
            'line-height': 1.1,
            margin: 0,
          }}
        >
          Questions, answered
        </h2>
      </div>
      <div
        style={{
          'border-top': '1px solid var(--b2)',
          width: '100%',
          'max-width': '860px',
        }}
      >
        <For each={faqItems}>
          {(item) => (
            <details class="docs-faq__item">
              <summary>
                <span>{item.q}</span>
                <svg
                  class="docs-faq__chevron"
                  width="16"
                  height="16"
                  viewBox="0 0 256 256"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
                </svg>
              </summary>
              <p class="docs-faq__answer">{item.a}</p>
            </details>
          )}
        </For>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const _SlashMenuTablesGraphic = () => <SlashMenuGraphic highlightIndex={3} />;
const _SlashMenuCodeGraphic = () => <SlashMenuGraphic highlightIndex={2} />;
