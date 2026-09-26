import {
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import callMainFeedUrl from '../../../assets/calls/call-main-feed.webp?url';
import callPipFeedUrl from '../../../assets/calls/call-pip-feed.webp?url';
import IconGithub from '../../../assets/icons/icon-github.svg';
import IconCallRow from '../../../assets/icons/wide-call.svg';
import { breakpoint, viewportWidth } from '../../utils/utilBreakpoint';
import {
  CtaIcon,
  ctaHref,
  ctaLabel,
  handleCtaClick,
} from '../../utils/utilCta';
import { TabsInset } from '../graphics/MockupChrome';
import { PreviewListDivider } from '../graphics/PreviewListDivider';
import { PreviewWindow } from '../graphics/PreviewWindow';
import { PhoneFrame, PhoneScreenContent } from '../utils/UtilPhoneFrame';

const _HERO_DEMO_VIDEO_ID = 'MMG00RA7kU0'; // "Calls on Macro"
const MACRO_REPO_URL = 'https://github.com/macro-inc/macro';

// ---------------------------------------------------------------------------
// Shared style fragments (matching the homepage / email / docs / channels bento)
// ---------------------------------------------------------------------------

const mobile = () => viewportWidth() < 700;

// Faux-app chrome uses a neutral UI sans so the mocks read as real product
// screenshots rather than marketing copy.
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Call-status accents: red for missed, green for attended, neutral for
// unattended — mirroring the badges in the real calls tab.
const _STATUS_MISSED = 'oklch(0.68 0.16 25)';
const STATUS_ATTENDED = 'var(--a2)';

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
      class="calls-cta-button"
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
// it never runs during SSR / prerender) and revealed once loaded.
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
      class="calls-cta-button"
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

function ChevronRightGlyph(props: { size?: number; color?: string }) {
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
        d="M9 6l6 6-6 6"
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

// The handset glyph used throughout the calls UI.
function PhoneGlyph(props: { size?: number; color?: string }) {
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

function SearchTinyGlyph(props: { size?: number; color?: string }) {
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
        stroke={props.color ?? 'currentColor'}
        stroke-width="2"
      />
      <path
        d="M20 20l-4-4"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  );
}

function _InfoGlyph(props: { size?: number; color?: string }) {
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
        stroke-width="1.7"
      />
      <path
        d="M12 11v5"
        fill="none"
        stroke={props.color ?? 'var(--c4)'}
        stroke-width="1.7"
        stroke-linecap="round"
      />
      <circle cx="12" cy="7.8" r="1.1" fill={props.color ?? 'var(--c4)'} />
    </svg>
  );
}

function ClockGlyph(props: { size?: number; color?: string }) {
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
        r="8.5"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.7"
      />
      <path
        d="M12 7.5V12l3 2"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function PlayGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path d="M8 5.5l11 6.5-11 6.5z" fill={props.color ?? 'currentColor'} />
    </svg>
  );
}

function LockGlyph(props: { size?: number; color?: string }) {
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
        x="5"
        y="11"
        width="14"
        height="9"
        rx="2"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.7"
      />
      <path
        d="M8 11V8a4 4 0 0 1 8 0v3"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>
  );
}

function TaskListGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 16;
  const c = props.color ?? 'var(--a2)';
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

function CheckTinyGlyph(props: { size?: number; color?: string }) {
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
        stroke={props.color ?? 'currentColor'}
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// Static "video tile" used in recording previews: a soft gradient backdrop with
// a head-and-shoulders silhouette so it reads as a person on camera.
function VideoTile(props: { initials: string; hue: number; muted?: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        'aspect-ratio': '16 / 10',
        background: `linear-gradient(150deg, oklch(0.34 0.05 ${props.hue}) 0%, oklch(0.22 0.03 ${props.hue}) 100%)`,
        'border-radius': '8px',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <Show
        when={!props.muted}
        fallback={
          <div
            style={{
              'align-items': 'center',
              display: 'grid',
              height: '100%',
              'place-items': 'center',
              width: '100%',
            }}
          >
            <Avatar
              initials={props.initials}
              size={30}
              color="color-mix(in srgb, var(--b4) 70%, var(--b0))"
            />
          </div>
        }
      >
        <svg
          viewBox="0 0 80 50"
          preserveAspectRatio="xMidYMax meet"
          style={{
            bottom: 0,
            height: '78%',
            left: '50%',
            position: 'absolute',
            transform: 'translateX(-50%)',
          }}
        >
          <circle cx="40" cy="17" r="11" fill="oklch(0.62 0.04 60 / 0.9)" />
          <path
            d="M16 50c0-13 11-21 24-21s24 8 24 21z"
            fill="oklch(0.55 0.04 60 / 0.85)"
          />
        </svg>
      </Show>
      <span
        style={{
          background: 'rgb(0 0 0 / 0.45)',
          'border-radius': '5px',
          bottom: '5px',
          color: '#fff',
          'font-family': appFont,
          'font-size': '8.5px',
          'font-weight': '600',
          left: '5px',
          padding: '1px 5px',
          position: 'absolute',
        }}
      >
        {props.initials}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Call-status badge (Missed / Attended / Unattended)
// ---------------------------------------------------------------------------

type CallStatus = 'attended' | 'unattended';

function StatusBadge(props: { status: CallStatus }) {
  const color = () =>
    props.status === 'attended' ? STATUS_ATTENDED : 'var(--c4)';
  const label = () => (props.status === 'attended' ? 'Attended' : 'Unattended');
  return (
    <span
      style={{
        'background-color':
          props.status === 'unattended'
            ? 'color-mix(in srgb, var(--c4) 12%, transparent)'
            : `color-mix(in srgb, ${color()} 16%, transparent)`,
        'border-radius': '4px',
        color: color(),
        flex: 'none',
        'justify-self': 'start',
        'font-family': "'rajdhani', body",
        'font-size': '9.5px',
        'font-weight': '700',
        'letter-spacing': '0.07em',
        'line-height': 1,
        padding: '4px 6px 3px',
        'text-transform': 'uppercase',
        'white-space': 'nowrap',
      }}
    >
      {label()}
    </span>
  );
}

// A short stack of overlapping participant avatars with an optional overflow.
function AvatarStack(props: {
  people: string[];
  extra?: number;
  size?: number;
}) {
  const s = props.size ?? 20;
  return (
    <span style={{ 'align-items': 'center', display: 'inline-flex' }}>
      <For each={props.people}>
        {(p, i) => (
          <span
            style={{
              'border-radius': '999px',
              'box-shadow': '0 0 0 2px var(--b0)',
              display: 'inline-flex',
              'margin-left': i() === 0 ? '0' : '-7px',
            }}
          >
            <Avatar
              initials={p}
              size={s}
              color={i() % 2 === 0 ? 'var(--b3)' : 'var(--b4)'}
            />
          </span>
        )}
      </For>
      <Show when={props.extra}>
        <span
          style={{
            'align-items': 'center',
            'background-color': 'var(--b2)',
            border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            'border-radius': '999px',
            'box-shadow': '0 0 0 2px var(--b0)',
            'box-sizing': 'border-box',
            color: 'var(--c4)',
            display: 'inline-flex',
            'font-family': appFont,
            'font-size': `${Math.round(s * 0.42)}px`,
            'font-weight': '600',
            height: `${s}px`,
            'justify-content': 'center',
            'margin-left': '-7px',
            width: `${s}px`,
          }}
        >
          +{props.extra}
        </span>
      </Show>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hero: realistic app window (calls list + Ask-AI bar)
// ---------------------------------------------------------------------------

const callTabs = ['All', 'Unattended', 'Attended'];

interface HeroCall {
  title: string;
  dur: string;
  status: CallStatus;
  people: string[];
  extra?: number;
  time: string;
  // Date bucket the row belongs to. Rows stay in descending date order so each
  // bucket is contiguous and the list reads like a real, date-grouped calls tab.
  group: string;
}

const heroCalls: HeroCall[] = [
  // Today
  {
    title: 'Onboarding Regressions, Sharing Model & Team Memory',
    dur: '46m 35s',
    status: 'unattended',
    people: ['SW', 'JW'],
    extra: 2,
    time: '10:32',
    group: 'Today',
  },
  {
    title: 'Engineers Weekly Sync',
    dur: '9m 29s',
    status: 'attended',
    people: ['EX', 'JB'],
    extra: 2,
    time: '9:05',
    group: 'Today',
  },
  // This week
  {
    title: 'Teo & Aidan Sprint Update: Multi-Inbox and Snippets',
    dur: '16m 25s',
    status: 'attended',
    people: ['TN', 'AH'],
    time: 'Jun 16',
    group: 'This week',
  },
  {
    title: 'Settings UI Overhaul: Sidebar Layout & Redesign',
    dur: '9m 37s',
    status: 'unattended',
    people: ['TN'],
    time: 'Jun 15',
    group: 'This week',
  },
  // Earlier this month
  {
    title: 'Teo, Hutch, Evan & Aidan Sprint Updates',
    dur: '8m 30s',
    status: 'attended',
    people: ['TN', 'HU'],
    extra: 3,
    time: 'Jun 11',
    group: 'Earlier this month',
  },
  {
    title: 'Engineering Standup: Multi-Inbox, CRM Search & Deploys',
    dur: '7m 59s',
    status: 'unattended',
    people: ['TN', 'HU'],
    extra: 2,
    time: 'Jun 9',
    group: 'Earlier this month',
  },
];

// A call needs your attention until you've actually been in it.
const callUnread = (call: HeroCall) => call.status !== 'attended';

export function HeroCallsWindow() {
  const compact = () => mobile();
  const [activeTab, setActiveTab] = createSignal(0);
  const [archived, setArchived] = createSignal<number[]>([]);
  const [selected, setSelected] = createSignal(0);
  const [, setInteracted] = createSignal(false);

  const matchesTab = (call: HeroCall) =>
    activeTab() === 0
      ? true
      : activeTab() === 1
        ? call.status === 'unattended'
        : call.status === 'attended';
  const visibleCalls = () =>
    heroCalls
      .map((call, i) => ({ call, i }))
      .filter(({ i }) => !archived().includes(i))
      .filter(({ call }) => matchesTab(call));

  // Flatten visible calls into a render list with date-group headers injected
  // whenever the bucket changes. `nav` keeps each row's index into
  // visibleCalls() so J/K/E selection lines up with the flat list.
  type HeroListItem =
    | { kind: 'header'; label: string }
    | { kind: 'row'; call: HeroCall; nav: number; lastInGroup: boolean };
  const groupedCalls = (): HeroListItem[] => {
    const vis = visibleCalls();
    const items: HeroListItem[] = [];
    vis.forEach((entry, nav) => {
      const prev = vis[nav - 1];
      if (!prev || prev.call.group !== entry.call.group) {
        items.push({ kind: 'header', label: entry.call.group });
      }
      const next = vis[nav + 1];
      items.push({
        kind: 'row',
        call: entry.call,
        nav,
        lastInGroup: !next || next.call.group !== entry.call.group,
      });
    });
    return items;
  };

  const selectTab = (tab: number) => {
    setActiveTab(tab);
    setSelected(0);
    setInteracted(true);
  };
  const archiveCurrent = () => {
    const rows = visibleCalls();
    const target = rows[selected()];
    if (!target) return;
    setArchived((prev) => [...prev, target.i]);
    setSelected((s) => Math.max(0, Math.min(s, rows.length - 2)));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const rows = visibleCalls();
    const key = e.key.toLowerCase();
    if (key === 'j' || key === 'arrowdown') {
      setSelected((s) => Math.min(s + 1, Math.max(0, rows.length - 1)));
      setInteracted(true);
      e.preventDefault();
    } else if (key === 'k' || key === 'arrowup') {
      setSelected((s) => Math.max(s - 1, 0));
      setInteracted(true);
      e.preventDefault();
    } else if (key === 'e') {
      archiveCurrent();
      setInteracted(true);
      e.preventDefault();
    }
  };

  return (
    <PreviewWindow
      class="calls-hero-window"
      background="#080808"
      innerBackground="#080808"
      mask="linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 66%, rgb(0 0 0 / 0.18) 100%)"
      interactive={{
        ariaLabel:
          'Interactive Macro calls demo. Use J and K to navigate, E to archive.',
        onKeyDown,
      }}
    >
      {/* Calls pane */}
      <div
        style={{
          display: 'grid',
          'grid-template-rows': 'auto 1fr auto',
          'min-width': 0,
        }}
      >
        {/* Toolbar: title + tabs + actions */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--b4) 18%, transparent)',
            'box-sizing': 'border-box',
            display: 'flex',
            gap: '14px',
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
              'font-family': appFont,
              'font-size': compact() ? '14px' : '15px',
              'font-weight': '500',
              gap: '6px',
            }}
          >
            Calls
          </span>
          <TabsInset
            tabs={callTabs}
            active={activeTab()}
            onSelect={selectTab}
            compact={compact()}
            compactMaxIndex={1}
          />
          <span
            style={{
              'align-items': 'center',
              'border-radius': '7px',
              color: 'var(--c2)',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '12.5px',
              gap: '6px',
              'margin-left': 'auto',
              padding: '5px 9px',
              'white-space': 'nowrap',
            }}
          >
            All calls <ChevronGlyph size={11} />
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
                gap: '5px',
                padding: '5px 10px',
                'white-space': 'nowrap',
              }}
            >
              <IconCallRow
                aria-hidden="true"
                style={{
                  color: 'var(--c2)',
                  display: 'block',
                  flex: 'none',
                  height: '14px',
                  width: '14px',
                }}
              />{' '}
              Call
            </span>
          </Show>
        </div>

        {/* Rows */}
        <div
          style={{
            display: 'grid',
            'align-content': 'start',
            'min-height': compact() ? '0' : '262px',
          }}
        >
          <Show
            when={visibleCalls().length > 0}
            fallback={
              <div
                style={{
                  'align-items': 'center',
                  color: 'var(--c4)',
                  display: 'grid',
                  'font-family': appFont,
                  gap: '8px',
                  'justify-items': 'center',
                  'min-height': compact() ? '120px' : '262px',
                  padding: '24px',
                }}
              >
                <span style={{ color: 'var(--a0)' }}>
                  <SparkleGlyph size={22} />
                </span>
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-size': '15px',
                    'font-weight': '600',
                  }}
                >
                  All caught up
                </span>
                <span style={{ 'font-size': '13px' }}>
                  You've cleared this view.
                </span>
              </div>
            }
          >
            <For each={groupedCalls()}>
              {(item) =>
                item.kind === 'header' ? (
                  <PreviewListDivider label={item.label} compact={compact()} />
                ) : (
                  <div
                    class="calls-hero-row"
                    onClick={() => {
                      setSelected(item.nav);
                      setInteracted(true);
                    }}
                    onMouseEnter={() => setSelected(item.nav)}
                    style={{
                      'align-items': 'center',
                      'background-color':
                        item.nav === selected()
                          ? 'color-mix(in srgb, var(--c1) 4%, transparent)'
                          : 'transparent',
                      'border-radius': '8px',
                      cursor: 'pointer',
                      display: 'grid',
                      gap: compact() ? '9px' : '11px',
                      // Fixed widths for the avatar + time columns so the
                      // status badge column lands at the same x on every row.
                      'grid-template-columns': compact()
                        ? 'auto auto minmax(0, 1fr) auto'
                        : 'auto auto minmax(0, 1fr) 96px 66px 56px',
                      padding: compact() ? '10px 13px' : '11px 16px',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        'background-color': callUnread(item.call)
                          ? 'var(--a0)'
                          : 'transparent',
                        'border-radius': '999px',
                        flex: 'none',
                        height: '7px',
                        width: '7px',
                      }}
                    />
                    <IconCallRow
                      aria-hidden="true"
                      style={{
                        color: 'var(--c4)',
                        display: 'block',
                        flex: 'none',
                        height: '16px',
                        width: '16px',
                      }}
                    />
                    <span
                      style={{
                        'min-width': 0,
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                      }}
                    >
                      <span
                        style={{
                          color: 'var(--c1)',
                          'font-family': appFont,
                          'font-size': compact() ? '13px' : '14px',
                          'font-weight': callUnread(item.call) ? '700' : '500',
                        }}
                      >
                        {item.call.title}
                      </span>
                      <span
                        style={{
                          color: 'var(--c4)',
                          'font-family': appFont,
                          'font-size': compact() ? '12px' : '14px',
                        }}
                      >
                        {' '}
                        {item.call.dur}
                      </span>
                    </span>
                    <Show when={!compact()}>
                      <StatusBadge status={item.call.status} />
                    </Show>
                    <Show when={!compact()}>
                      <AvatarStack
                        people={item.call.people}
                        extra={item.call.extra}
                        size={20}
                      />
                    </Show>
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': appFont,
                        'font-size': '12px',
                        'text-align': 'right',
                        'white-space': 'nowrap',
                      }}
                    >
                      {item.call.time}
                    </span>
                  </div>
                )
              }
            </For>
          </Show>
        </div>
      </div>
    </PreviewWindow>
  );
}

// ---------------------------------------------------------------------------
// Transcript graphic — recording strip + speaker-attributed transcript
// ---------------------------------------------------------------------------

const transcriptRows = [
  {
    who: 'Evan Decker',
    initials: 'ED',
    speaker: 'Speaker #1',
    time: '2:14',
    text: "I'm taking the email bugs this week: the base64 attachment issue and the threading regression.",
  },
  {
    who: 'Teo Nys',
    initials: 'TN',
    speaker: 'Speaker #0',
    time: '2:31',
    text: "Nice. I'll keep pushing on multi-inbox and the CRM search work.",
  },
  {
    who: 'Hutch',
    initials: 'HU',
    speaker: 'Speaker #2',
    time: '2:48',
    text: "Deploys are green again after the rollback. I'll babysit the next one.",
  },
];

export function TranscriptGraphic() {
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
          width: 'min(460px, 100%)',
        }}
      >
        {/* Call header */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '8px',
            padding: '11px 14px',
          }}
        >
          <PhoneGlyph size={14} color="var(--c2)" />
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
            Engineering Standup
          </span>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '12px',
              'margin-left': 'auto',
              'white-space': 'nowrap',
            }}
          >
            7m 59s
          </span>
        </div>

        {/* Recording strip */}
        <div
          style={{
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            padding: compact() ? '12px 14px' : '14px 16px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: '7px',
              'grid-template-columns': 'repeat(4, 1fr)',
            }}
          >
            <VideoTile initials="TN" hue={70} />
            <VideoTile initials="ED" hue={150} />
            <VideoTile initials="HU" hue={250} />
            <VideoTile initials="AH" hue={30} muted />
          </div>
          <div
            style={{
              'align-items': 'center',
              display: 'flex',
              gap: '9px',
              'padding-top': '10px',
            }}
          >
            <span
              style={{
                'align-items': 'center',
                'background-color': 'var(--a0)',
                'border-radius': '999px',
                color: 'var(--b0)',
                display: 'inline-flex',
                flex: 'none',
                height: '22px',
                'justify-content': 'center',
                'padding-left': '2px',
                width: '22px',
              }}
            >
              <PlayGlyph size={12} color="var(--b0)" />
            </span>
            <span
              aria-hidden="true"
              style={{
                'background-color': 'var(--b2)',
                'border-radius': '999px',
                flex: 1,
                height: '4px',
                position: 'relative',
              }}
            >
              <span
                style={{
                  'background-color': 'var(--a0)',
                  'border-radius': '999px',
                  height: '100%',
                  left: 0,
                  position: 'absolute',
                  width: '34%',
                }}
              />
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '11px',
              }}
            >
              2:42 / 7:59
            </span>
          </div>
        </div>

        {/* Transcript */}
        <div
          style={{
            display: 'grid',
            gap: compact() ? '13px' : '15px',
            padding: compact() ? '14px' : '16px',
          }}
        >
          <div
            style={{
              'align-items': 'center',
              color: 'var(--c4)',
              display: 'flex',
              'font-family': "'rajdhani', body",
              'font-size': '11px',
              'font-weight': '700',
              gap: '7px',
              'letter-spacing': '0.08em',
              'text-transform': 'uppercase',
            }}
          >
            Transcript
          </div>
          <For each={transcriptRows}>
            {(row, i) => (
              <div
                style={{
                  'align-items': 'flex-start',
                  'background-color':
                    i() === 0
                      ? 'color-mix(in srgb, var(--a0) 7%, transparent)'
                      : 'transparent',
                  'border-radius': '8px',
                  display: 'flex',
                  gap: '10px',
                  margin: i() === 0 ? '0 -8px' : '0',
                  padding: i() === 0 ? '8px' : '0',
                }}
              >
                <Avatar initials={row.initials} size={26} color="var(--b3)" />
                <div style={{ display: 'grid', gap: '3px', 'min-width': 0 }}>
                  <div
                    style={{
                      'align-items': 'center',
                      display: 'flex',
                      gap: '8px',
                    }}
                  >
                    <span
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-size': '13px',
                        'font-weight': '600',
                      }}
                    >
                      {row.who}
                    </span>
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': appFont,
                        'font-size': '11px',
                      }}
                    >
                      {row.speaker}
                    </span>
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': appFont,
                        'font-size': '11px',
                        'margin-left': 'auto',
                      }}
                    >
                      {row.time}
                    </span>
                  </div>
                  <p
                    style={{
                      color: 'var(--c2)',
                      'font-family': appFont,
                      'font-size': compact() ? '13px' : '13.5px',
                      'line-height': 1.5,
                      margin: 0,
                    }}
                  >
                    {row.text}
                  </p>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Call stage — full-bleed live call view with an AI meeting-notes panel
// ---------------------------------------------------------------------------

// Control-bar glyphs (white, stroked) for the in-call toolbar.
function MicGlyph(props: { size?: number }) {
  const s = props.size ?? 17;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
      />
      <path
        d="M5 11a7 7 0 0 0 14 0 M12 18v3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>
  );
}

function CameraGlyph(props: { size?: number }) {
  const s = props.size ?? 17;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <rect
        x="3"
        y="6.5"
        width="13"
        height="11"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
      />
      <path
        d="M16 10.5l5-3v9l-5-3z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function ScreenShareGlyph(props: { size?: number }) {
  const s = props.size ?? 17;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <rect
        x="3"
        y="4.5"
        width="18"
        height="12.5"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
      />
      <path
        d="M9 21h6 M12 8.5v5 M12 8.5l-2.2 2.2 M12 8.5l2.2 2.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

const callKeyPoints = [
  'Email bugs this week: base64 attachments and the threading regression.',
  'Teo keeps pushing on multi-inbox and CRM search.',
];

// Hardcoded dark surface + light text so the call view always reads as a real
// product screenshot, matching the hero window regardless of site theme.
function NotesSection(props: { heading: string; items: string[] }) {
  return (
    <div style={{ display: 'grid', gap: '9px' }}>
      <span
        style={{
          color: '#f4f4f5',
          'font-family': appFont,
          'font-size': '13px',
          'font-weight': '600',
        }}
      >
        {props.heading}
      </span>
      <ul
        style={{
          display: 'grid',
          gap: '7px',
          'list-style': 'none',
          margin: 0,
          padding: 0,
        }}
      >
        <For each={props.items}>
          {(item) => (
            <li
              style={{
                color: 'rgb(255 255 255 / 0.74)',
                'font-family': appFont,
                'font-size': '13px',
                'line-height': 1.5,
              }}
            >
              {item}
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

export function CallStageGraphic() {
  const stack = () => viewportWidth() < 920;
  const ctrl = (children: JSX.Element, danger?: boolean): JSX.Element => (
    <span
      style={{
        'align-items': 'center',
        'background-color': danger
          ? 'oklch(0.6 0.2 25)'
          : 'rgb(255 255 255 / 0.16)',
        border: danger ? '0' : '1px solid rgb(255 255 255 / 0.14)',
        'border-radius': '999px',
        color: '#fff',
        display: 'inline-flex',
        flex: 'none',
        height: '36px',
        'justify-content': 'center',
        width: danger ? '50px' : '36px',
      }}
    >
      {children}
    </span>
  );
  return (
    <div style={{ 'box-sizing': 'border-box', width: '100%' }}>
      <div
        style={{
          'background-color': '#080808',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': stack() ? '14px' : '16px',
          'box-shadow':
            '0 34px 100px rgb(0 0 0 / 0.5), inset 0 1px 0 rgb(255 255 255 / 0.05)',
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': stack()
            ? 'minmax(0, 1fr)'
            : 'minmax(0, 1fr) min(40%, 380px)',
          overflow: 'hidden',
          width: '100%',
        }}
      >
        {/* Main camera feed */}
        <div
          style={{
            'aspect-ratio': stack() ? '16 / 11' : 'auto',
            'min-height': stack() ? 'auto' : '440px',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <img
            src={callMainFeedUrl}
            alt="A teammate on a Macro video call, talking to the camera from a home office"
            loading="lazy"
            decoding="async"
            style={{
              display: 'block',
              height: '100%',
              left: 0,
              'object-fit': 'cover',
              position: 'absolute',
              top: 0,
              width: '100%',
            }}
          />
          {/* top + bottom scrims keep overlays legible */}
          <div
            aria-hidden="true"
            style={{
              background:
                'linear-gradient(to bottom, rgb(0 0 0 / 0.5), transparent)',
              height: '96px',
              left: 0,
              position: 'absolute',
              right: 0,
              top: 0,
            }}
          />
          <div
            aria-hidden="true"
            style={{
              background:
                'linear-gradient(to top, rgb(0 0 0 / 0.62), transparent)',
              bottom: 0,
              height: '136px',
              left: 0,
              position: 'absolute',
              right: 0,
            }}
          />

          {/* Recording indicator */}
          <div
            style={{
              'align-items': 'center',
              'background-color': 'rgb(0 0 0 / 0.42)',
              'backdrop-filter': 'blur(6px)',
              'border-radius': '999px',
              display: 'inline-flex',
              gap: '7px',
              left: '16px',
              padding: '6px 11px 6px 9px',
              position: 'absolute',
              top: '16px',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                'background-color': 'oklch(0.65 0.2 25)',
                'border-radius': '999px',
                flex: 'none',
                height: '8px',
                width: '8px',
              }}
            />
            <span
              style={{
                color: '#fff',
                'font-family': "'rajdhani', body",
                'font-size': '11px',
                'font-weight': '700',
                'letter-spacing': '0.08em',
              }}
            >
              REC · 7:59
            </span>
          </div>

          {/* Picture-in-picture self view */}
          <div
            style={{
              'aspect-ratio': '16 / 10',
              border: '1px solid rgb(255 255 255 / 0.28)',
              'border-radius': '11px',
              'box-shadow': '0 10px 28px rgb(0 0 0 / 0.45)',
              overflow: 'hidden',
              position: 'absolute',
              right: '16px',
              top: '16px',
              width: stack() ? '34%' : '30%',
              'max-width': '184px',
            }}
          >
            <img
              src={callPipFeedUrl}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              style={{
                display: 'block',
                height: '100%',
                'object-fit': 'cover',
                width: '100%',
              }}
            />
            <span
              style={{
                'background-color': 'rgb(0 0 0 / 0.5)',
                'border-radius': '5px',
                bottom: '6px',
                color: '#fff',
                'font-family': appFont,
                'font-size': '10px',
                'font-weight': '600',
                left: '6px',
                padding: '2px 6px',
                position: 'absolute',
              }}
            >
              You
            </span>
          </div>

          {/* Speaker name */}
          <div
            style={{
              'align-items': 'center',
              bottom: '17px',
              color: '#fff',
              display: 'flex',
              gap: '7px',
              left: '18px',
              position: 'absolute',
            }}
          >
            <span style={{ color: '#fff', display: 'inline-flex' }}>
              <MicGlyph size={14} />
            </span>
            <span
              style={{
                'font-family': appFont,
                'font-size': '13.5px',
                'font-weight': '600',
                'text-shadow': '0 1px 4px rgb(0 0 0 / 0.5)',
              }}
            >
              Evan Decker
            </span>
          </div>

          {/* Call controls */}
          <div
            style={{
              bottom: '14px',
              display: 'flex',
              gap: '8px',
              left: '50%',
              position: 'absolute',
              transform: 'translateX(-50%)',
            }}
          >
            {ctrl(<MicGlyph />)}
            {ctrl(<CameraGlyph />)}
            {ctrl(<ScreenShareGlyph />)}
            {ctrl(
              <span
                style={{ display: 'inline-flex', transform: 'rotate(135deg)' }}
              >
                <PhoneGlyph size={17} color="#fff" />
              </span>,
              true
            )}
          </div>
        </div>

        {/* AI meeting-notes panel */}
        <aside
          style={{
            'align-content': 'start',
            'background-color': '#0a0a0a',
            'border-left': stack() ? '0' : '1px solid rgb(255 255 255 / 0.07)',
            'border-top': stack() ? '1px solid rgb(255 255 255 / 0.07)' : '0',
            'box-sizing': 'border-box',
            display: 'grid',
            gap: '18px',
            padding: stack() ? '22px 20px 26px' : '26px',
          }}
        >
          <div style={{ display: 'grid', gap: '6px' }}>
            <span
              style={{
                color: '#f6f6f7',
                'font-family': appFont,
                'font-size': '18px',
                'font-weight': '600',
                'line-height': 1.25,
              }}
            >
              Engineering Standup
            </span>
            <span
              style={{
                color: 'rgb(255 255 255 / 0.5)',
                'font-family': appFont,
                'font-size': '12px',
              }}
            >
              Jun 9, 2026 · 7m 59s
            </span>
          </div>

          <p
            style={{
              color: 'rgb(255 255 255 / 0.78)',
              'font-family': appFont,
              'font-size': '13.5px',
              'line-height': 1.6,
              margin: 0,
            }}
          >
            The team aligned on this week&rsquo;s priorities. Evan is taking the
            email bugs, Teo keeps pushing on multi-inbox and CRM search, and
            deploys are green again after the rollback.
          </p>

          <NotesSection heading="Key Points" items={callKeyPoints} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI summary graphic — the call summary + details panel
// ---------------------------------------------------------------------------

export function SummaryGraphic() {
  const compact = () => mobile();
  const detail = (label: string, value: JSX.Element) => (
    <div
      style={{
        'align-items': 'center',
        display: 'flex',
        gap: '10px',
        'justify-content': 'space-between',
      }}
    >
      <span
        style={{
          color: 'var(--c4)',
          'font-family': appFont,
          'font-size': '12.5px',
        }}
      >
        {label}
      </span>
      <span
        style={{
          'align-items': 'center',
          color: 'var(--c1)',
          display: 'inline-flex',
          'font-family': appFont,
          'font-size': '12.5px',
          gap: '6px',
        }}
      >
        {value}
      </span>
    </div>
  );
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
          width: 'min(480px, 100%)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: '16px',
            padding: compact() ? '18px' : '22px',
          }}
        >
          {/* Title + meta */}
          <div style={{ display: 'grid', gap: '6px' }}>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': compact() ? '16px' : '18px',
                'font-weight': '600',
                'line-height': 1.25,
              }}
            >
              Settings UI Overhaul: Sidebar Layout &amp; Redesign
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '12px',
              }}
            >
              Jun 10, 2026 · 10:53 AM · 9m 37s
            </span>
          </div>

          {/* Participants */}
          <div
            style={{
              'align-items': 'center',
              display: 'flex',
              'flex-wrap': 'wrap',
              gap: '8px',
            }}
          >
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '12px',
                'margin-right': '2px',
              }}
            >
              Participants
            </span>
            <For
              each={[
                { n: 'teo@macro.com', i: 'TN' },
                { n: 'aidan@macro.com', i: 'AH' },
              ]}
            >
              {(p) => (
                <span
                  style={{
                    'align-items': 'center',
                    'background-color': 'var(--b0)',
                    border:
                      '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                    'border-radius': '999px',
                    display: 'inline-flex',
                    'font-family': appFont,
                    'font-size': '12px',
                    gap: '6px',
                    padding: '3px 10px 3px 3px',
                  }}
                >
                  <Avatar initials={p.i} size={18} color="var(--b3)" />
                  <span style={{ color: 'var(--c2)' }}>{p.n}</span>
                </span>
              )}
            </For>
          </div>

          {/* AI summary */}
          <div style={{ display: 'grid', gap: '9px' }}>
            <span
              style={{
                'align-items': 'center',
                color: 'var(--a0)',
                display: 'inline-flex',
                'font-family': "'rajdhani', body",
                'font-size': '11px',
                'font-weight': '700',
                gap: '6px',
                'letter-spacing': '0.08em',
                'text-transform': 'uppercase',
              }}
            >
              <SparkleGlyph size={12} /> AI Summary
            </span>
            <p
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': compact() ? '13px' : '13.5px',
                'line-height': 1.55,
                margin: 0,
              }}
            >
              Aidan, Teo, and Seamus agreed to overhaul the settings UI. They
              want a sidebar layout like Linear or VS Code, with a modal default
              and an option to open as a split panel.
            </p>
            <p
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': compact() ? '13px' : '13.5px',
                'line-height': 1.55,
                margin: 0,
              }}
            >
              The first pass leaves settings logic untouched and renders the
              existing pane behind the new sidebar.{' '}
              <span style={{ color: 'var(--c1)' }}>Aidan owns it.</span>
            </p>
          </div>

          {/* Details panel */}
          <div
            style={{
              'background-color': 'var(--b0)',
              border:
                '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
              'border-radius': '10px',
              display: 'grid',
              gap: '9px',
              padding: '12px 14px',
            }}
          >
            {detail(
              'Owner',
              <>
                <Avatar initials="TN" size={16} color="var(--b3)" /> Teo Nys
              </>
            )}
            {detail(
              'Duration',
              <>
                <ClockGlyph size={12} color="var(--c4)" /> 9m 37s
              </>
            )}
            {detail(
              'Status',
              <span style={{ color: 'var(--c2)' }}>Ended</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent-context graphic — agent assigns a bug using a past call transcript,
// shown inside a phone (mirrors the Agents hero)
// ---------------------------------------------------------------------------

// Inline @Macro mention — matches the agent-mention style used across the app
// (amber spark + amber label, no avatar chrome) rather than a faux avatar chip.
function MacroMention() {
  return (
    <span
      style={{
        color: 'var(--a0)',
        'font-family': appFont,
        'font-weight': '600',
        'white-space': 'nowrap',
      }}
    >
      <span
        style={{
          color: 'var(--a0)',
          display: 'inline-flex',
          'margin-right': '3px',
          'vertical-align': 'middle',
        }}
      >
        <SparkleGlyph size={13} />
      </span>
      Macro
    </span>
  );
}

const agentReasoningSteps: { label: string; icon: JSX.Element }[] = [
  {
    label: 'Searching shared calls',
    icon: <SearchTinyGlyph size={11} color="currentColor" />,
  },
  { label: 'Read Engineering Standup', icon: <CheckTinyGlyph size={11} /> },
  { label: 'Matched owner — Evan Decker', icon: <CheckTinyGlyph size={11} /> },
  { label: 'Thought for 9 seconds', icon: <SparkleGlyph size={11} /> },
];

export function AgentContextGraphic() {
  const compact = () => mobile();
  // The chat fills roughly the top three quarters of the phone; fade the frame
  // out below the last card so the empty screen doesn't read as dead glass
  // (Linear-style device crop). The drop-shadow lives on the caller's wrapper,
  // so it follows this mask's alpha.
  return (
    <div
      style={{
        '-webkit-mask-image':
          'linear-gradient(to bottom, #000 0%, #000 68%, transparent 96%)',
        'mask-image':
          'linear-gradient(to bottom, #000 0%, #000 68%, transparent 96%)',
      }}
    >
      <PhoneFrame>
        <PhoneScreenContent>
          {/* user prompt bubble */}
          <div
            style={{
              'background-color': '#0a0a0a',
              border:
                '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
              'border-radius': '14px 14px 4px 14px',
              'box-sizing': 'border-box',
              'justify-self': 'end',
              'margin-bottom': '22px',
              'max-width': '86%',
              padding: '11px 14px',
              position: 'relative',
            }}
          >
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': compact() ? '13.5px' : '14px',
                'line-height': 1.5,
              }}
            >
              <MacroMention /> there's a base64 bug in the email client. Assign
              it to whoever's on email this week.
            </span>
            <span
              aria-hidden="true"
              style={{
                'background-color': '#0a0a0a',
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

          {/* agent turn: reasoning trace + result + evidence */}
          <div
            style={{
              display: 'grid',
              gap: '14px',
              'grid-template-columns': 'minmax(0, 1fr)',
              'min-width': 0,
            }}
          >
            {/* reasoning trace */}
            <div
              style={{
                display: 'grid',
                'grid-template-columns': '18px 1fr',
                'column-gap': '10px',
              }}
            >
              <For each={agentReasoningSteps}>
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
                            i() === agentReasoningSteps.length - 1
                              ? 'color-mix(in srgb, var(--a0) 18%, transparent)'
                              : 'color-mix(in srgb, var(--c1) 8%, transparent)',
                          'border-radius': '999px',
                          color:
                            i() === agentReasoningSteps.length - 1
                              ? 'var(--a0)'
                              : 'var(--c2)',
                          display: 'inline-flex',
                          flex: 'none',
                          height: '18px',
                          'justify-content': 'center',
                          width: '18px',
                        }}
                      >
                        {step.icon}
                      </span>
                      <Show when={i() < agentReasoningSteps.length - 1}>
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
                      style={{
                        'align-self': 'center',
                        color:
                          i() === agentReasoningSteps.length - 1
                            ? 'var(--c2)'
                            : 'var(--c4)',
                        'font-family': appFont,
                        'font-size': '12.5px',
                        'line-height': 1.4,
                        'padding-bottom':
                          i() < agentReasoningSteps.length - 1 ? '16px' : '0',
                      }}
                    >
                      {step.label}
                    </span>
                  </>
                )}
              </For>
            </div>

            {/* result */}
            <p
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': compact() ? '13px' : '14px',
                'line-height': 1.6,
                margin: 0,
              }}
            >
              Assigned it to{' '}
              <span style={{ color: 'var(--c1)', 'font-weight': '600' }}>
                Evan
              </span>
              . In the{' '}
              <span style={{ color: 'var(--c1)' }}>Engineering Standup</span> on
              Jun 9 he said he's taking the email bugs this week.
            </p>

            {/* citation chip */}
            <div
              style={{
                'align-items': 'center',
                'background-color': 'var(--b0)',
                border:
                  '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                'border-radius': '8px',
                display: 'flex',
                gap: '9px',
                'min-width': 0,
                padding: '8px 11px',
              }}
            >
              <span
                style={{
                  'align-items': 'center',
                  color: 'var(--a3)',
                  display: 'inline-flex',
                }}
              >
                <PhoneGlyph size={14} color="var(--a3)" />
              </span>
              <span
                style={{
                  color: 'var(--c2)',
                  'font-family': appFont,
                  'font-size': '12.5px',
                  'min-width': 0,
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                }}
              >
                "…I'm taking the email bugs this week."{' '}
                <span style={{ color: 'var(--c4)' }}>— Evan</span>
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '11.5px',
                  'margin-left': 'auto',
                  'white-space': 'nowrap',
                }}
              >
                2:14
              </span>
            </div>

            {/* embedded task result */}
            <div
              style={{
                'align-items': 'center',
                'background-color':
                  'color-mix(in srgb, var(--a2) 8%, var(--b0))',
                border:
                  '1px solid color-mix(in srgb, var(--a2) 32%, transparent)',
                'border-radius': '8px',
                display: 'flex',
                gap: '10px',
                'min-width': 0,
                padding: '10px 12px',
              }}
            >
              <TaskListGlyph size={15} />
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '13px',
                  'font-weight': '500',
                  'min-width': 0,
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                }}
              >
                BUG-241 · base64 attachments not rendering
              </span>
              <span
                style={{
                  'align-items': 'center',
                  'background-color': 'var(--b0)',
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '999px',
                  display: 'inline-flex',
                  flex: 'none',
                  'font-family': appFont,
                  'font-size': '11.5px',
                  gap: '5px',
                  'margin-left': 'auto',
                  padding: '2px 9px 2px 3px',
                }}
              >
                <Avatar initials="ED" size={16} color="var(--b3)" /> Evan
              </span>
            </div>
          </div>
        </PhoneScreenContent>
      </PhoneFrame>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sharing / privacy graphic — share-with-team toggle, on and off
// ---------------------------------------------------------------------------

export function SharingGraphic() {
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
      {/* Shared state */}
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-sm)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(420px, 100%)',
        }}
      >
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '8px',
            padding: '11px 14px',
          }}
        >
          <ChevronGlyph size={12} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13px',
              'font-weight': '600',
            }}
          >
            Sharing
          </span>
        </div>
        <div style={{ display: 'grid', gap: '12px', padding: '14px' }}>
          <div
            style={{ 'align-items': 'center', display: 'flex', gap: '11px' }}
          >
            <span
              style={{
                'align-items': 'center',
                'background-color': 'var(--a0)',
                'border-radius': '6px',
                color: 'var(--b0)',
                display: 'inline-flex',
                flex: 'none',
                height: '22px',
                'justify-content': 'center',
                width: '22px',
              }}
            >
              <CheckTinyGlyph size={13} color="var(--b0)" />
            </span>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '14px',
                'font-weight': '600',
              }}
            >
              Share with team
            </span>
            <span style={{ display: 'inline-flex', 'margin-left': 'auto' }}>
              <AvatarStack people={['JB', 'TN', 'HU', 'ED']} size={22} />
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
            Lets everyone on your team view and search this call's transcript
            and AI summary, and gives your agents its context.
          </p>
        </div>
      </div>

      {/* connector */}
      <div
        aria-hidden="true"
        style={{
          'align-items': 'center',
          color: 'var(--c4)',
          display: 'flex',
          'font-family': "'rajdhani', body",
          'font-size': '10px',
          'font-weight': '700',
          gap: '8px',
          'letter-spacing': '0.1em',
          'text-transform': 'uppercase',
        }}
      >
        <span
          style={{ background: 'var(--b3)', height: '1px', width: '24px' }}
        />{' '}
        uncheck{' '}
        <span
          style={{ background: 'var(--b3)', height: '1px', width: '24px' }}
        />
      </div>

      {/* Private state */}
      <div
        style={{
          'background-color': '#080808',
          border: '1px dashed color-mix(in srgb, var(--c4) 28%, transparent)',
          'border-radius': '12px',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(420px, 100%)',
        }}
      >
        <div style={{ display: 'grid', gap: '10px', padding: '14px' }}>
          <div
            style={{ 'align-items': 'center', display: 'flex', gap: '11px' }}
          >
            <span
              style={{
                'align-items': 'center',
                border: '1.5px solid var(--c4)',
                'border-radius': '6px',
                display: 'inline-flex',
                flex: 'none',
                height: '22px',
                'justify-content': 'center',
                width: '22px',
              }}
            />
            <span
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': '14px',
                'font-weight': '600',
              }}
            >
              Private to you
            </span>
            <span
              style={{
                'align-items': 'center',
                color: 'var(--c4)',
                display: 'inline-flex',
                'margin-left': 'auto',
              }}
            >
              <LockGlyph size={15} color="var(--c4)" />
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
            Kept in your personal memory only, out of team view and removed from
            your agents' context.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search graphic — Ask AI across every call, answered with citations
// ---------------------------------------------------------------------------

const searchCitations = [
  { title: 'Settings UI Overhaul', time: '1:12', who: 'Aidan' },
  { title: 'Teo & Aidan Sprint Update', time: '4:38', who: 'Teo' },
];

export function SearchGraphic() {
  const compact = () => true; // always renders inside a fixed-width column
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '12px',
        width: '100%',
        'max-width': '560px',
      }}
    >
      {/* prompt */}
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
          'border-radius': '14px 14px 4px 14px',
          'box-sizing': 'border-box',
          'justify-self': 'end',
          'max-width': '85%',
          padding: '11px 14px',
        }}
      >
        <span
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': compact() ? '13.5px' : '14.5px',
            'line-height': 1.5,
          }}
        >
          What did we decide about the settings redesign?
        </span>
      </div>

      {/* answer */}
      <div style={{ display: 'grid', gap: '10px' }}>
        <p
          style={{
            color: 'var(--c2)',
            'font-family': appFont,
            'font-size': compact() ? '13px' : '14px',
            'line-height': 1.6,
            margin: 0,
          }}
        >
          You're moving settings to a left-sidebar layout (like Linear / VS
          Code), with a modal as the default and a split-panel option. The first
          pass keeps existing settings logic untouched.{' '}
          <span style={{ color: 'var(--c1)' }}>Aidan owns it</span>.
        </p>
        <div style={{ display: 'grid', gap: '7px' }}>
          <For each={searchCitations}>
            {(c) => (
              <div
                style={{
                  'align-items': 'center',
                  'background-color': '#0a0a0a',
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '8px',
                  display: 'flex',
                  gap: '9px',
                  padding: '8px 11px',
                }}
              >
                <span
                  style={{
                    'align-items': 'center',
                    color: 'var(--c4)',
                    display: 'inline-flex',
                  }}
                >
                  <PhoneGlyph size={14} color="var(--c4)" />
                </span>
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': '12.5px',
                    'font-weight': '500',
                    'min-width': 0,
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'white-space': 'nowrap',
                  }}
                >
                  {c.title}
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '11.5px',
                  }}
                >
                  · {c.who}
                </span>
                <span
                  style={{
                    'align-items': 'center',
                    color: 'var(--a0)',
                    display: 'inline-flex',
                    'font-family': appFont,
                    'font-size': '11.5px',
                    gap: '4px',
                    'margin-left': 'auto',
                    'white-space': 'nowrap',
                  }}
                >
                  {c.time} <ChevronRightGlyph size={11} color="var(--a0)" />
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
// Comparison table (Macro vs Zoom vs Google Meet vs Granola)
// ---------------------------------------------------------------------------

type Cell = boolean | 'partial' | string;

const comparisonColumns = ['Macro', 'Zoom', 'Meet', 'Granola'];

const comparisonRows: { feature: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  { feature: 'Host & join video calls', cells: [true, true, true, false] },
  {
    feature: 'Auto transcript with speaker labels',
    cells: [true, 'partial', 'partial', true],
  },
  {
    feature: 'AI summary after every call',
    cells: [true, 'partial', 'partial', true],
  },
  {
    feature: 'Searchable transcript archive',
    cells: [true, 'partial', false, true],
  },
  {
    feature: 'Calls auto-saved to team memory',
    cells: [true, false, false, 'partial'],
  },
  {
    feature: 'Agents with full call + workspace context',
    cells: [true, false, false, false],
  },
  {
    feature: 'Per-call privacy / opt-out of sharing',
    cells: [true, 'partial', 'partial', 'partial'],
  },
  {
    feature: 'Lives with your email, docs, tasks & chat',
    cells: [true, false, 'partial', false],
  },
  {
    feature: 'Ask AI across all your calls',
    cells: [true, false, false, 'partial'],
  },
  { feature: 'Open source (AGPLv3)', cells: [true, false, false, false] },
  { feature: 'Price / seat / month', cells: ['$40', '$16', '$7', '$18'] },
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
    q: 'What happens after a call ends?',
    a: (
      <>
        Macro auto-transcribes the call and generates an AI summary. The
        recording and a readable, speaker-attributed transcript are always
        available at the bottom of the call, and everything becomes searchable
        from the calls tab.
      </>
    ),
  },
  {
    q: 'Are all of my calls shared with my team?',
    a: (
      <>
        Every call a member of your team has is added to the calls tab, whether
        or not you attended it. The default is to share each call to team
        memory, but you can opt out per call. When you opt out, the call is
        added to your personal memory but not the team's.
      </>
    ),
  },
  {
    q: 'Can I keep a call private?',
    a: (
      <>
        Yes. Uncheck <strong>Share with team</strong> (in the bottom-left of an
        active call, or in the Sharing panel afterward) to keep a call in your
        personal memory only, out of team view, and removed from your agents'
        context.
      </>
    ),
  },
  {
    q: 'Can agents use my call transcripts?',
    a: (
      <>
        Yes. Calls integrate with Macro's permission system, so agents can read
        the transcripts you've shared. That richer context lets them help more
        effectively: ask an agent to assign a bug and it can route it to whoever
        said they were on it in yesterday's standup.
      </>
    ),
  },
  {
    q: 'Do I need to attend a call for it to be recorded?',
    a: (
      <>
        No. Calls you miss still land in the calls tab with their recording,
        transcript, and AI summary, so you can catch up in seconds instead of
        asking what you missed.
      </>
    ),
  },
  {
    q: 'How do I start a call?',
    a: (
      <>
        Use the <strong>Call</strong> button at the top of the calls tab, or
        open a channel with the people you want and press the call button.
        Participants hear a ring when a call starts.
      </>
    ),
  },
  {
    q: 'Is Macro open source?',
    a: (
      <>
        Yes. Macro is fully open source under the AGPLv3 (as of May 31 2026),
        not "open core." Video is powered by LiveKit. To build on Macro under a
        different license, contact{' '}
        <a href="mailto:licensing@macro.com">licensing@macro.com</a>.
      </>
    ),
  },
];

function _FaqSection(props: { area?: string }) {
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
        .calls-faq__item { border-bottom: 1px solid color-mix(in srgb, var(--c4) 10%, transparent); }
        .calls-faq__item > summary {
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
        .calls-faq__item > summary::-webkit-details-marker { display: none; }
        .calls-faq__item > summary .calls-faq__chevron { color: var(--c4); flex-shrink: 0; transition: transform 220ms ease; }
        .calls-faq__item[open] > summary .calls-faq__chevron { transform: rotate(180deg); }
        .calls-faq__answer { color: var(--c4); font-size: 16px; line-height: 1.6; margin: 0; padding: 0 4px 24px; max-width: 760px; }
        .calls-faq__answer a { color: var(--a0); text-decoration: none; }
        @media (hover) {
          .calls-faq__item > summary:hover { color: var(--a0); }
          .calls-faq__answer a:hover { text-decoration: underline; }
        }
        @media (max-width: 700px) {
          .calls-faq__item > summary { font-size: 17px; padding: 18px 4px; }
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
            <details class="calls-faq__item">
              <summary>
                <span>{item.q}</span>
                <svg
                  class="calls-faq__chevron"
                  width="16"
                  height="16"
                  viewBox="0 0 256 256"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
                </svg>
              </summary>
              <p class="calls-faq__answer">{item.a}</p>
            </details>
          )}
        </For>
      </div>
    </section>
  );
}
