import {
  type Component,
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
import IconChannelMacro from '../../../assets/icons/wide-channel.svg';
import IconFileMacro from '../../../assets/icons/wide-file-md.svg';
import IconTaskMacro from '../../../assets/icons/wide-task.svg';
import avatarGabriel from '../../../assets/people/gabriel.webp';
import avatarJacob from '../../../assets/people/jacob.webp';
import avatarJulia from '../../../assets/people/julia.webp';
import { breakpoint, isMobileViewport } from '../../utils/utilBreakpoint';
import {
  CtaIcon,
  ctaHref,
  ctaLabel,
  handleCtaClick,
} from '../../utils/utilCta';
import { TabsInset } from '../graphics/MockupChrome';
import { PreviewWindow } from '../graphics/PreviewWindow';
import { SsgDesktop, SsgMobile } from '../utils/SsgGate';

const _HERO_DEMO_VIDEO_ID = '1gDOXUxHo0U'; // "What Macro learned from Slack/Superhuman"
const MACRO_REPO_URL = 'https://github.com/macro-inc/macro';

// ---------------------------------------------------------------------------
// Shared style fragments (matching the homepage / email / docs bento language)
// ---------------------------------------------------------------------------

const mobile = isMobileViewport;

// Faux-app chrome uses a neutral UI sans so the mocks read as real product
// screenshots rather than marketing copy.
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// In-app object accents: blue docs, green tasks, amber people/brand.
const DOC_BLUE = 'var(--a4)';
const TASK_GREEN = 'var(--a2)';
// Markdown / note documents render in the app's `--color-note` hue — the accent
// rotated to a violet (293°), keeping the accent's lightness + chroma. This is
// the exact color the real editor uses for an inline document @mention.
const NOTE_VIOLET = 'oklch(from var(--a0) l c 293deg)';

function eyebrowStyle(): JSX.CSSProperties {
  return {
    color: 'var(--a0)',
    'font-family': 'rajdhani, body',
    'font-size': breakpoint() ? '12px' : '16px',
    'letter-spacing': '0.08em',
    'text-transform': 'uppercase',
  };
}

function _ConnectGoogleButton(props: { buttonName: string; large?: boolean }) {
  return (
    <a
      href={ctaHref()}
      class="channels-cta-button"
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
function _GithubStarButton() {
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
      class="channels-cta-button"
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

// Real headshots for the recurring fictional teammates, keyed by their
// initials so every graphic on the page shows a consistent face.
const AVATAR_PHOTOS: Record<string, string> = {
  GB: avatarGabriel,
  JW: avatarJulia,
  JB: avatarJacob,
};

function Avatar(props: {
  initials: string;
  size?: number;
  color?: string;
  image?: string;
}) {
  const s = props.size ?? 26;
  const photo = () => props.image ?? AVATAR_PHOTOS[props.initials];
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': props.color ?? 'var(--b3)',
        border: '1px solid color-mix(in srgb, var(--c1) 16%, transparent)',
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
      <Show when={photo()} fallback={props.initials}>
        <img
          src={photo()}
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

// Back / forward navigation chevrons shown in the channel header.
function NavCaret(props: { dir: 'left' | 'right'; size?: number }) {
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
        d={props.dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        fill="none"
        stroke="currentColor"
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

// Channel indicator — the Macro app's channel icon.
function HashGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 15;
  return (
    <IconChannelMacro
      aria-hidden="true"
      style={{
        color: props.color ?? 'var(--c4)',
        display: 'block',
        flex: 'none',
        height: `${s}px`,
        width: `${s}px`,
      }}
    />
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

// The blue document icon — the Macro app's documents icon.
function DocFileGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 16;
  return (
    <IconFileMacro
      aria-hidden="true"
      style={{
        color: props.color ?? DOC_BLUE,
        display: 'block',
        flex: 'none',
        height: `${s}px`,
        width: `${s}px`,
      }}
    />
  );
}

// The green task icon — the Macro app's tasks icon.
function TaskListGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 16;
  return (
    <IconTaskMacro
      aria-hidden="true"
      style={{
        color: props.color ?? TASK_GREEN,
        display: 'block',
        flex: 'none',
        height: `${s}px`,
        width: `${s}px`,
      }}
    />
  );
}

function PriorityGlyph(props: { size?: number }) {
  const s = props.size ?? 13;
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
        y="13"
        width="4"
        height="7"
        rx="1"
        fill="currentColor"
        opacity="0.95"
      />
      <rect
        x="10"
        y="8"
        width="4"
        height="12"
        rx="1"
        fill="currentColor"
        opacity="0.95"
      />
      <rect
        x="17"
        y="3"
        width="4"
        height="17"
        rx="1"
        fill="currentColor"
        opacity="0.4"
      />
    </svg>
  );
}

// The phone / call icon — the Macro app's calls icon.
function PhoneGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
  return (
    <IconCall
      aria-hidden="true"
      style={{
        color: props.color ?? 'currentColor',
        display: 'block',
        flex: 'none',
        height: `${s}px`,
        width: `${s}px`,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Inline @mention pills + embedded blocks
// ---------------------------------------------------------------------------

type MentionKind = 'person' | 'doc' | 'task' | 'channel';

// Leading avatar / icon inside an inline @mention. Vertically centred against
// the surrounding text while the label itself stays on the text baseline.
const mentionIconWrap: JSX.CSSProperties = {
  display: 'inline-flex',
  'margin-right': '4px',
  'vertical-align': 'middle',
};

// Hollow status ring shown inline after a task mention (matches the real app's
// "Not started" indicator).
function TaskStatusRing(props: { size?: number; color?: string }) {
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
        cx="12"
        cy="12"
        r="8"
        fill="none"
        stroke={props.color ?? 'var(--a2)'}
        stroke-width="2.4"
      />
    </svg>
  );
}

// Inline @mention: a leading type icon + underlined label (no filled pill).
// Task mentions carry the same trailing status / priority / assignee glyphs the
// real app renders inline.
function MentionPill(props: {
  kind: MentionKind;
  label: string;
  initials?: string;
  brand?: boolean;
  weight?: string;
  truncate?: boolean;
}) {
  const isChannel = props.kind === 'channel';
  const isTask = props.kind === 'task';
  const accent = () => (props.brand ? 'var(--a0)' : undefined);
  // Person mentions render as a compact accent pill (@name) exactly like the
  // real app's UserMention; entity mentions stay as an icon + underlined label.
  if (props.kind === 'person') {
    return (
      <span
        style={{
          'background-color': 'color-mix(in srgb, var(--a0) 8%, transparent)',
          'border-radius': '6px',
          color: 'var(--a0)',
          'font-family': appFont,
          margin: '0 2px',
          padding: '1px 4px',
          'white-space': 'nowrap',
        }}
      >
        @{props.label}
      </span>
    );
  }
  return (
    <span
      style={{
        color: 'var(--c1)',
        'font-family': appFont,
        'font-weight': props.weight ?? 'inherit',
        margin: '0 2px',
        'white-space': 'nowrap',
        // The pill never line-breaks, so in tight columns (the compact hero at
        // phone widths) it must ellipsize instead of painting past the window.
        ...(props.truncate
          ? {
              display: 'inline-block',
              'max-width': '100%',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'vertical-align': 'bottom',
            }
          : {}),
      }}
    >
      <Show when={props.kind === 'doc'}>
        <span style={mentionIconWrap}>
          <DocFileGlyph size={13} color={NOTE_VIOLET} />
        </span>
      </Show>
      <Show when={isTask}>
        <span style={mentionIconWrap}>
          <TaskListGlyph size={13} color={accent()} />
        </span>
      </Show>
      <Show when={isChannel}>
        <span style={mentionIconWrap}>
          <HashGlyph size={13} color={accent()} />
        </span>
      </Show>
      <span
        style={{
          'text-decoration-line': 'underline',
          'text-decoration-color':
            'color-mix(in oklab, currentColor 20%, transparent)',
          'text-underline-offset': '2px',
        }}
      >
        {props.label}
      </span>
      <Show when={isTask}>
        <span
          aria-hidden="true"
          style={{
            'align-items': 'center',
            color: 'var(--c4)',
            display: 'inline-flex',
            gap: '5px',
            'margin-left': '6px',
            'vertical-align': 'middle',
          }}
        >
          <TaskStatusRing size={12} color={accent()} />
          <PriorityGlyph size={12} />
          <Avatar initials="SW" size={15} color="var(--b3)" />
        </span>
      </Show>
    </span>
  );
}

// Emoji reaction pills shown beneath a message (matches the real app's reaction
// row). The "self-reacted" pill is tinted with the brand accent.
function ReactionPill(props: {
  emoji: string;
  count: number;
  active?: boolean;
}) {
  return (
    <span
      style={{
        'align-items': 'center',
        'background-color': props.active
          ? 'color-mix(in srgb, var(--a0) 16%, transparent)'
          : 'color-mix(in srgb, var(--c4) 10%, transparent)',
        border: props.active
          ? '1px solid color-mix(in srgb, var(--a0) 45%, transparent)'
          : '1px solid transparent',
        'border-radius': '999px',
        color: props.active ? 'var(--a0)' : 'var(--c2)',
        display: 'inline-flex',
        'font-family': appFont,
        'font-size': '12px',
        'font-weight': '600',
        gap: '5px',
        'line-height': 1,
        padding: '4px 9px',
      }}
    >
      <span aria-hidden="true" style={{ 'font-size': '13px' }}>
        {props.emoji}
      </span>
      {props.count}
    </span>
  );
}

// The small dashed "+" affordance the app shows to add a reply / reaction.
function ThreadAddButton(props: { size?: number }) {
  const s = props.size ?? 30;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        border: '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
        'border-radius': '8px',
        color: 'var(--c4)',
        display: 'inline-flex',
        flex: 'none',
        height: `${s}px`,
        'justify-content': 'center',
        width: `${s}px`,
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{ display: 'block' }}
      >
        <path
          d="M12 5v14M5 12h14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hero: realistic app window (channel + composer)
// ---------------------------------------------------------------------------

const channelTabs = ['Messages', 'Attachments', 'Participants'];

export function HeroChannelWindow() {
  const compact = () => mobile();
  const msgText: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-family': appFont,
    'font-size': compact() ? '13px' : '14px',
    'font-weight': '350',
    'line-height': 1.55,
    margin: '0',
  };
  const nameStyle: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-family': appFont,
    'font-size': compact() ? '13px' : '13.5px',
    'font-weight': '600',
  };
  // Right-aligned timestamp column, but inset from the edge so it reads closer
  // to the message text rather than pinned to the far right.
  const timeStyle: JSX.CSSProperties = {
    color: 'var(--c4)',
    'font-family': appFont,
    'font-size': '11.5px',
    'margin-left': 'auto',
    'margin-right': '36px',
    'white-space': 'nowrap',
  };
  // Uniform, larger thread avatars (parent + replies share one size); the
  // "12 more" summary pill uses a slightly smaller one since it's a summary.
  const AV = 30;
  const SUMMARY_AV = 24;
  const RAIL = 'color-mix(in srgb, var(--c4) 22%, transparent)';
  // The inset tabs switch the pane content between the thread, the channel's
  // shared files, and its members.
  const [activeTab, setActiveTab] = createSignal(0);
  const attachments = [
    { name: 'Q3 launch plan.pdf', meta: 'Gabriel Birman · Jun 12 · 2.4 MB' },
    { name: 'posthog-flags.png', meta: 'Rahul · 4:38 PM · 184 KB' },
    { name: 'deploy-logs.txt', meta: 'Dana Cole · 4:41 PM · 12 KB' },
  ];
  const participants: {
    name: string;
    role: string;
    initials?: string;
    color?: string;
    agent?: boolean;
  }[] = [
    {
      name: 'Gabriel Birman',
      role: 'Admin',
      initials: 'GB',
      color: 'var(--b3)',
    },
    { name: 'Rahul', role: 'Member', initials: 'R', color: 'var(--b4)' },
    { name: 'Dana Cole', role: 'Member', initials: 'DC', color: 'var(--b3)' },
    {
      name: 'Julia Westphal',
      role: 'Member',
      initials: 'JW',
      color: 'var(--b4)',
    },
    { name: 'Macro Agent', role: 'Agent', agent: true },
  ];

  return (
    <PreviewWindow
      class="channels-hero-window"
      background="#080808"
      innerBackground="#080808"
      mask="linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 66%, rgb(0 0 0 / 0.18) 100%)"
    >
      {/* Channel pane */}
      <div
        style={{
          display: 'grid',
          'grid-template-rows': 'auto 1fr auto',
          'min-width': 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--b4) 18%, transparent)',
            'box-sizing': 'border-box',
            display: 'flex',
            gap: compact() ? '10px' : '13px',
            height: compact() ? '42px' : '46px',
            overflow: 'hidden',
            padding: compact() ? '0 13px' : '0 16px',
          }}
        >
          <span
            style={{
              'align-items': 'center',
              color: 'var(--c1)',
              display: 'inline-flex',
              flex: 'none',
              'font-family': appFont,
              'font-size': compact() ? '14px' : '15px',
              'font-weight': '500',
              gap: '6px',
              'white-space': 'nowrap',
            }}
          >
            <HashGlyph size={15} /> bug-reports
          </span>
          {/* Inset segmented control — shared TabsInset. */}
          <TabsInset
            tabs={channelTabs}
            active={activeTab()}
            onSelect={setActiveTab}
            compact={compact()}
            compactMaxIndex={0}
          />
          <span
            style={{
              'align-items': 'center',
              display: 'inline-flex',
              flex: 'none',
              gap: '10px',
              'margin-left': 'auto',
            }}
          >
            {/* At phone widths the header can't fit the member stack and the
                  Call affordance; keep Call, which reads as the channel action. */}
            <Show when={!compact()}>
              <span style={{ display: 'inline-flex' }}>
                <Avatar initials="GB" size={22} color="var(--b4)" />
                <span style={{ 'margin-left': '-7px' }}>
                  <Avatar initials="R" size={22} color="var(--b3)" />
                </span>
              </span>
            </Show>
            <span
              style={{
                'align-items': 'center',
                color: 'var(--c2)',
                display: 'inline-flex',
                'font-family': appFont,
                'font-size': '12.5px',
                gap: '6px',
                'white-space': 'nowrap',
              }}
            >
              <PhoneGlyph size={14} /> Call
            </span>
          </span>
        </div>

        {/* ----- Messages tab ----- */}
        <Show when={activeTab() === 0}>
          {/* Messages — wider horizontal padding so the thread reads as a
              narrower centred column. */}
          <div
            style={{
              display: 'grid',
              'align-content': 'start',
              gap: compact() ? '14px' : '16px',
              'min-height': compact() ? '0' : '262px',
              padding: compact() ? '14px 13px' : '16px 96px',
            }}
          >
            {/* Message 1 with inline thread */}
            <div style={{ display: 'grid', gap: '8px' }}>
              {/* Parent message */}
              <div
                style={{
                  'align-items': 'flex-start',
                  display: 'flex',
                  gap: '10px',
                }}
              >
                <Avatar initials="GB" size={AV} color="var(--b3)" />
                <div
                  style={{
                    display: 'grid',
                    gap: '2px',
                    'grid-template-columns': 'minmax(0, 1fr)',
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
                    <span style={nameStyle}>Gabriel Birman</span>
                    <span style={timeStyle}>4:20 PM</span>
                  </div>
                  <p style={msgText}>
                    does anyone know why our posthog flags are broken?
                  </p>
                </div>
              </div>
              {/* Replies — the thread rail is a left border on this block, so its
                  height always equals the content and it reaches the last reply,
                  no fixed-height/abspos guesswork. Sits under the parent avatar's
                  centre (margin-left = avatar radius). */}
              <div
                style={{
                  display: 'grid',
                  gap: compact() ? '12px' : '14px',
                  'margin-left': `${AV / 2}px`,
                  'padding-left': compact() ? '14px' : '18px',
                  position: 'relative',
                }}
              >
                {/* Thread rail — an absolute line pinned top-to-bottom of this
                    block, so it always spans the full reply list down to the
                    last reply (no fixed height to fall short). */}
                <div
                  aria-hidden="true"
                  style={{
                    'background-color': RAIL,
                    bottom: '0',
                    left: '0',
                    position: 'absolute',
                    top: '0',
                    width: '1px',
                  }}
                />
                <div
                  style={{
                    'align-items': 'flex-start',
                    display: 'flex',
                    gap: '9px',
                  }}
                >
                  <Avatar initials="R" size={AV} color="var(--b3)" />
                  <div
                    style={{
                      display: 'grid',
                      gap: '1px',
                      'grid-template-columns': 'minmax(0, 1fr)',
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
                      <span style={nameStyle}>Rahul</span>
                      <span style={timeStyle}>4:20 PM</span>
                    </div>
                    <p style={msgText}>which ones</p>
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
                    <Avatar initials="GB" size={AV} color="var(--b3)" />
                    <div
                      style={{
                        display: 'grid',
                        gap: '4px',
                        'grid-template-columns': 'minmax(0, 1fr)',
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
                        <span style={nameStyle}>Gabriel Birman</span>
                        <span style={timeStyle}>4:21 PM</span>
                      </div>
                      <p style={msgText}>
                        all of them, flags just return false
                      </p>
                      <div
                        style={{
                          'align-items': 'center',
                          display: 'flex',
                          gap: '6px',
                          'margin-top': '2px',
                        }}
                      >
                        <ReactionPill emoji="😩" count={3} active />
                        <ReactionPill emoji="👀" count={2} />
                      </div>
                    </div>
                  </div>
                </Show>
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{
                      'align-items': 'center',
                      'background-color':
                        'color-mix(in srgb, var(--b1) 60%, var(--b0))',
                      border:
                        '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                      'border-radius': '999px',
                      display: 'inline-flex',
                      gap: '8px',
                      padding: '4px 12px 4px 5px',
                      width: 'max-content',
                    }}
                  >
                    <Avatar initials="SW" size={SUMMARY_AV} color="var(--b3)" />
                    <span
                      style={{
                        color: 'var(--a0)',
                        'font-family': appFont,
                        'font-size': '12px',
                        'font-weight': '600',
                      }}
                    >
                      12 more replies
                    </span>
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': appFont,
                        'font-size': '12px',
                      }}
                    >
                      Last reply Today
                    </span>
                  </div>
                  <ThreadAddButton size={26} />
                </div>
              </div>
            </div>

            {/* Message 2 with mention + task pill */}
            <div
              style={{
                'align-items': 'flex-start',
                display: 'flex',
                gap: '10px',
              }}
            >
              <Avatar initials="GB" size={AV} color="var(--b3)" />
              <div
                style={{
                  display: 'grid',
                  gap: '6px',
                  'grid-template-columns': 'minmax(0, 1fr)',
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
                  <span style={nameStyle}>Gabriel Birman</span>
                  <span style={timeStyle}>4:29 PM</span>
                </div>
                <p style={msgText}>
                  <MentionPill kind="person" label="sean" initials="SW" /> filed
                  this so it doesn't get lost:
                </p>
                <span
                  style={{
                    'align-items': 'center',
                    display: 'inline-flex',
                    'font-size': compact() ? '13px' : '14px',
                    gap: '8px',
                    'min-width': 0,
                  }}
                >
                  <MentionPill
                    kind="task"
                    label="Support snippet OR file-type filter"
                    weight="350"
                    truncate
                  />
                </span>
              </div>
            </div>

            {/* Message 3 */}
            <div
              style={{
                'align-items': 'flex-start',
                display: 'flex',
                gap: '10px',
              }}
            >
              <Avatar initials="R" size={AV} color="var(--b3)" />
              <div
                style={{
                  display: 'grid',
                  gap: '2px',
                  'grid-template-columns': 'minmax(0, 1fr)',
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
                  <span style={nameStyle}>Rahul</span>
                  <span style={timeStyle}>4:38 PM</span>
                </div>
                <p style={msgText}>
                  pushed a fix — flags resolve again. can someone confirm on
                  staging?
                </p>
              </div>
            </div>

            {/* Message 4 with reactions */}
            <div
              style={{
                'align-items': 'flex-start',
                display: 'flex',
                gap: '10px',
              }}
            >
              <Avatar initials="DC" size={AV} color="var(--b3)" />
              <div
                style={{
                  display: 'grid',
                  gap: '6px',
                  'grid-template-columns': 'minmax(0, 1fr)',
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
                  <span style={nameStyle}>Dana Cole</span>
                  <span style={timeStyle}>4:41 PM</span>
                </div>
                <p style={msgText}>
                  confirmed on staging — flags are back, nice and fast
                </p>
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '6px',
                    'margin-top': '2px',
                  }}
                >
                  <ReactionPill emoji="🎉" count={4} active />
                  <ReactionPill emoji="🙏" count={2} />
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* ----- Attachments tab — files shared in the channel ----- */}
        <Show when={activeTab() === 1}>
          <div
            style={{
              display: 'grid',
              'align-content': 'start',
              gap: compact() ? '6px' : '8px',
              'min-height': compact() ? '0' : '262px',
              padding: compact() ? '14px 13px' : '16px 96px',
            }}
          >
            <For each={attachments}>
              {(a) => (
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '12px',
                    padding: '6px 0',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      'align-items': 'center',
                      'background-color': '#0a0a0a',
                      border:
                        '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
                      'border-radius': '8px',
                      'box-sizing': 'border-box',
                      display: 'inline-flex',
                      flex: 'none',
                      height: '36px',
                      'justify-content': 'center',
                      width: '36px',
                    }}
                  >
                    <IconFileMacro
                      style={{
                        color: 'var(--c3)',
                        height: '17px',
                        width: '17px',
                      }}
                    />
                  </span>
                  <div style={{ display: 'grid', gap: '1px', 'min-width': 0 }}>
                    <span
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-size': '13.5px',
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                      }}
                    >
                      {a.name}
                    </span>
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': appFont,
                        'font-size': '11.5px',
                        'white-space': 'nowrap',
                      }}
                    >
                      {a.meta}
                    </span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* ----- Participants tab — channel members ----- */}
        <Show when={activeTab() === 2}>
          <div
            style={{
              display: 'grid',
              'align-content': 'start',
              gap: compact() ? '2px' : '4px',
              'min-height': compact() ? '0' : '262px',
              padding: compact() ? '14px 13px' : '16px 96px',
            }}
          >
            <For each={participants}>
              {(p) => (
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '10px',
                    padding: '6px 0',
                  }}
                >
                  <Show
                    when={p.agent}
                    fallback={
                      <Avatar
                        initials={p.initials ?? ''}
                        size={30}
                        color={p.color ?? 'var(--b3)'}
                      />
                    }
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        'align-items': 'center',
                        'background-color':
                          'color-mix(in srgb, var(--a0) 18%, var(--b1))',
                        'border-radius': '999px',
                        display: 'inline-flex',
                        flex: 'none',
                        height: '30px',
                        'justify-content': 'center',
                        width: '30px',
                      }}
                    >
                      <SparkleGlyph size={14} color="var(--a0)" />
                    </span>
                  </Show>
                  <span
                    style={{
                      color: 'var(--c1)',
                      'font-family': appFont,
                      'font-size': '13.5px',
                      'white-space': 'nowrap',
                    }}
                  >
                    {p.name}
                  </span>
                  <span
                    style={{
                      color: 'var(--c4)',
                      'font-family': appFont,
                      'font-size': '12px',
                    }}
                  >
                    {p.role}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Composer (Messages tab only) */}
        {/* Horizontal padding matches the messages column (96px) so the input
              box lines up with the message + timestamp column above it. */}
        <Show when={activeTab() === 0}>
          <div style={{ padding: compact() ? '10px 13px' : '12px 96px' }}>
            <div
              style={{
                'background-color': '#0a0a0a',
                border:
                  '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
                'border-radius': '12px',
                'box-sizing': 'border-box',
                display: 'grid',
                gap: '12px',
                padding: '12px 12px 10px',
              }}
            >
              <span
                style={{
                  color: 'color-mix(in srgb, var(--c4) 60%, transparent)',
                  'font-family': appFont,
                  'font-size': compact() ? '13px' : '14px',
                }}
              >
                Message channel
              </span>
              <div
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  gap: '12px',
                }}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 256 256"
                  width="16"
                  height="16"
                  fill="currentColor"
                  style={{
                    color: 'color-mix(in srgb, var(--c4) 66%, transparent)',
                    display: 'block',
                    flex: 'none',
                  }}
                >
                  <path d="M209.66,122.34a8,8,0,0,1,0,11.32l-82.05,82a56,56,0,0,1-79.2-79.21L147.67,35.73a40,40,0,1,1,56.61,56.55L105,193A24,24,0,1,1,71,159L154.3,74.38A8,8,0,1,1,165.7,85.6L82.39,170.31a8,8,0,1,0,11.27,11.36L192.93,81A24,24,0,1,0,159,47L59.76,147.68a40,40,0,1,0,56.53,56.62l82.06-82A8,8,0,0,1,209.66,122.34Z" />
                </svg>
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
                    'background-color': 'transparent',
                    border:
                      '1px solid color-mix(in srgb, var(--c4) 26%, transparent)',
                    'border-radius': '999px',
                    color: 'var(--c2)',
                    display: 'inline-flex',
                    flex: 'none',
                    height: '28px',
                    'justify-content': 'center',
                    'margin-left': 'auto',
                    width: '28px',
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    style={{ display: 'block' }}
                  >
                    <path
                      d="M12 19V5M12 5l-6 6M12 5l6 6"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </PreviewWindow>
  );
}

// ---------------------------------------------------------------------------
// Channels page hero — a #creative-team channel window beside a DM panel.
// The channel thread walks the page's four stories in order: @mention a
// teammate, share an image, share an email thread, and pull in @Macro. The
// DM panel carries the 1:1 story ("Type @ to share with Jacob").
// ---------------------------------------------------------------------------

// Simple picture glyph for the image-attachment caption row.
function ImageGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
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
        y="4.5"
        width="18"
        height="15"
        rx="2.5"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.7"
      />
      <circle cx="9" cy="10" r="1.6" fill={props.color ?? 'currentColor'} />
      <path
        d="M4.5 17.5l4.6-4.4 3.2 3 3.4-3.6 3.8 4"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// Up-arrow send button (the composer affordance across the app mocks).
function SendCircle(props: { size?: number; accent?: boolean }) {
  const s = props.size ?? 28;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': props.accent ? 'var(--a0)' : 'transparent',
        border: props.accent
          ? '1px solid transparent'
          : '1px solid color-mix(in srgb, var(--c4) 26%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: props.accent ? 'var(--b0)' : 'var(--c2)',
        display: 'inline-flex',
        flex: 'none',
        height: `${s}px`,
        'justify-content': 'center',
        width: `${s}px`,
      }}
    >
      <svg
        width={Math.round(s / 2)}
        height={Math.round(s / 2)}
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{ display: 'block' }}
      >
        <path
          d="M12 19V5M12 5l-6 6M12 5l6 6"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  );
}

// The shared image: a miniature landing-page mockup drawn as line art, so the
// "image in chat" reads instantly without shipping a raster asset.
function ChatHeroSharedImage() {
  return (
    <svg
      viewBox="0 0 300 160"
      aria-hidden="true"
      style={{ display: 'block', height: 'auto', width: '100%' }}
    >
      <defs>
        <radialGradient id="chatHeroImgGlow" cx="82%" cy="12%" r="80%">
          <stop offset="0%" stop-color="var(--a0)" stop-opacity="0.34" />
          <stop offset="46%" stop-color="var(--a0)" stop-opacity="0.1" />
          <stop offset="100%" stop-color="var(--a0)" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="300" height="160" fill="#101013" />
      <rect width="300" height="160" fill="url(#chatHeroImgGlow)" />
      {/* headline block */}
      <rect
        x="26"
        y="40"
        width="118"
        height="13"
        rx="6.5"
        fill="#E7E7E7"
        opacity="0.92"
      />
      <rect
        x="26"
        y="61"
        width="86"
        height="13"
        rx="6.5"
        fill="#E7E7E7"
        opacity="0.92"
      />
      <rect
        x="26"
        y="86"
        width="102"
        height="6.5"
        rx="3.25"
        fill="#9A9A9A"
        opacity="0.5"
      />
      <rect
        x="26"
        y="98"
        width="78"
        height="6.5"
        rx="3.25"
        fill="#9A9A9A"
        opacity="0.5"
      />
      <rect x="26" y="116" width="60" height="17" rx="8.5" fill="var(--a0)" />
      {/* app-window vignette */}
      <g>
        <rect
          x="176"
          y="38"
          width="100"
          height="96"
          rx="8"
          fill="#0B0B0E"
          stroke="#2C2C31"
          stroke-width="1.4"
        />
        <line
          x1="176"
          y1="58"
          x2="276"
          y2="58"
          stroke="#2C2C31"
          stroke-width="1.2"
        />
        <circle cx="187" cy="48" r="2.6" fill="#3A3A40" />
        <rect x="196" y="45.5" width="34" height="5" rx="2.5" fill="#3A3A40" />
        <For each={[70, 86, 102]}>
          {(y, i) => (
            <>
              <circle cx="190" cy={y + 3} r="3.4" fill="#33333A" />
              <rect
                x="199"
                y={y}
                width={i() === 1 ? 52 : 64}
                height="6"
                rx="3"
                fill="#33333A"
              />
            </>
          )}
        </For>
        <rect
          x="186"
          y="116"
          width="44"
          height="8"
          rx="4"
          fill="var(--a0)"
          opacity="0.8"
        />
      </g>
    </svg>
  );
}

// Rounded attachment card wrapping the shared image, with a filename row.
function ChatHeroImageCard(props: { compact: boolean }) {
  return (
    <div
      style={{
        'background-color': '#0a0a0a',
        border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
        'border-radius': '12px',
        'box-sizing': 'border-box',
        overflow: 'hidden',
        width: props.compact ? 'min(280px, 100%)' : 'min(310px, 100%)',
      }}
    >
      <ChatHeroSharedImage />
      <div
        style={{
          'align-items': 'center',
          'border-top':
            '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          color: 'var(--c4)',
          display: 'flex',
          gap: '8px',
          padding: '8px 12px',
        }}
      >
        <ImageGlyph size={13} />
        <span
          style={{
            color: 'var(--c2)',
            'font-family': appFont,
            'font-size': '12px',
            'min-width': 0,
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
          }}
        >
          launch-hero-v2.png
        </span>
        <span
          style={{
            'font-family': appFont,
            'font-size': '11.5px',
            'margin-left': 'auto',
            'white-space': 'nowrap',
          }}
        >
          1.2 MB
        </span>
      </div>
    </div>
  );
}

// A shared email thread — dropping an email link in chat renders this card,
// and everyone in the channel can open the full conversation.
function ChatHeroEmailCard(props: { compact: boolean }) {
  return (
    <div
      style={{
        'background-color': '#0a0a0a',
        border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
        'border-radius': '12px',
        'box-sizing': 'border-box',
        display: 'grid',
        overflow: 'hidden',
        width: props.compact ? 'min(300px, 100%)' : 'min(340px, 100%)',
      }}
    >
      <div
        style={{
          'align-items': 'center',
          display: 'flex',
          gap: '11px',
          padding: '11px 13px',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            'align-items': 'center',
            'background-color':
              'color-mix(in srgb, var(--a0) 13%, transparent)',
            'border-radius': '8px',
            display: 'inline-grid',
            flex: 'none',
            height: '32px',
            'place-items': 'center',
            width: '32px',
          }}
        >
          <MacroNavIcon name="email" size={16} accent />
        </span>
        <div style={{ display: 'grid', gap: '2px', 'min-width': 0 }}>
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
            Re: Onboarding feedback
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
            Email thread · Dana Wells · 6 messages
          </span>
        </div>
      </div>
      <div
        style={{
          'align-items': 'center',
          'border-top':
            '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          color: 'var(--c4)',
          display: 'flex',
          gap: '7px',
          padding: '8px 13px',
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', flex: 'none' }}
        >
          <path
            d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        <span
          style={{
            'font-family': appFont,
            'font-size': '11.5px',
            'min-width': 0,
            overflow: 'hidden',
            'text-overflow': 'ellipsis',
            'white-space': 'nowrap',
          }}
        >
          Shared with <span style={{ color: 'var(--c2)' }}>#creative-team</span>{' '}
          — everyone can open it
        </span>
      </div>
    </div>
  );
}

// The agent's gradient sparkle avatar (same treatment as the tasks page).
function AgentSparkleAvatar(props: { size?: number }) {
  const s = props.size ?? 30;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        background:
          'linear-gradient(135deg, var(--a0), color-mix(in srgb, var(--a0) 55%, var(--b0)))',
        'border-radius': '999px',
        color: 'var(--b0)',
        display: 'inline-flex',
        flex: 'none',
        height: `${s}px`,
        'justify-content': 'center',
        width: `${s}px`,
      }}
    >
      <SparkleGlyph size={Math.round(s * 0.52)} />
    </span>
  );
}

// One channel message: avatar, name + time header, body, optional attachment.
function ChatHeroMessage(props: {
  initials?: string;
  agent?: boolean;
  name: string;
  time: string;
  meta?: string;
  compact: boolean;
  children: JSX.Element;
  attachment?: JSX.Element;
}) {
  return (
    <div
      style={{
        'align-items': 'flex-start',
        display: 'flex',
        gap: '10px',
        'min-width': 0,
      }}
    >
      <Show when={!props.agent} fallback={<AgentSparkleAvatar size={30} />}>
        <Avatar initials={props.initials ?? ''} size={30} color="var(--b3)" />
      </Show>
      <div
        style={{
          display: 'grid',
          gap: '3px',
          'grid-template-columns': 'minmax(0, 1fr)',
          'min-width': 0,
          width: '100%',
        }}
      >
        <div style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}>
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': props.compact ? '13px' : '13.5px',
              'font-weight': '600',
              'white-space': 'nowrap',
            }}
          >
            {props.name}
          </span>
          <Show when={props.agent}>
            <span
              style={{
                'background-color':
                  'color-mix(in srgb, var(--a0) 16%, transparent)',
                'border-radius': '5px',
                color: 'var(--a0)',
                'font-family': 'rajdhani, body',
                'font-size': '10px',
                'font-weight': '700',
                'letter-spacing': '0.06em',
                padding: '2px 6px 1px',
                'text-transform': 'uppercase',
              }}
            >
              Agent
            </span>
          </Show>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '11.5px',
              'white-space': 'nowrap',
            }}
          >
            {props.time}
          </span>
          <Show when={props.meta}>
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
              {props.meta}
            </span>
          </Show>
        </div>
        <p
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': props.compact ? '13px' : '14px',
            'font-weight': '350',
            'line-height': 1.55,
            margin: 0,
          }}
        >
          {props.children}
        </p>
        <Show when={props.attachment}>
          <div style={{ 'margin-top': '5px' }}>{props.attachment}</div>
        </Show>
      </div>
    </div>
  );
}

// The main hero window: #creative-team with the four story beats in sequence.
function ChatHeroChannelWindow(props: { compact: boolean }) {
  const c = () => props.compact;
  return (
    <PreviewWindow
      class="chat-hero-channel-window"
      background="#080808"
      innerBackground="#080808"
      mask={
        c()
          ? undefined
          : 'linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 74%, rgb(0 0 0 / 0.16) 100%)'
      }
    >
      <div
        style={{
          display: 'grid',
          'grid-template-rows': 'auto 1fr auto',
          'min-width': 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--b4) 18%, transparent)',
            'box-sizing': 'border-box',
            display: 'flex',
            gap: c() ? '10px' : '13px',
            height: c() ? '42px' : '46px',
            overflow: 'hidden',
            padding: c() ? '0 13px' : '0 16px',
          }}
        >
          <span
            style={{
              'align-items': 'center',
              color: 'var(--c1)',
              display: 'inline-flex',
              flex: 'none',
              'font-family': appFont,
              'font-size': c() ? '14px' : '15px',
              'font-weight': '500',
              gap: '6px',
              'white-space': 'nowrap',
            }}
          >
            <HashGlyph size={15} /> creative-team
          </span>
          <span
            style={{
              'align-items': 'center',
              display: 'inline-flex',
              flex: 'none',
              gap: '10px',
              'margin-left': 'auto',
            }}
          >
            <Show when={!c()}>
              <span style={{ display: 'inline-flex' }}>
                <Avatar initials="JW" size={22} />
                <span style={{ 'margin-left': '-7px' }}>
                  <Avatar initials="GB" size={22} />
                </span>
                <span style={{ 'margin-left': '-7px' }}>
                  <Avatar initials="TN" size={22} color="var(--b4)" />
                </span>
              </span>
            </Show>
            <span
              style={{
                'align-items': 'center',
                color: 'var(--c2)',
                display: 'inline-flex',
                'font-family': appFont,
                'font-size': '12.5px',
                gap: '6px',
                'white-space': 'nowrap',
              }}
            >
              <PhoneGlyph size={14} /> Call
            </span>
          </span>
        </div>

        {/* Messages */}
        <div
          style={{
            display: 'grid',
            'align-content': 'start',
            gap: c() ? '15px' : '18px',
            padding: c() ? '14px 13px' : '20px 26px',
          }}
        >
          {/* @mention a teammate */}
          <ChatHeroMessage
            initials="JW"
            name="Julia Westphal"
            time="9:02 AM"
            compact={c()}
          >
            Launch page kicks off today.{' '}
            <MentionPill kind="person" label="Gabriel" /> can you own the hero
            section?
          </ChatHeroMessage>

          {/* share an image */}
          <ChatHeroMessage
            initials="GB"
            name="Gabriel Birman"
            time="9:05 AM"
            compact={c()}
            attachment={
              <div
                style={{
                  display: 'grid',
                  gap: '7px',
                  'justify-items': 'start',
                }}
              >
                <ChatHeroImageCard compact={c()} />
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '6px',
                  }}
                >
                  <ReactionPill emoji="🔥" count={3} active />
                  <ReactionPill emoji="👀" count={2} />
                </div>
              </div>
            }
          >
            On it — here's where the concept landed last night:
          </ChatHeroMessage>

          {/* share an email thread */}
          <ChatHeroMessage
            initials="JB"
            name="Jacob Beckerman"
            time="9:11 AM"
            compact={c()}
            attachment={<ChatHeroEmailCard compact={c()} />}
          >
            Read this before we write the copy — the customer's exact words:
          </ChatHeroMessage>

          {/* @Macro */}
          <ChatHeroMessage
            initials="TN"
            name="Teo Nys"
            time="9:14 AM"
            compact={c()}
          >
            <MentionPill kind="person" label="Macro" /> what did I miss in here
            overnight?
          </ChatHeroMessage>

          <ChatHeroMessage
            agent
            name="Macro"
            time="9:14 AM"
            meta="· summarized 26 messages"
            compact={c()}
          >
            Three things:{' '}
            <span style={{ color: 'var(--c2)' }}>Gabriel owns the hero</span>,
            the ship date held at{' '}
            <span style={{ color: 'var(--c2)' }}>Thursday</span>, and Jacob's
            email thread above is waiting on your reply.
          </ChatHeroMessage>
        </div>

        {/* Composer */}
        <div style={{ padding: c() ? '10px 13px 6px' : '14px 26px 8px' }}>
          <div
            style={{
              'background-color': '#0a0a0a',
              border:
                '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
              'border-radius': '12px',
              'box-sizing': 'border-box',
              display: 'grid',
              gap: '12px',
              padding: '12px 12px 10px',
            }}
          >
            <span
              style={{
                color: 'color-mix(in srgb, var(--c4) 60%, transparent)',
                'font-family': appFont,
                'font-size': c() ? '13px' : '14px',
              }}
            >
              Message #creative-team
            </span>
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '12px' }}
            >
              <span
                style={{
                  color: 'color-mix(in srgb, var(--c4) 66%, transparent)',
                  display: 'inline-flex',
                }}
              >
                <PaperclipGlyph size={15} />
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
              <span style={{ 'margin-left': 'auto' }}>
                <SendCircle size={28} />
              </span>
            </div>
          </div>
        </div>
      </div>
    </PreviewWindow>
  );
}

// The DM panel — 1:1 chat with Jacob, per the concept: a couple of bubbles and
// the "Type @ to share" composer.
function ChatHeroDmPanel(props: { compact: boolean }) {
  const c = () => props.compact;
  const bubbleText: JSX.CSSProperties = {
    'font-family': appFont,
    'font-size': c() ? '13px' : '13.5px',
    'font-weight': '350',
    'line-height': 1.55,
  };
  return (
    <div
      style={{
        'background-color': '#0B0B0D',
        border: '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
        'border-radius': '14px',
        'box-sizing': 'border-box',
        display: 'grid',
        'grid-template-rows': 'auto 1fr auto',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      {/* Header */}
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
        <Avatar initials="JB" size={26} />
        <span
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': '13.5px',
            'font-weight': '600',
            'white-space': 'nowrap',
          }}
        >
          Jacob Beckerman
        </span>
        <span
          style={{
            'align-items': 'center',
            color: 'var(--c4)',
            display: 'inline-flex',
            gap: '10px',
            'margin-left': 'auto',
          }}
        >
          <PhoneGlyph size={14} />
        </span>
      </div>

      {/* Messages — packed to the bottom like a live conversation */}
      <div
        style={{
          'align-content': 'end',
          display: 'grid',
          gap: '12px',
          'min-height': c() ? '0' : '218px',
          padding: '18px 14px',
        }}
      >
        {/* sent */}
        <div style={{ display: 'grid', gap: '4px', 'justify-items': 'end' }}>
          <div
            style={{
              ...bubbleText,
              'background-color':
                'color-mix(in srgb, var(--c1) 9%, transparent)',
              'border-radius': '14px 14px 4px 14px',
              color: 'var(--c1)',
              'max-width': '88%',
              padding: '9px 13px',
            }}
          >
            Morning! Teo just merged the new onboarding flow — can you make sure
            the new graphics make it in?
          </div>
        </div>
        {/* received */}
        <div style={{ 'align-items': 'flex-end', display: 'flex', gap: '8px' }}>
          <Avatar initials="JB" size={22} />
          <div
            style={{
              display: 'grid',
              gap: '4px',
              'justify-items': 'start',
              'min-width': 0,
            }}
          >
            <div
              style={{
                ...bubbleText,
                'background-color':
                  'color-mix(in srgb, var(--c4) 10%, transparent)',
                'border-radius': '14px 14px 14px 4px',
                color: 'var(--c1)',
                'max-width': '92%',
                padding: '9px 13px',
              }}
            >
              On it — pulling them from{' '}
              <MentionPill kind="doc" label="Onboarding Design" /> now.
            </div>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '11px',
                'padding-left': '4px',
              }}
            >
              1 minute ago
            </span>
          </div>
        </div>
      </div>

      {/* Composer — the "@ to share" story */}
      <div style={{ padding: '0 12px 12px' }}>
        <div
          style={{
            'background-color': '#0a0a0a',
            border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
            'border-radius': '12px',
            'box-sizing': 'border-box',
            display: 'grid',
            gap: '12px',
            padding: '12px 12px 10px',
          }}
        >
          <span
            style={{
              color: 'color-mix(in srgb, var(--c4) 60%, transparent)',
              'font-family': appFont,
              'font-size': c() ? '13px' : '13.5px',
            }}
          >
            Type <span style={{ color: 'var(--a0)' }}>@</span> to share with
            Jacob
          </span>
          <div
            style={{ 'align-items': 'center', display: 'flex', gap: '12px' }}
          >
            <span
              style={{
                color: 'color-mix(in srgb, var(--c4) 66%, transparent)',
                display: 'inline-flex',
              }}
            >
              <PaperclipGlyph size={15} />
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '13.5px',
                'font-weight': '600',
              }}
            >
              Aa
            </span>
            <span style={{ 'margin-left': 'auto' }}>
              <SendCircle size={28} accent />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// The full hero composition. Desktop: channel window beside the lifted DM
// panel. Mobile: the channel window stacks above the DM panel, no offsets.
export function ChatHeroGraphic() {
  const compact = () => mobile();
  return (
    <Show
      when={!compact()}
      fallback={
        <div style={{ display: 'grid', gap: '20px', width: '100%' }}>
          <ChatHeroChannelWindow compact />
          <ChatHeroDmPanel compact />
        </div>
      }
    >
      <div
        style={{
          'align-items': 'start',
          display: 'grid',
          gap: '30px',
          'grid-template-columns': 'minmax(0, 1.68fr) minmax(0, 1fr)',
          width: '100%',
        }}
      >
        <ChatHeroChannelWindow compact={false} />
        {/* The DM panel sits a little lower, like a second window on the desk;
            its own drop shadow lifts it off the page. */}
        <div
          style={{
            filter: 'drop-shadow(0 30px 60px rgb(0 0 0 / 0.45))',
            'margin-top': '52px',
          }}
        >
          <ChatHeroDmPanel compact={false} />
        </div>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Inline threads graphic — forum-style replies
// ---------------------------------------------------------------------------

export function InlineThreadsGraphic() {
  const compact = () => mobile();
  const msgText: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-family': appFont,
    'font-size': compact() ? '13.5px' : '14.5px',
    'font-weight': '350',
    'line-height': 1.5,
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
  const replies = [
    { who: 'Rahul', initials: 'R', time: '4:20 PM', text: 'which ones' },
    {
      who: 'Gabriel Birman',
      initials: 'GB',
      time: '4:21 PM',
      text: 'all of them, flags just return false',
    },
  ];
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
          width: 'min(460px, 100%)',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '7px',
            padding: '11px 14px',
          }}
        >
          <HashGlyph size={14} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
              'font-weight': '600',
            }}
          >
            bug-reports
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gap: '10px',
            padding: compact() ? '16px 14px' : '18px 16px',
          }}
        >
          <div
            style={{
              'align-items': 'flex-start',
              display: 'flex',
              gap: '10px',
            }}
          >
            <Avatar initials="GB" size={28} color="var(--b3)" />
            <div style={{ display: 'grid', gap: '2px', width: '100%' }}>
              <div
                style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
              >
                <span style={nameStyle}>Gabriel Birman</span>
                <span style={timeStyle}>4:20 PM</span>
              </div>
              <p style={msgText}>
                does anyone know why our posthog flags are broken?
              </p>
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gap: '11px',
              'margin-left': '13px',
              padding: '2px 0 0 16px',
              position: 'relative',
            }}
          >
            {/* Thread rail, ending at the centre of the lowest avatar (the
                "12 more replies" pill) rather than running past it. */}
            <div
              aria-hidden="true"
              style={{
                'background-color': 'var(--b2)',
                bottom: '14px',
                left: '0',
                position: 'absolute',
                top: '0',
                width: '2px',
              }}
            />
            <For each={replies}>
              {(r) => (
                <div
                  style={{
                    'align-items': 'flex-start',
                    display: 'flex',
                    gap: '9px',
                  }}
                >
                  <Avatar initials={r.initials} size={22} color="var(--b3)" />
                  <div style={{ display: 'grid', gap: '1px', width: '100%' }}>
                    <div
                      style={{
                        'align-items': 'center',
                        display: 'flex',
                        gap: '8px',
                      }}
                    >
                      <span style={nameStyle}>{r.who}</span>
                      <span style={timeStyle}>{r.time}</span>
                    </div>
                    <p style={msgText}>{r.text}</p>
                  </div>
                </div>
              )}
            </For>
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}
            >
              <div
                style={{
                  'align-items': 'center',
                  'background-color':
                    'color-mix(in srgb, var(--b1) 60%, var(--b0))',
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '999px',
                  display: 'inline-flex',
                  gap: '8px',
                  padding: '4px 12px 4px 5px',
                  width: 'max-content',
                }}
              >
                <Avatar initials="SW" size={18} color="var(--b3)" />
                <span
                  style={{
                    color: 'var(--a0)',
                    'font-family': appFont,
                    'font-size': '12px',
                    'font-weight': '600',
                  }}
                >
                  12 more replies
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '12px',
                  }}
                >
                  Last reply Today
                </span>
              </div>
              <ThreadAddButton size={28} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channel-based sharing graphic
// ---------------------------------------------------------------------------

export function SharingGraphic() {
  const compact = () => mobile();
  const cardBg = 'color-mix(in srgb, var(--b1) 72%, var(--b0))';
  const mentionWrap: JSX.CSSProperties = {
    'border-radius': '5px',
    display: 'inline',
    padding: '2px 4px',
  };
  return (
    <>
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes sharingCardFloat {
            0%, 100% { transform: translate3d(0, 0, 0); }
            50% { transform: translate3d(0, -7px, 0); }
          }
          @keyframes sharingMentionPulse {
            0%, 100% { background-color: transparent; }
            50% { background-color: color-mix(in srgb, var(--a0) 22%, transparent); }
          }
          @keyframes sharingFooterReveal {
            0%, 62% { opacity: 0.42; transform: translate3d(0, 3px, 0); }
            72%, 100% { opacity: 1; transform: translate3d(0, 0, 0); }
          }
          @keyframes sharingCheckPop {
            0%, 68% { opacity: 0.35; transform: scale(0.88); }
            78%, 100% { opacity: 1; transform: scale(1); }
          }
          .sharing-graphic-card {
            animation: sharingCardFloat 7s ease-in-out infinite;
            will-change: transform;
          }
          .sharing-mention-1 {
            animation: sharingMentionPulse 4.8s ease-in-out infinite;
          }
          .sharing-mention-2 {
            animation: sharingMentionPulse 4.8s ease-in-out infinite 1.6s;
          }
          .sharing-mention-3 {
            animation: sharingMentionPulse 4.8s ease-in-out infinite 3.2s;
          }
          .sharing-graphic-footer {
            animation: sharingFooterReveal 4.8s ease-in-out infinite;
            will-change: transform, opacity;
          }
          .sharing-graphic-check {
            animation: sharingCheckPop 4.8s ease-in-out infinite;
            will-change: transform, opacity;
          }
        }
      `}</style>
      <div
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          'justify-items': 'center',
          padding: compact() ? '8px 18px' : '8px 24px',
          width: '100%',
          'max-width': '500px',
        }}
      >
        <div
          class="sharing-graphic-card"
          style={{
            'background-color': cardBg,
            border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
            'border-radius': '14px',
            'box-shadow': 'var(--shadow-panel-wide)',
            'box-sizing': 'border-box',
            overflow: 'hidden',
            width: '100%',
          }}
        >
          {/* Channel header */}
          <div
            style={{
              'align-items': 'center',
              'border-bottom':
                '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
              display: 'flex',
              gap: '8px',
              padding: '12px 16px',
            }}
          >
            <HashGlyph size={14} />
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '14px',
                'font-weight': '600',
              }}
            >
              go-to-market
            </span>
          </div>

          {/* Message that @mentions a doc + task */}
          <div
            style={{
              'align-items': 'flex-start',
              display: 'flex',
              gap: '12px',
              padding: compact() ? '18px 16px 18px' : '20px 18px 20px',
            }}
          >
            <Avatar initials="JB" size={28} color="var(--b3)" />
            <div style={{ display: 'grid', gap: '8px', 'min-width': 0 }}>
              <div
                style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
              >
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': '14px',
                    'font-weight': '600',
                  }}
                >
                  Jacob
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '12px',
                  }}
                >
                  9:02 AM
                </span>
              </div>
              <p
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': compact() ? '14px' : '15px',
                  'line-height': 1.78,
                  margin: 0,
                }}
              >
                Plan lives in{' '}
                <span class="sharing-mention-1" style={mentionWrap}>
                  <MentionPill kind="doc" label="Q3 launch plan" brand />
                </span>
                , tracked in{' '}
                <span class="sharing-mention-2" style={mentionWrap}>
                  <MentionPill kind="task" label="PRJ-128" brand />
                </span>
                . Heads up{' '}
                <span class="sharing-mention-3" style={mentionWrap}>
                  <MentionPill
                    kind="person"
                    label="Julia"
                    initials="JW"
                    brand
                  />
                </span>
                .
              </p>
            </div>
          </div>

          {/* Quiet auto-share confirmation — no loud toast, no orange */}
          <div
            class="sharing-graphic-footer"
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--b1) 40%, var(--b0))',
              'border-top':
                '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
              display: 'flex',
              gap: '8px',
              padding: '12px 16px',
            }}
          >
            <span
              aria-hidden="true"
              class="sharing-graphic-check"
              style={{
                color: 'var(--a0)',
                display: 'inline-flex',
                flex: 'none',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24">
                <path
                  d="M5 12l4.5 4.5L19 7"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': compact() ? '12px' : '12.5px',
                'line-height': 1.4,
              }}
            >
              Auto-shared with everyone in{' '}
              <span style={{ color: 'var(--c2)', 'font-weight': '600' }}>
                #go-to-market
              </span>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// @link everything graphic — mention menu + embedded blocks
// ---------------------------------------------------------------------------

const mentionMenu: { kind: string; label: string; detail: string }[] = [
  { kind: 'person', label: 'Sean Wolf', detail: 'Person' },
  { kind: 'doc', label: 'New user bugs', detail: 'Document' },
  { kind: 'task', label: 'Support snippet filter via AST', detail: 'Task' },
  { kind: 'channel', label: 'go-to-market', detail: 'Channel' },
];

export function MentionsGraphic() {
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
      {/* Composer with @ menu (opens downward inside a fixed-height field) */}
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-sm)',
          'box-sizing': 'border-box',
          'min-height': compact() ? '224px' : '240px',
          position: 'relative',
          width: 'min(440px, 100%)',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '7px',
            padding: '10px 14px',
          }}
        >
          <HashGlyph size={14} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13px',
              'font-weight': '600',
            }}
          >
            bug-reports
          </span>
        </div>
        <div
          style={{
            'box-sizing': 'border-box',
            padding: compact() ? '14px' : '16px',
          }}
        >
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '13.5px' : '14.5px',
              'line-height': 1.6,
            }}
          >
            Anyone seen this?{' '}
            <span
              style={{
                'background-color':
                  'color-mix(in srgb, var(--a0) 22%, transparent)',
                'border-radius': '4px',
                color: 'var(--c1)',
                padding: '1px 4px',
              }}
            >
              @su
            </span>
            <span
              aria-hidden="true"
              class="channels-caret"
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
        </div>
        {/* dropdown */}
        <div
          style={{
            'background-color': 'var(--b1)',
            border: '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
            'border-radius': '10px',
            'box-shadow': 'var(--shadow-panel-lg)',
            'box-sizing': 'border-box',
            left: compact() ? '12px' : '16px',
            overflow: 'hidden',
            position: 'absolute',
            right: compact() ? '12px' : '16px',
            top: compact() ? '78px' : '82px',
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
            Mention anything
          </div>
          <For each={mentionMenu}>
            {(item, i) => (
              <div
                style={{
                  'align-items': 'center',
                  'background-color':
                    i() === 2
                      ? 'color-mix(in srgb, var(--c1) 6%, transparent)'
                      : 'transparent',
                  display: 'flex',
                  gap: '10px',
                  padding: '7px 12px',
                }}
              >
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
                  <Show when={item.kind === 'person'}>
                    <Avatar initials="SW" size={18} color="var(--b3)" />
                  </Show>
                  <Show when={item.kind === 'doc'}>
                    <DocFileGlyph size={15} />
                  </Show>
                  <Show when={item.kind === 'task'}>
                    <TaskListGlyph size={15} />
                  </Show>
                  <Show when={item.kind === 'channel'}>
                    <HashGlyph size={15} />
                  </Show>
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
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '12px',
                    'margin-left': 'auto',
                  }}
                >
                  {item.detail}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unified inbox graphic — channels join the inbox (Signal / Noise)
// ---------------------------------------------------------------------------

const inboxItems: {
  icon: 'channel' | 'mention' | 'email' | 'task';
  who: string;
  text: string;
  accent?: boolean;
}[] = [
  {
    icon: 'mention',
    who: 'Gabriel Birman',
    text: 'mentioned you in #bug-reports',
    accent: true,
  },
  {
    icon: 'channel',
    who: '#go-to-market',
    text: 'Jacob: heads up on the launch plan',
  },
  { icon: 'email', who: 'Sarah Kim', text: 'Revised SOW before Thursday?' },
  {
    icon: 'task',
    who: 'PRJ-128 · Ship V1',
    text: 'Assigned to you · due today',
  },
];

export function InboxGraphic() {
  const compact = () => mobile();
  const iconFor = (kind: string) => {
    if (kind === 'channel') return <HashGlyph size={15} />;
    if (kind === 'email') return <MacroNavIcon name="email" size={15} />;
    if (kind === 'task') return <TaskListGlyph size={15} />;
    return <span style={{ color: 'var(--a0)', 'font-weight': '700' }}>@</span>;
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
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(460px, 100%)',
        }}
      >
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
          <MacroNavIcon name="inbox" active size={15} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
              'font-weight': '600',
            }}
          >
            Inbox
          </span>
          <span
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--a0) 16%, transparent)',
              'border-radius': '5px',
              color: 'var(--a0)',
              display: 'inline-flex',
              'font-family': 'rajdhani, body',
              'font-size': '11px',
              'font-weight': '700',
              'letter-spacing': '0.06em',
              'margin-left': 'auto',
              padding: '3px 7px 2px',
              'text-transform': 'uppercase',
            }}
          >
            Signal
          </span>
        </div>
        <For each={inboxItems}>
          {(item, index) => (
            <div
              style={{
                'align-items': 'center',
                'border-bottom':
                  index() === inboxItems.length - 1
                    ? '0'
                    : '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                display: 'flex',
                gap: '11px',
                padding: '11px 14px',
              }}
            >
              <span
                style={{
                  'align-items': 'center',
                  'background-color': item.accent
                    ? 'color-mix(in srgb, var(--a0) 14%, transparent)'
                    : 'color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '7px',
                  color: 'var(--c2)',
                  display: 'inline-grid',
                  flex: 'none',
                  height: '30px',
                  'place-items': 'center',
                  width: '30px',
                }}
              >
                {iconFor(item.icon)}
              </span>
              <div style={{ display: 'grid', gap: '1px', 'min-width': 0 }}>
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': compact() ? '13px' : '14px',
                    'font-weight': '600',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'white-space': 'nowrap',
                  }}
                >
                  {item.who}
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': compact() ? '12px' : '13px',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'white-space': 'nowrap',
                  }}
                >
                  {item.text}
                </span>
              </div>
              <span
                style={{
                  'background-color':
                    'color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '5px',
                  color: 'var(--c4)',
                  flex: 'none',
                  'font-family': "'rajdhani', body",
                  'font-size': '10px',
                  'font-weight': '700',
                  'letter-spacing': '0.06em',
                  'margin-left': 'auto',
                  padding: '3px 6px 2px',
                  'text-transform': 'uppercase',
                }}
              >
                {item.icon === 'mention'
                  ? 'Mention'
                  : item.icon === 'channel'
                    ? 'Channel'
                    : item.icon === 'email'
                      ? 'Mail'
                      : 'Task'}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// @Macro agent in channel graphic
// ---------------------------------------------------------------------------

export function AgentGraphic() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        width: '100%',
      }}
    >
      {/* One solid channel card — question and answer share a surface, so the
          lifted graphic stays crisp over the dimmed window behind it. */}
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(540px, 100%)',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '7px',
            padding: '11px 14px',
          }}
        >
          <HashGlyph size={14} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
              'font-weight': '600',
            }}
          >
            bug-reports
          </span>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '11.5px',
              'margin-left': 'auto',
            }}
          >
            Today, 8:02 AM
          </span>
        </div>

        {/* user message calling @Macro */}
        <div
          style={{
            'align-items': 'flex-start',
            display: 'flex',
            gap: '10px',
            padding: compact() ? '14px 14px 4px' : '16px 16px 4px',
          }}
        >
          <Avatar initials="JB" size={28} color="var(--b3)" />
          <div style={{ display: 'grid', gap: '3px' }}>
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
            >
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '13.5px',
                  'font-weight': '600',
                }}
              >
                Jacob
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '11.5px',
                }}
              >
                8:02 AM
              </span>
            </div>
            <p
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': compact() ? '13.5px' : '14.5px',
                'line-height': 1.55,
                margin: 0,
              }}
            >
              <MentionPill kind="person" label="Macro" initials="M" /> what did
              I miss in here overnight?
            </p>
          </div>
        </div>

        {/* agent reply */}
        <div
          style={{
            'align-items': 'flex-start',
            display: 'flex',
            gap: '10px',
            padding: compact() ? '12px 14px 16px' : '13px 16px 18px',
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
              height: '28px',
              'justify-content': 'center',
              width: '28px',
            }}
          >
            <SparkleGlyph size={15} />
          </span>
          <div style={{ display: 'grid', gap: '8px', 'min-width': 0 }}>
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
            >
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '13.5px',
                  'font-weight': '600',
                }}
              >
                Macro
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '11.5px',
                }}
              >
                summarized 38 messages
              </span>
            </div>
            <p
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': compact() ? '13px' : '14px',
                'line-height': 1.6,
                margin: 0,
              }}
            >
              Three things to know:
            </p>
            <ul
              style={{
                color: 'var(--c2)',
                display: 'grid',
                'font-family': appFont,
                'font-size': compact() ? '13px' : '14px',
                gap: '7px',
                'line-height': 1.5,
                margin: 0,
                'padding-left': '18px',
              }}
            >
              <li>
                PostHog flags returning{' '}
                <span style={{ color: 'var(--c1)' }}>false</span>. Rahul is on
                it.
              </li>
              <li>
                Gabriel filed <MentionPill kind="task" label="PRJ-128" /> for
                the AST filter.
              </li>
              <li>
                <MentionPill kind="person" label="Julia" initials="JW" /> needs
                the embargo time confirmed.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home "cohesion" graphic — a full-window channel that plays itself like a
// short clip: type a message → @mention a doc → a share toast slides in →
// the mention is clicked and the doc opens split-screen beside the channel.
// Everything derives from a single looping clock so the resting frame (used
// for SSR / reduced-motion) is the split-screen "open" state.
// ---------------------------------------------------------------------------

function CheckBadge(props: { size?: number }) {
  const s = props.size ?? 22;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': 'color-mix(in srgb, var(--c4) 20%, transparent)',
        'border-radius': '999px',
        color: 'var(--c2)',
        display: 'inline-flex',
        flex: 'none',
        height: `${s}px`,
        'justify-content': 'center',
        width: `${s}px`,
      }}
    >
      <svg
        width={Math.round(s * 0.58)}
        height={Math.round(s * 0.58)}
        viewBox="0 0 24 24"
        style={{ display: 'block' }}
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
  );
}

// Classic OS pointer used for the synthetic "click" near the end of the clip.
function PointerCursor(props: { size?: number }) {
  const s = props.size ?? 22;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path
        d="M5 2.5l13.5 7.2-5.7 1.3-1.2 5.9z"
        fill="var(--c1)"
        stroke="var(--b0)"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// The right-hand document pane that slides in for the split-screen beat.
function CohesionDocPane(props: { compact: boolean }) {
  const body: JSX.CSSProperties = {
    color: 'var(--c2)',
    'font-family': appFont,
    'font-size': props.compact ? '12.5px' : '13.5px',
    'line-height': 1.6,
    margin: 0,
  };
  const check = (done: boolean) => (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        border: done
          ? '0'
          : '1.5px solid color-mix(in srgb, var(--c4) 40%, transparent)',
        'background-color': done ? 'var(--a2)' : 'transparent',
        'border-radius': '5px',
        color: 'var(--b0)',
        display: 'inline-grid',
        flex: 'none',
        height: '17px',
        'place-items': 'center',
        width: '17px',
      }}
    >
      <Show when={done}>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          style={{ display: 'block' }}
        >
          <path
            d="M5 12l4.5 4.5L19 7"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </Show>
    </span>
  );
  return (
    <div
      style={{
        'background-color': '#080808',
        'box-sizing': 'border-box',
        display: 'grid',
        'grid-template-rows': 'auto 1fr',
        height: '100%',
        'min-width': 0,
        width: '100%',
      }}
    >
      {/* Doc header */}
      <div
        style={{
          'align-items': 'center',
          'border-bottom':
            '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          display: 'flex',
          gap: '10px',
          overflow: 'hidden',
          padding: props.compact ? '11px 13px' : '13px 16px',
        }}
      >
        <DocFileGlyph size={16} />
        <span
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': props.compact ? '13.5px' : '14.5px',
            'font-weight': '600',
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
            display: 'inline-flex',
            'margin-left': 'auto',
          }}
        >
          <Avatar initials="JB" size={20} color="var(--b3)" />
          <span style={{ 'margin-left': '-6px' }}>
            <Avatar initials="JW" size={20} color="var(--b4)" />
          </span>
        </span>
      </div>
      {/* Doc body */}
      <div
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          gap: props.compact ? '12px' : '15px',
          'align-content': 'start',
          overflow: 'hidden',
          padding: props.compact ? '16px 14px' : '22px 22px',
        }}
      >
        <h3
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': props.compact ? '18px' : '21px',
            'font-weight': '600',
            'letter-spacing': '-0.01em',
            margin: 0,
          }}
        >
          Q3 launch plan
        </h3>
        <p style={body}>
          Ship the new workspace to general availability the week of{' '}
          <span style={{ color: 'var(--c1)', 'font-weight': '600' }}>
            July 14
          </span>
          . Owners and dates below — shared automatically with everyone in
          #go-to-market.
        </p>
        <div style={{ display: 'grid', gap: props.compact ? '9px' : '11px' }}>
          <div
            style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}
          >
            {check(true)}
            <span style={body}>Finalize launch timeline</span>
          </div>
          <div
            style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}
          >
            {check(true)}
            <span style={body}>Lock pricing &amp; packaging</span>
          </div>
          <div
            style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}
          >
            {check(false)}
            <span style={body}>Draft the announcement post</span>
          </div>
          <Show when={!props.compact}>
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}
            >
              {check(false)}
              <span style={body}>Brief the support team</span>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

export function ChannelCohesionGraphic() {
  const compact = () => mobile();

  const PREFIX = 'Final plan is locked in ';
  const QUERY = '@q3';

  // Timeline, in ms. The clock starts at `rest` so the first painted frame
  // (and the SSR / reduced-motion frame) is the fully-open split screen.
  // Beat order after the message is sent: the "Shared to #go-to-market" toast
  // confirms the share FIRST, then ~1.25s later the cursor clicks the mention,
  // and only then does the doc pane slide open.
  const TL = {
    cycle: 12000,
    typeStart: 600,
    typeEnd: 2300,
    queryEnd: 2750,
    pick: 3750,
    send: 4400,
    toastIn: 4850,
    cursorIn: 5700,
    click: 6100,
    splitStart: 6250,
    splitEnd: 7000,
    toastOut: 8200,
    rest: 10600,
    fadeStart: 11350,
    closeEnd: 11850,
  };

  const [t, setT] = createSignal(TL.rest);

  const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const prog = (a: number, b: number) => clamp01((t() - a) / (b - a));
  const ease = (x: number) =>
    x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

  onMount(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      setT((p) => (p + dt) % TL.cycle);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  // --- derived state -------------------------------------------------------
  const typedPrefix = () =>
    PREFIX.slice(0, Math.round(prog(TL.typeStart, TL.typeEnd) * PREFIX.length));
  const typedQuery = () =>
    QUERY.slice(0, Math.round(prog(TL.typeEnd, TL.queryEnd) * QUERY.length));
  const menuOpen = () => t() >= TL.typeEnd && t() < TL.pick;
  const showPill = () => t() >= TL.pick && t() < TL.send;
  const composerActive = () => t() >= TL.typeStart && t() < TL.send;
  const messagePresent = () => t() >= TL.send;
  const msgEnter = () => ease(prog(TL.send, TL.send + 360));
  const msgOpacity = () => msgEnter() * (1 - prog(TL.fadeStart, TL.closeEnd));
  const splitAmt = () =>
    clamp01(
      ease(prog(TL.splitStart, TL.splitEnd)) -
        ease(prog(TL.fadeStart, TL.closeEnd))
    );
  const toastAmt = () =>
    clamp01(
      ease(prog(TL.toastIn, TL.toastIn + 340)) -
        ease(prog(TL.toastOut - 340, TL.toastOut))
    );
  const cursorAmt = () =>
    clamp01(
      ease(prog(TL.cursorIn, TL.cursorIn + 560)) -
        ease(prog(TL.splitStart, TL.splitStart + 320))
    );
  const clickPulse = () => prog(TL.click, TL.click + 320);

  const nameStyle: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-family': appFont,
    'font-weight': '600',
  };
  const timeStyle: JSX.CSSProperties = {
    color: 'var(--c4)',
    'font-family': appFont,
    'font-size': '11.5px',
    'white-space': 'nowrap',
  };
  const msgText: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-family': appFont,
    'font-weight': '350',
    'line-height': 1.55,
    margin: 0,
  };

  const priorMessages = [
    {
      who: 'Gabriel Birman',
      initials: 'GB',
      time: '9:58 AM',
      text: 'are we locking the launch plan today?',
    },
    {
      who: 'Julia Westphal',
      initials: 'JW',
      time: '10:02 AM',
      text: 'finishing the timeline now — one sec',
    },
  ];

  return (
    <div
      class="cohesion-window"
      style={{
        'background-color': '#080808',
        border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
        'border-radius': '12px',
        'box-shadow': 'var(--shadow-window)',
        'box-sizing': 'border-box',
        // Fade the TOP edge (not the bottom) so the composer stays crisp.
        '-webkit-mask-image':
          'linear-gradient(to top, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 72%, rgb(0 0 0 / 0.12) 100%)',
        'mask-image':
          'linear-gradient(to top, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 72%, rgb(0 0 0 / 0.12) 100%)',
        overflow: 'hidden',
        padding: '7px',
        width: '100%',
      }}
    >
      <style>{`
        @keyframes cohesionCaretBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        @media (prefers-reduced-motion: no-preference) {
          .cohesion-caret { animation: cohesionCaretBlink 1.05s steps(1) infinite; }
        }
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           build-time prerender paints correctly on phones before the JS
           bundle loads. */
        .channels-gfx-stage { height: 504px; }
        .channels-gfx-header { gap: 13px; padding: 12px 16px; }
        .channels-gfx-header-carets { display: inline-flex; }
        .channels-gfx-header-title { font-size: 15px; }
        .channels-gfx-header-call { display: inline-flex; }
        .channels-gfx-messages { gap: 17px; justify-content: flex-end; padding: 18px 18px; }
        .channels-gfx-name { font-size: 13.5px; }
        .channels-gfx-msg-text { font-size: 14.5px; }
        .channels-gfx-cursor svg { height: 22px; width: 22px; }
        .channels-gfx-composer { padding: 12px 16px; }
        .channels-gfx-mention-menu { left: 16px; width: 340px; }
        .channels-gfx-composer-line { min-height: 22px; }
        .channels-gfx-composer-text { font-size: 14.5px; }
        .channels-gfx-caret { height: 16px; }
        @media (max-width: 699px) {
          .channels-gfx-stage { height: 440px; }
          .channels-gfx-header { gap: 10px; padding: 11px 13px; }
          .channels-gfx-header-carets { display: none; }
          .channels-gfx-header-title { font-size: 14px; }
          .channels-gfx-header-call { display: none; }
          .channels-gfx-messages { gap: 14px; justify-content: flex-start; padding: 14px 13px; }
          .channels-gfx-name { font-size: 13px; }
          .channels-gfx-msg-text { font-size: 13.5px; }
          .channels-gfx-cursor svg { height: 20px; width: 20px; }
          .channels-gfx-composer { padding: 10px 13px; }
          .channels-gfx-mention-menu { left: 13px; width: min(320px, calc(100% - 26px)); }
          .channels-gfx-composer-line { min-height: 20px; }
          .channels-gfx-composer-text { font-size: 13.5px; }
          .channels-gfx-caret { height: 15px; }
        }
      `}</style>

      <div
        class="channels-gfx-stage"
        style={{
          'background-color': '#080808',
          border: '1px solid color-mix(in srgb, var(--c4) 12%, transparent)',
          'border-radius': '8px',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          position: 'relative',
          'text-align': 'left',
        }}
      >
        {/* Channel pane (always full size; the doc slides in over it) */}
        <div
          style={{
            display: 'grid',
            'grid-template-rows': 'auto 1fr auto',
            height: '100%',
            'min-width': 0,
          }}
        >
          {/* Header */}
          <div
            class="channels-gfx-header"
            style={{
              'align-items': 'center',
              'border-bottom':
                '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
              display: 'flex',
              overflow: 'hidden',
            }}
          >
            <span
              aria-hidden="true"
              class="channels-gfx-header-carets"
              style={{
                'align-items': 'center',
                color: 'var(--c4)',
                flex: 'none',
                gap: '4px',
              }}
            >
              <NavCaret dir="left" />
              <NavCaret dir="right" />
            </span>
            <span
              class="channels-gfx-header-title"
              style={{
                'align-items': 'center',
                color: 'var(--c1)',
                display: 'inline-flex',
                'font-family': appFont,
                'font-weight': '600',
                gap: '6px',
              }}
            >
              <HashGlyph size={15} /> go-to-market
            </span>
            <span
              style={{
                'align-items': 'center',
                display: 'inline-flex',
                gap: '10px',
                'margin-left': 'auto',
              }}
            >
              <span style={{ display: 'inline-flex' }}>
                <Avatar initials="GB" size={22} color="var(--b4)" />
                <span style={{ 'margin-left': '-7px' }}>
                  <Avatar initials="JW" size={22} color="var(--b3)" />
                </span>
              </span>
              <span
                class="channels-gfx-header-call"
                style={{
                  'align-items': 'center',
                  color: 'var(--c2)',
                  'font-family': appFont,
                  'font-size': '12.5px',
                  gap: '6px',
                  'white-space': 'nowrap',
                }}
              >
                <PhoneGlyph size={14} /> Call
              </span>
            </span>
          </div>

          {/* Messages — anchored to the bottom so new ones rise toward the composer */}
          <div
            class="channels-gfx-messages"
            style={{
              'box-sizing': 'border-box',
              display: 'flex',
              'flex-direction': 'column',
              'min-height': 0,
              overflow: 'hidden',
            }}
          >
            <For each={priorMessages}>
              {(m) => (
                <div
                  style={{
                    'align-items': 'flex-start',
                    display: 'flex',
                    gap: '10px',
                  }}
                >
                  <Avatar initials={m.initials} size={28} color="var(--b3)" />
                  <div
                    style={{
                      display: 'grid',
                      gap: '2px',
                      'grid-template-columns': 'minmax(0, 1fr)',
                      'min-width': 0,
                      width: '100%',
                    }}
                  >
                    <div
                      style={{
                        'align-items': 'baseline',
                        display: 'flex',
                        gap: '8px',
                      }}
                    >
                      <span class="channels-gfx-name" style={nameStyle}>
                        {m.who}
                      </span>
                      <span style={timeStyle}>{m.time}</span>
                    </div>
                    <p class="channels-gfx-msg-text" style={msgText}>
                      {m.text}
                    </p>
                  </div>
                </div>
              )}
            </For>

            {/* The message the viewer just sent, carrying the @mention */}
            <Show when={messagePresent()}>
              <div
                style={{
                  'align-items': 'flex-start',
                  display: 'flex',
                  gap: '10px',
                  opacity: msgOpacity(),
                  transform: `translateY(${(1 - msgEnter()) * 12}px)`,
                }}
              >
                <Avatar initials="JB" size={28} color="var(--b3)" />
                <div
                  style={{
                    display: 'grid',
                    gap: '2px',
                    'grid-template-columns': 'minmax(0, 1fr)',
                    'min-width': 0,
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      'align-items': 'baseline',
                      display: 'flex',
                      gap: '8px',
                    }}
                  >
                    <span class="channels-gfx-name" style={nameStyle}>
                      Jacob Beckerman
                    </span>
                    <span style={timeStyle}>10:04 AM</span>
                  </div>
                  <p class="channels-gfx-msg-text" style={msgText}>
                    {PREFIX}
                    <span
                      style={{
                        display: 'inline-flex',
                        position: 'relative',
                        'vertical-align': 'middle',
                      }}
                    >
                      <MentionPill kind="doc" label="Q3 launch plan" brand />
                      {/* synthetic click ring */}
                      <Show when={clickPulse() > 0 && clickPulse() < 1}>
                        <span
                          aria-hidden="true"
                          style={{
                            border:
                              '2px solid color-mix(in srgb, var(--a0) 70%, transparent)',
                            'border-radius': '10px',
                            inset: '-6px',
                            opacity: 1 - clickPulse(),
                            'pointer-events': 'none',
                            position: 'absolute',
                            transform: `scale(${0.7 + clickPulse() * 0.6})`,
                          }}
                        />
                      </Show>
                      {/* synthetic cursor */}
                      <Show when={cursorAmt() > 0.01}>
                        <span
                          aria-hidden="true"
                          class="channels-gfx-cursor"
                          style={{
                            bottom: '-12px',
                            opacity: cursorAmt(),
                            position: 'absolute',
                            right: '-10px',
                            transform: `translate(${(1 - cursorAmt()) * 30}px, ${(1 - cursorAmt()) * 22}px) scale(${1 - clickPulse() * 0.18})`,
                            'z-index': 6,
                          }}
                        >
                          <PointerCursor />
                        </span>
                      </Show>
                    </span>
                  </p>
                </div>
              </div>
            </Show>
          </div>

          {/* Composer */}
          <div
            class="channels-gfx-composer"
            style={{
              'border-top':
                '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
              'box-sizing': 'border-box',
              position: 'relative',
            }}
          >
            {/* @mention menu — opens upward so it never hides the composer.
                Mirrors the real Macro typeahead: an elevated rounded-xl card with
                muted section headers, a subtle ink/5 highlight on the active row,
                and a "View all →" affordance. */}
            <Show when={menuOpen()}>
              <div
                class="channels-gfx-mention-menu"
                style={{
                  'background-color':
                    'color-mix(in srgb, var(--b2) 55%, var(--b0))',
                  border:
                    '1px solid color-mix(in srgb, var(--b4) 55%, transparent)',
                  'border-radius': '12px',
                  bottom: 'calc(100% + 8px)',
                  'box-shadow':
                    '0 10px 15px -3px rgb(0 0 0 / 0.4), 0 4px 6px -4px rgb(0 0 0 / 0.4)',
                  'box-sizing': 'border-box',
                  overflow: 'hidden',
                  padding: '8px 0 6px',
                  position: 'absolute',
                  'z-index': 5,
                }}
              >
                <For
                  each={[
                    {
                      heading: 'Documents',
                      items: [
                        { kind: 'doc', label: 'Q3 launch plan' },
                        { kind: 'doc', label: 'Q3 metrics dashboard' },
                      ],
                    },
                    {
                      heading: 'Tasks',
                      items: [{ kind: 'task', label: 'Q3 launch checklist' }],
                    },
                  ]}
                >
                  {(section, si) => (
                    <>
                      <div
                        style={{
                          'align-items': 'center',
                          color: 'var(--c4)',
                          display: 'flex',
                          'font-family': appFont,
                          'font-size': '11.5px',
                          'font-weight': '500',
                          'justify-content': 'space-between',
                          'margin-top': si() === 0 ? '0' : '4px',
                          padding: '0 12px 6px',
                        }}
                      >
                        <span>{section.heading}</span>
                        <Show when={si() === 0}>
                          <span
                            style={{
                              'align-items': 'center',
                              color: 'var(--c4)',
                              display: 'inline-flex',
                              gap: '5px',
                            }}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                'align-items': 'center',
                                'background-color':
                                  'color-mix(in srgb, var(--c1) 7%, transparent)',
                                border:
                                  '1px solid color-mix(in srgb, var(--c4) 20%, transparent)',
                                'border-radius': '4px',
                                display: 'inline-grid',
                                'font-size': '10px',
                                height: '15px',
                                'line-height': 1,
                                'min-width': '15px',
                                'place-items': 'center',
                              }}
                            >
                              →
                            </span>
                            View all
                          </span>
                        </Show>
                      </div>
                      <For each={section.items}>
                        {(item, ii) => (
                          <div
                            style={{
                              'align-items': 'center',
                              'background-color':
                                si() === 0 && ii() === 0
                                  ? 'color-mix(in srgb, var(--c1) 5%, transparent)'
                                  : 'transparent',
                              'border-radius': '6px',
                              display: 'flex',
                              gap: '9px',
                              margin: '0 6px',
                              padding: '6px 8px',
                            }}
                          >
                            <span
                              style={{
                                'align-items': 'center',
                                display: 'inline-flex',
                                flex: 'none',
                                height: '17px',
                                'justify-content': 'center',
                                width: '17px',
                              }}
                            >
                              <Show when={item.kind === 'doc'}>
                                <DocFileGlyph size={15} color={NOTE_VIOLET} />
                              </Show>
                              <Show when={item.kind === 'task'}>
                                <TaskListGlyph size={15} />
                              </Show>
                            </span>
                            <span
                              style={{
                                color: 'var(--c1)',
                                'font-family': appFont,
                                'font-size': '13.5px',
                                'font-weight': '500',
                                overflow: 'hidden',
                                'text-overflow': 'ellipsis',
                                'white-space': 'nowrap',
                              }}
                            >
                              {item.label}
                            </span>
                          </div>
                        )}
                      </For>
                    </>
                  )}
                </For>
              </div>
            </Show>

            <div
              style={{
                'background-color': '#0a0a0a',
                border: `1px solid color-mix(in srgb, ${composerActive() ? 'var(--c1) 22%' : 'var(--c4) 16%'}, transparent)`,
                'border-radius': '12px',
                'box-sizing': 'border-box',
                display: 'grid',
                gap: '12px',
                padding: '12px 12px 10px',
                transition: 'border-color 200ms ease',
              }}
            >
              <div class="channels-gfx-composer-line">
                <Show
                  when={composerActive()}
                  fallback={
                    <span
                      class="channels-gfx-composer-text"
                      style={{ color: 'var(--c4)', 'font-family': appFont }}
                    >
                      Message #go-to-market
                    </span>
                  }
                >
                  <span
                    class="channels-gfx-composer-text"
                    style={{
                      color: 'var(--c1)',
                      'font-family': appFont,
                      'line-height': 1.5,
                    }}
                  >
                    {PREFIX.slice(0, typedPrefix().length)}
                    <Show when={menuOpen()}>
                      <span
                        style={{
                          'background-color':
                            'color-mix(in srgb, var(--a0) 22%, transparent)',
                          'border-radius': '4px',
                          color: 'var(--c1)',
                          padding: '1px 4px',
                        }}
                      >
                        {typedQuery()}
                      </span>
                    </Show>
                    <Show when={showPill()}>
                      <MentionPill kind="doc" label="Q3 launch plan" brand />
                    </Show>
                    <span
                      aria-hidden="true"
                      class="cohesion-caret channels-gfx-caret"
                      style={{
                        'background-color': 'var(--c1)',
                        display: 'inline-block',
                        'margin-left': '1px',
                        'vertical-align': 'text-bottom',
                        width: '1.5px',
                      }}
                    />
                  </span>
                </Show>
              </div>
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
                    'background-color': composerActive()
                      ? 'var(--a0)'
                      : 'transparent',
                    border: composerActive()
                      ? '1px solid var(--a0)'
                      : '1px solid color-mix(in srgb, var(--c4) 26%, transparent)',
                    'border-radius': '999px',
                    color: composerActive() ? 'var(--b0)' : 'var(--c2)',
                    display: 'inline-flex',
                    flex: 'none',
                    height: '28px',
                    'justify-content': 'center',
                    'margin-left': 'auto',
                    transition:
                      'background-color 200ms ease, color 200ms ease, border-color 200ms ease',
                    width: '28px',
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    style={{ display: 'block' }}
                  >
                    <path
                      d="M12 19V5M12 5l-6 6M12 5l6 6"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile scrim behind the doc sheet */}
        <SsgMobile>
          <div
            aria-hidden="true"
            style={{
              'background-color': `rgb(0 0 0 / ${0.5 * splitAmt()})`,
              bottom: '-3px',
              left: 0,
              opacity: splitAmt() > 0.01 ? 1 : 0,
              'pointer-events': 'none',
              position: 'absolute',
              right: 0,
              top: '-3px',
              'z-index': 2,
            }}
          />
        </SsgMobile>

        {/* The doc pane — slides in from the right (desktop) or up (mobile).
            Rendered twice (one branch per viewport) so the prerender carries
            both and CSS picks the right one before the JS bundle loads. */}
        <Show when={splitAmt() > 0.001}>
          <SsgDesktop>
            <div
              style={{
                'border-left':
                  '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
                'border-top': '0',
                bottom: 0,
                'box-shadow': '-30px 0 60px rgb(0 0 0 / 0.45)',
                'box-sizing': 'border-box',
                height: '100%',
                overflow: 'hidden',
                position: 'absolute',
                right: 0,
                top: 0,
                transform: `translateX(${(1 - splitAmt()) * 100}%)`,
                width: '46%',
                'z-index': 3,
              }}
            >
              <CohesionDocPane compact={false} />
            </div>
          </SsgDesktop>
          <SsgMobile>
            <div
              style={{
                'border-left': '0',
                'border-top':
                  '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
                bottom: 0,
                'box-shadow': '0 -24px 60px rgb(0 0 0 / 0.5)',
                'box-sizing': 'border-box',
                height: '78%',
                overflow: 'hidden',
                position: 'absolute',
                right: 0,
                top: 'auto',
                transform: `translateY(${(1 - splitAmt()) * 100}%)`,
                width: '100%',
                'z-index': 3,
              }}
            >
              <CohesionDocPane compact={true} />
            </div>
          </SsgMobile>
        </Show>

        {/* Share toast, bottom-right — hidden on mobile (too cramped) */}
        <Show when={toastAmt() > 0.01 && !compact()}>
          <div
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--b1) 92%, var(--b0))',
              border:
                '1px solid color-mix(in srgb, var(--c4) 20%, transparent)',
              'border-radius': '12px',
              bottom: compact() ? '88px' : '92px',
              'box-shadow': 'var(--shadow-panel-lg)',
              'box-sizing': 'border-box',
              display: 'flex',
              gap: '11px',
              'max-width': 'calc(100% - 28px)',
              opacity: toastAmt(),
              padding: compact() ? '11px 13px' : '13px 15px',
              position: 'absolute',
              right: compact() ? '14px' : '18px',
              transform: `translateY(${(1 - toastAmt()) * 16}px)`,
              'z-index': 7,
            }}
          >
            <CheckBadge size={compact() ? 24 : 26} />
            <div style={{ display: 'grid', gap: '2px', 'min-width': 0 }}>
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': compact() ? '13px' : '13.5px',
                  'font-weight': '600',
                }}
              >
                Shared to #go-to-market
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': compact() ? '12px' : '12.5px',
                }}
              >
                Q3 launch plan · everyone now has access
              </span>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison table (Macro vs Slack vs Discord vs Microsoft Teams)
// ---------------------------------------------------------------------------

type Cell = boolean | 'partial' | string;

const comparisonColumns = ['Macro', 'Slack', 'Discord', 'Teams'];

const comparisonRows: { feature: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  { feature: 'Channels, threads & emoji', cells: [true, true, true, true] },
  {
    feature: 'Inline thread replies (forum-style)',
    cells: [true, false, 'partial', false],
  },
  {
    feature: 'One inbox shared with your email',
    cells: [true, false, false, 'partial'],
  },
  {
    feature: '@mention a doc or task to auto-share it',
    cells: [true, false, false, false],
  },
  {
    feature: 'Channel-based access control',
    cells: [true, 'partial', 'partial', 'partial'],
  },
  {
    feature: 'Built-in tasks, docs & email',
    cells: [true, false, false, 'partial'],
  },
  {
    feature: 'Agents with full-workspace context',
    cells: [true, 'partial', false, 'partial'],
  },
  {
    feature: 'Unified search across everything',
    cells: [true, false, false, false],
  },
  {
    feature: 'External / guest channels',
    cells: ['partial', true, true, true],
  },
  { feature: 'Open source (AGPLv3)', cells: [true, false, false, false] },
  { feature: 'Price / seat / month', cells: ['$40', '$8.75', 'Free', '$4'] },
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
      ? 'minmax(150px, 1.5fr) repeat(4, minmax(52px, 1fr))'
      : 'minmax(0, 2.2fr) repeat(4, minmax(0, 1fr))';

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
          'min-width': mobile() ? '500px' : 'auto',
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
    q: 'How is Macro different from Slack?',
    a: (
      <>
        Channels in Macro are quieter and more organized. The first few replies
        show inline, so you don't open a thread every time someone responds, and
        a busy channel reads more like a forum than a firehose. Channels also
        share one inbox with your email (split into Signal and Noise), and
        everything you @mention is shared with the channel automatically.
      </>
    ),
  },
  {
    q: 'What is channel-based sharing?',
    a: (
      <>
        @mention a doc or task in a channel and every member gets access
        automatically. Add someone to the channel and they gain access to
        everything shared in it; remove them and they lose it. It fixes the
        Slack-plus-Notion footgun where people constantly have to ask "can you
        share ___ with me?"
      </>
    ),
  },
  {
    q: 'Can I keep using Slack?',
    a: (
      <>
        Yes. Connect Slack under <strong>Settings → Connectors</strong> as an
        MCP connector so agents in Macro can still search it. That helps with
        archives or Slack Connect with customers. Many teams run Macro for
        internal communication and keep Slack only for external channels during
        the transition.
      </>
    ),
  },
  {
    q: 'What can I @mention in a channel?',
    a: (
      <>
        Users, documents, tasks, files, emails, other channels, dates (
        <code>@tomorrow</code>), and groups (<code>@here</code>). Each mention
        creates a two-way link between both places, and messages use the same
        rich editor (formatting, attachments, and markdown) as everywhere else
        in Macro.
      </>
    ),
  },
  {
    q: 'Can agents work inside channels?',
    a: (
      <>
        Yes. @mention <strong>@Macro</strong> to call an agent into the channel.
        It can summarize earlier discussion, answer questions about your
        workspace, draft replies, and more, with the full context of your docs,
        tasks, and email.
      </>
    ),
  },
  {
    q: 'Do channel members need a Macro account?',
    a: (
      <>
        No. Anyone can be added to a channel by email, even if they're not on
        your team. People without a Macro account receive an email telling them
        about their channel notifications.
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

function _FaqSection(props: { area: string }) {
  return (
    <section
      aria-label="Frequently asked questions"
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '24px' : '40px',
        'grid-area': props.area,
        'justify-items': 'center',
        padding: mobile() ? '48px 18px' : '72px 54px',
      }}
    >
      <style>{`
        .channels-faq__item { border-bottom: 1px solid var(--b2); }
        .channels-faq__item > summary {
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
        .channels-faq__item > summary::-webkit-details-marker { display: none; }
        .channels-faq__item > summary .channels-faq__chevron { color: var(--c4); flex-shrink: 0; transition: transform 220ms ease; }
        .channels-faq__item[open] > summary .channels-faq__chevron { transform: rotate(180deg); }
        .channels-faq__answer { color: var(--c4); font-size: 16px; line-height: 1.6; margin: 0; padding: 0 4px 24px; max-width: 760px; }
        .channels-faq__answer a { color: var(--a0); text-decoration: none; }
        .channels-faq__answer code { background: color-mix(in srgb, var(--c4) 12%, transparent); border-radius: 4px; font-size: 13px; padding: 1px 5px; }
        @media (hover) {
          .channels-faq__item > summary:hover { color: var(--a0); }
          .channels-faq__answer a:hover { text-decoration: underline; }
        }
        @media (max-width: 700px) {
          .channels-faq__item > summary { font-size: 17px; padding: 18px 4px; }
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
            <details class="channels-faq__item">
              <summary>
                <span>{item.q}</span>
                <svg
                  class="channels-faq__chevron"
                  width="16"
                  height="16"
                  viewBox="0 0 256 256"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
                </svg>
              </summary>
              <p class="channels-faq__answer">{item.a}</p>
            </details>
          )}
        </For>
      </div>
    </section>
  );
}
