import {
  type Component,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import IconAi from '../../assets/icons/icon-ai.svg';
import IconCall from '../../assets/icons/icon-call.svg';
import IconChannels from '../../assets/icons/icon-channels.svg';
import IconCompany from '../../assets/icons/icon-company.svg';
import IconEmail from '../../assets/icons/icon-email.svg';
import IconFolder from '../../assets/icons/icon-folder.svg';
import IconGithub from '../../assets/icons/icon-github.svg';
import IconHome from '../../assets/icons/icon-home.svg';
import IconInbox from '../../assets/icons/icon-inbox.svg';
import IconPlus from '../../assets/icons/icon-plus.svg';
import IconSearch from '../../assets/icons/icon-search.svg';
import IconTasks from '../../assets/icons/icon-tasks.svg';
import avatarGabriel from '../../assets/people/gabriel.webp';
import avatarJulia from '../../assets/people/julia.webp';
import { GithubFeatureGrid } from '../components/sections/GithubFeatureGrid';
import { GithubUiGrid } from '../components/sections/GithubUiGrid';
import { HeroEyebrow } from '../components/sections/HeroEyebrow';
import { HomeHeroBackdrop } from '../components/sections/HomeAppPreview';
import { HomeSectionRule } from '../components/sections/HomeSectionRule';
import {
  type LoopsFeatureBlock,
  LoopsFeatureSection,
  loopsFeatureHoverStyles,
} from '../components/sections/LoopsFeatureSection';
import {
  APP_PREVIEW_HEIGHT,
  type AppSection,
  SceneAppPreview,
} from '../components/sections/SceneAppPreview';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { breakpoint, viewportWidth } from '../utils/utilBreakpoint';
import { CtaIcon, ctaHref, ctaLabel, handleCtaClick } from '../utils/utilCta';
import { setPageSeo } from '../utils/utilSeo';

const MACRO_REPO_URL = 'https://github.com/macro-inc/macro';

// ---------------------------------------------------------------------------
// Shared style fragments (matching the homepage / email / crm bento language)
// ---------------------------------------------------------------------------

const mobile = () => viewportWidth() < 700;

// Faux-app chrome uses a neutral UI sans so the mocks read as real product
// screenshots rather than marketing copy.
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const monoFont =
  "'SF Mono', 'JetBrains Mono', 'Roboto Mono', ui-monospace, Menlo, Consolas, monospace";

// Status / diff accents mirror a real Git client: green = open / approved /
// passing / additions, red = deletions, purple = merged. Orange stays a small
// brand accent (the PR glyph), not the color of every badge. The theme has no
// red token, so deletions use a fixed, theme-neutral red that reads on every
// background.
const PR_ORANGE = 'var(--a0)';
const PR_GREEN = 'var(--a2)';
const PR_PURPLE = 'var(--a4)';
const DIFF_RED = 'oklch(0.72 0.17 22)';
const DOC_BLUE = 'var(--a4)';
const TASK_ORANGE = 'var(--a0)';

function eyebrowStyle(): JSX.CSSProperties {
  return {
    color: 'var(--a0)',
    'font-family': 'rajdhani, body',
    'font-size': breakpoint() ? '12px' : '16px',
    'letter-spacing': '0.08em',
    'text-transform': 'uppercase',
  };
}

function ConnectGoogleButton(props: { buttonName: string; large?: boolean }) {
  return (
    <a
      href={ctaHref()}
      class="gh-cta-button"
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
function GithubStarButton() {
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
      class="gh-cta-button"
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
  companies: IconCompany,
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
        'font-weight': '500',
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

// Octicon git-pull-request — the exact mark the app uses for PRs.
function PrGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 15;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        fill={props.color ?? 'currentColor'}
        d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"
      />
    </svg>
  );
}

// Octicon git-merge.
function MergeGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 15;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        fill={props.color ?? 'currentColor'}
        d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"
      />
    </svg>
  );
}

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

function CheckCircleGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 15;
  const c = props.color ?? PR_GREEN;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke={c} stroke-width="1.8" />
      <path
        d="M8 12.3l2.6 2.6 5-5.4"
        fill="none"
        stroke={c}
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
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

function TaskListGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 16;
  const c = props.color ?? TASK_ORANGE;
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

function CommentGlyph(props: { size?: number; color?: string }) {
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
        d="M4 5h16v11H9l-4 3.5V16H4z"
        fill="none"
        stroke={props.color ?? 'var(--c4)'}
        stroke-width="1.7"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// Inline +adds / −dels stat (e.g. "+128 −34").
function DiffStat(props: {
  add: number;
  del: number;
  size?: number;
  weight?: string;
}) {
  const fs = props.size ?? 13;
  return (
    <span
      style={{
        'align-items': 'center',
        display: 'inline-flex',
        'font-family': 'rajdhani, body',
        'font-size': `${fs}px`,
        'font-weight': props.weight ?? '700',
        gap: '6px',
        'letter-spacing': '0.02em',
        'white-space': 'nowrap',
      }}
    >
      <span style={{ color: PR_GREEN }}>+{props.add}</span>
      <span style={{ color: DIFF_RED }}>−{props.del}</span>
    </span>
  );
}

// The "Open" status pill used on PR records.
function StatusPill(props: { state?: 'open' | 'merged' }) {
  const merged = props.state === 'merged';
  const color = merged ? PR_PURPLE : PR_GREEN;
  return (
    <span
      style={{
        'align-items': 'center',
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
        'border-radius': '999px',
        color: color,
        display: 'inline-flex',
        'font-family': appFont,
        'font-size': '12px',
        'font-weight': '600',
        gap: '6px',
        padding: '3px 10px 3px 8px',
      }}
    >
      <Show when={merged} fallback={<PrGlyph size={12} color={color} />}>
        <MergeGlyph size={12} color={color} />
      </Show>
      {merged ? 'Merged' : 'Open'}
    </span>
  );
}

// Gray repo/ref pill (e.g. "macro-inc/macro#4109").
function RefPill(props: { label: string }) {
  return (
    <span
      style={{
        'align-items': 'center',
        border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
        'border-radius': '999px',
        color: 'var(--c2)',
        display: 'inline-flex',
        'font-family': appFont,
        'font-size': '12px',
        padding: '3px 11px',
      }}
    >
      {props.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline @mention pills
// ---------------------------------------------------------------------------

type MentionKind = 'pr' | 'person' | 'doc' | 'task' | 'channel';

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
  image?: string;
}) {
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
      <Show when={props.kind === 'person'}>
        <span style={mentionIconWrap}>
          <Avatar
            initials={props.initials ?? ''}
            size={16}
            color="var(--b3)"
            image={props.image}
          />
        </span>
      </Show>
      <Show when={props.kind === 'pr'}>
        <span style={mentionIconWrap}>
          <PrGlyph size={13} color={PR_ORANGE} />
        </span>
      </Show>
      <Show when={props.kind === 'doc'}>
        <span style={mentionIconWrap}>
          <DocFileGlyph size={13} />
        </span>
      </Show>
      <Show when={props.kind === 'task'}>
        <span style={mentionIconWrap}>
          <TaskListGlyph size={13} />
        </span>
      </Show>
      <Show when={props.kind === 'channel'}>
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

const heroChecks: { label: string; time: string }[] = [
  { label: 'Build', time: '1m 17s' },
  { label: 'Typecheck', time: '1m 11s' },
  { label: 'Test', time: '1m 27s' },
];

// ---------------------------------------------------------------------------
// Hero: realistic PR-record window (PR detail + details/checks rail)
// ---------------------------------------------------------------------------

function HeroPrWindow(props: { fill?: boolean }) {
  const compact = () => mobile();
  const showRail = () => !breakpoint(); // details/checks rail only on full desktop
  const cols = () => {
    if (compact()) return '1fr';
    if (showRail()) return 'minmax(0, 1fr) 252px';
    return 'minmax(0, 1fr)';
  };
  // In `fill` mode the window is nested inside the shared app-shell panel
  // (SceneAppPreview), so it drops its own bottom fade + heavy float shadow and
  // stretches to fill the panel height like every other section window.
  const fillH = () =>
    compact()
      ? APP_PREVIEW_HEIGHT.mobile - 10
      : APP_PREVIEW_HEIGHT.desktop - 20;

  return (
    <div
      class="gh-hero-window"
      style={{
        'background-color': '#080808',
        border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
        'border-radius': props.fill ? '7px' : '12px',
        'box-shadow': props.fill
          ? '0 16px 48px -26px rgb(0 0 0 / 0.5)'
          : '0 28px 90px rgb(0 0 0 / 0.4), inset 0 1px 0 color-mix(in srgb, var(--c1) 8%, transparent)',
        'box-sizing': 'border-box',
        ...(props.fill
          ? { height: `${fillH()}px` }
          : {
              '-webkit-mask-image':
                'linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 68%, rgb(0 0 0 / 0.18) 100%)',
              'mask-image':
                'linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 68%, rgb(0 0 0 / 0.18) 100%)',
            }),
        overflow: 'hidden',
        padding: '7px',
        width: '100%',
      }}
    >
      <div
        style={{
          'background-color': '#080808',
          border: '1px solid color-mix(in srgb, var(--c4) 12%, transparent)',
          'border-radius': props.fill ? '5px' : '8px',
          display: 'grid',
          'grid-template-columns': cols(),
          ...(props.fill ? { height: '100%' } : {}),
          overflow: 'hidden',
          'text-align': 'left',
        }}
      >
        {/* PR detail pane */}
        <div
          style={{
            'border-right':
              showRail() && !compact()
                ? '1px solid color-mix(in srgb, var(--c4) 10%, transparent)'
                : '0',
            display: 'grid',
            'align-content': 'start',
            'min-width': 0,
          }}
        >
          {/* Top breadcrumb bar */}
          <div
            style={{
              'align-items': 'center',
              'border-bottom':
                '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
              display: 'flex',
              gap: '10px',
              padding: compact() ? '10px 16px' : '11px 20px',
            }}
          >
            <span
              style={{ color: 'var(--c4)', display: 'inline-flex', gap: '4px' }}
            >
              <ChevronGlyph size={15} color="var(--c4)" />
            </span>
            <span style={{ color: PR_ORANGE, display: 'inline-flex' }}>
              <PrGlyph size={14} color={PR_ORANGE} />
            </span>
            <span
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': '12.5px',
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
              }}
            >
              fix(auth): stop double session init on login
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gap: compact() ? '18px' : '20px',
              padding: compact() ? '20px 16px 0' : '24px 28px 0',
            }}
          >
            {/* Title + chips */}
            <div style={{ display: 'grid', gap: '12px' }}>
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': compact() ? '19px' : '22px',
                  'font-weight': '700',
                  'letter-spacing': '-0.01em',
                  'line-height': 1.2,
                }}
              >
                fix(auth): stop double session init on login
              </span>
              <div
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  'flex-wrap': 'wrap',
                  gap: '8px',
                }}
              >
                <StatusPill state="open" />
                <RefPill label="macro-inc/macro#4109" />
                {/* Diff chip only when the details rail (which shows Changes) is hidden. */}
                <Show when={!showRail() || compact()}>
                  <span
                    style={{
                      'align-items': 'center',
                      border:
                        '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                      'border-radius': '999px',
                      display: 'inline-flex',
                      padding: '3px 11px',
                    }}
                  >
                    <DiffStat add={6} del={20} size={12} />
                  </span>
                </Show>
              </div>
            </div>

            {/* Body */}
            <p
              style={{
                color: 'var(--c2)',
                'font-family': appFont,
                'font-size': compact() ? '13px' : '13.5px',
                'line-height': 1.6,
                margin: 0,
              }}
            >
              Login fired <CodeSpan>initSession()</CodeSpan> from both{' '}
              <CodeSpan>createEffect</CodeSpan> and <CodeSpan>onMount</CodeSpan>
              , so every login double-POSTed <CodeSpan>/auth</CodeSpan>.{' '}
              <span style={{ color: 'var(--c4)' }}>Show more</span>
            </p>

            {/* Discussion */}
            <div style={{ display: 'grid', gap: '12px' }}>
              <div
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  gap: '10px',
                }}
              >
                <span
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
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    'background-color': 'var(--b2)',
                    flex: 1,
                    height: '1px',
                  }}
                />
              </div>

              {/* Comment: reviewer */}
              <div
                style={{
                  'align-items': 'flex-start',
                  display: 'flex',
                  gap: '10px',
                }}
              >
                <Avatar
                  initials="JW"
                  size={26}
                  color="var(--b3)"
                  image={avatarJulia}
                />
                <div
                  style={{
                    display: 'grid',
                    gap: '3px',
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
                    <span
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-size': '13px',
                        'font-weight': '500',
                      }}
                    >
                      Julia Westphal
                    </span>
                    <span
                      style={{
                        'align-items': 'center',
                        'background-color':
                          'color-mix(in srgb, var(--c4) 12%, transparent)',
                        'border-radius': '5px',
                        color: 'var(--c2)',
                        display: 'inline-flex',
                        'font-family': 'rajdhani, body',
                        'font-size': '9.5px',
                        'font-weight': '500',
                        gap: '4px',
                        'letter-spacing': '0.05em',
                        padding: '2px 6px 1px',
                        'text-transform': 'uppercase',
                      }}
                    >
                      Approved
                    </span>
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': appFont,
                        'font-size': '11.5px',
                        'margin-left': 'auto',
                      }}
                    >
                      11:40 AM
                    </span>
                  </div>
                  <p
                    style={{
                      color: 'var(--c2)',
                      'font-family': appFont,
                      'font-size': '13px',
                      'line-height': 1.55,
                      margin: 0,
                    }}
                  >
                    Clean fix. Filed <MentionPill kind="task" label="PRJ-204" />{' '}
                    for the backfill follow-up.
                  </p>
                </div>
              </div>

              {/* Composer */}
              <div
                style={{
                  'background-color': '#0a0a0a',
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
                  'border-radius': '12px',
                  'box-sizing': 'border-box',
                  display: 'grid',
                  gap: '12px',
                  'margin-bottom': compact() ? '18px' : '24px',
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
                      'background-color':
                        'color-mix(in srgb, var(--c4) 18%, transparent)',
                      'border-radius': '999px',
                      color: 'var(--c4)',
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
          </div>
        </div>

        {/* Details + Checks rail */}
        <Show when={showRail() && !compact()}>
          <div
            style={{
              'background-color':
                'color-mix(in srgb, var(--b1) 24%, var(--b0))',
              display: 'grid',
              'align-content': 'start',
              gap: '14px',
              padding: '20px 16px',
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
                gap: '11px',
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
              <DetailRow label="Author">
                <span
                  style={{
                    'align-items': 'center',
                    display: 'inline-flex',
                    gap: '6px',
                  }}
                >
                  <Avatar
                    initials="GB"
                    size={16}
                    color="var(--b3)"
                    image={avatarGabriel}
                  />
                  <span
                    style={{
                      color: 'var(--c2)',
                      'font-family': appFont,
                      'font-size': '12.5px',
                    }}
                  >
                    gbirman
                  </span>
                </span>
              </DetailRow>
              <DetailRow label="Status">
                <StatusPill state="open" />
              </DetailRow>
              <DetailRow label="Changes">
                <DiffStat add={6} del={20} size={12.5} weight="600" />
              </DetailRow>
              <DetailRow label="GitHub">
                <span
                  style={{
                    color: 'var(--c2)',
                    display: 'block',
                    'font-family': appFont,
                    'font-size': '12.5px',
                    overflow: 'hidden',
                    'text-decoration': 'underline',
                    'text-overflow': 'ellipsis',
                    'text-underline-offset': '2px',
                    'white-space': 'nowrap',
                  }}
                >
                  macro#4109
                </span>
              </DetailRow>
            </div>

            {/* Checks */}
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
                <ChevronGlyph size={11} /> Checks
                <span
                  style={{
                    'align-items': 'center',
                    color: 'var(--c4)',
                    display: 'inline-flex',
                    'font-weight': '500',
                    gap: '4px',
                    'margin-left': 'auto',
                  }}
                >
                  <CheckCircleGlyph size={12} color="var(--c4)" /> 14 passed
                </span>
              </span>
              <div style={{ display: 'grid', gap: '2px' }}>
                <For each={heroChecks}>
                  {(check) => (
                    <div
                      style={{
                        'align-items': 'center',
                        display: 'flex',
                        gap: '8px',
                        padding: '3px 0',
                      }}
                    >
                      <CheckCircleGlyph size={13} color="var(--c4)" />
                      <span
                        style={{
                          color: 'var(--c2)',
                          'font-family': appFont,
                          'font-size': '12px',
                          overflow: 'hidden',
                          'text-overflow': 'ellipsis',
                          'white-space': 'nowrap',
                        }}
                      >
                        {check.label}
                      </span>
                      <span
                        style={{
                          color: 'var(--c4)',
                          'font-family': appFont,
                          'font-size': '11px',
                          'margin-left': 'auto',
                        }}
                      >
                        {check.time}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

function DetailRow(props: { label: string; children: JSX.Element }) {
  return (
    <div
      style={{
        'align-items': 'center',
        display: 'grid',
        gap: '10px',
        'grid-template-columns': '58px minmax(0, 1fr)',
      }}
    >
      <span
        style={{
          color: 'var(--c4)',
          'font-family': appFont,
          'font-size': '12px',
        }}
      >
        {props.label}
      </span>
      <span style={{ 'min-width': 0 }}>{props.children}</span>
    </div>
  );
}

function CodeSpan(props: { children: JSX.Element }) {
  return (
    <code
      style={{
        'background-color': 'color-mix(in srgb, var(--c4) 14%, transparent)',
        'border-radius': '4px',
        color: 'var(--c1)',
        'font-family': monoFont,
        'font-size': '0.86em',
        padding: '1px 5px',
      }}
    >
      {props.children}
    </code>
  );
}

// ---------------------------------------------------------------------------
// Unified inbox — PRs, reviews, email, and messages in one list
// ---------------------------------------------------------------------------

type InboxRow =
  | {
      kind: 'pr';
      title: string;
      ref: string;
      add: number;
      del: number;
      comments: number;
      time: string;
      merged?: boolean;
      unread?: boolean;
    }
  | {
      kind: 'review';
      title: string;
      ref: string;
      comments: number;
      time: string;
      unread?: boolean;
    }
  | {
      kind: 'email';
      who: string;
      subject: string;
      preview: string;
      time: string;
      unread?: boolean;
    }
  | {
      kind: 'message';
      who: string;
      preview: string;
      time: string;
      unread?: boolean;
    }
  | { kind: 'summary'; title: string; time: string };

const inboxRows: InboxRow[] = [
  {
    kind: 'pr',
    title: 'Add GitHub PR entity type filter support',
    ref: '#4107',
    add: 21,
    del: 1,
    comments: 5,
    time: '12:05',
    unread: true,
  },
  {
    kind: 'review',
    title: 'fix(split): fix spotlight split tw classes',
    ref: '#4113',
    comments: 2,
    time: '12:03',
    unread: true,
  },
  {
    kind: 'email',
    who: 'Mary Kim',
    subject: 'Re: auth refactor',
    preview: 'Left a few comments, mostly nits.',
    time: '11:58',
    unread: true,
  },
  {
    kind: 'message',
    who: '#eng-reviews',
    preview: 'Peter, can you take a look at the auth PR?',
    time: '11:52',
  },
  {
    kind: 'pr',
    title: 'fix(email): stop double email init on login',
    ref: '#4109',
    add: 6,
    del: 20,
    comments: 2,
    time: '11:45',
  },
  {
    kind: 'pr',
    title: 'feat(doppler): move to iac created projects',
    ref: '#4106',
    add: 1,
    del: 1,
    comments: 1,
    time: '11:44',
    merged: true,
  },
];

function InboxRowIcon(props: { row: InboxRow }) {
  const r = props.row;
  if (r.kind === 'email')
    return (
      <span style={{ color: 'var(--c4)', display: 'inline-flex' }}>
        <MailGlyph size={15} />
      </span>
    );
  if (r.kind === 'message')
    return (
      <span
        style={{
          color: 'var(--c4)',
          'font-family': appFont,
          'font-size': '15px',
          'font-weight': '700',
        }}
      >
        #
      </span>
    );
  if (r.kind === 'summary')
    return (
      <span style={{ color: 'var(--a0)', display: 'inline-flex' }}>
        <SparkleGlyph size={14} />
      </span>
    );
  if (r.kind === 'review')
    return (
      <span style={{ color: 'var(--c4)', display: 'inline-flex' }}>
        <CommentGlyph size={15} color="var(--c4)" />
      </span>
    );
  return (
    <span style={{ display: 'inline-flex' }}>
      <Show when={r.merged} fallback={<PrGlyph size={14} color={PR_ORANGE} />}>
        <MergeGlyph size={14} color={PR_PURPLE} />
      </Show>
    </span>
  );
}

function _UnifiedInboxGraphic() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '14px',
        padding: compact() ? '32px 18px' : '44px 24px',
        width: '100%',
        'max-width': '560px',
      }}
    >
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': '0 22px 60px rgb(0 0 0 / 0.34)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
        }}
      >
        {/* Header with tabs */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '14px',
            padding: '11px 16px',
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
          <div
            style={{
              'align-items': 'center',
              display: 'flex',
              gap: '6px',
              'margin-left': '4px',
            }}
          >
            <span
              style={{
                border: '1px solid transparent',
                'border-radius': '8px',
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '12.5px',
                'font-weight': '600',
                padding: '4px 10px',
              }}
            >
              Signal
            </span>
            <span
              style={{
                border: '1px solid transparent',
                'border-radius': '8px',
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '12.5px',
                'font-weight': '600',
                padding: '4px 10px',
              }}
            >
              Noise
            </span>
            <span
              style={{
                'background-color':
                  'color-mix(in srgb, var(--c4) 12%, transparent)',
                border:
                  '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
                'border-radius': '8px',
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '12.5px',
                'font-weight': '600',
                padding: '4px 10px',
              }}
            >
              All
            </span>
          </div>
        </div>
        {/* Rows */}
        <For each={inboxRows}>
          {(row, index) => {
            const isPr = row.kind === 'pr';
            const isReview = row.kind === 'review';
            return (
              <div
                style={{
                  'align-items': 'center',
                  'border-bottom':
                    index() === inboxRows.length - 1
                      ? '0'
                      : '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  display: 'grid',
                  gap: compact() ? '9px' : '11px',
                  'grid-template-columns': 'auto auto minmax(0, 1fr) auto',
                  padding: compact() ? '10px 13px' : '10px 16px',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    'background-color':
                      row.kind !== 'summary' && row.unread
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
                    'align-items': 'center',
                    display: 'inline-flex',
                    'justify-content': 'center',
                    width: '17px',
                  }}
                >
                  <InboxRowIcon row={row} />
                </span>
                <span
                  style={{
                    'min-width': 0,
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'white-space': 'nowrap',
                  }}
                >
                  <Show when={row.kind === 'email'}>
                    <span
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-size': compact() ? '13px' : '13.5px',
                        'font-weight': (row as { unread?: boolean }).unread
                          ? '700'
                          : '500',
                      }}
                    >
                      {(row as { who: string }).who}{' '}
                    </span>
                    <span
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-size': compact() ? '13px' : '13.5px',
                      }}
                    >
                      {(row as { subject: string }).subject}
                    </span>
                    <Show when={!compact()}>
                      <span
                        style={{
                          color: 'var(--c4)',
                          'font-family': appFont,
                          'font-size': '13.5px',
                        }}
                      >
                        {' '}
                        {(row as { preview: string }).preview}
                      </span>
                    </Show>
                  </Show>
                  <Show when={row.kind === 'message'}>
                    <span
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-size': compact() ? '13px' : '13.5px',
                        'font-weight': '600',
                      }}
                    >
                      {(row as { who: string }).who}{' '}
                    </span>
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': appFont,
                        'font-size': compact() ? '13px' : '13.5px',
                      }}
                    >
                      {(row as { preview: string }).preview}
                    </span>
                  </Show>
                  <Show when={row.kind === 'summary'}>
                    <span
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-size': compact() ? '13px' : '13.5px',
                        'font-weight': '500',
                      }}
                    >
                      {(row as { title: string }).title}
                    </span>
                  </Show>
                  <Show when={isPr || isReview}>
                    <span
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-size': compact() ? '13px' : '13.5px',
                        'font-weight': (row as { unread?: boolean }).unread
                          ? '600'
                          : '500',
                      }}
                    >
                      {(row as { title: string }).title}{' '}
                    </span>
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': appFont,
                        'font-size': compact() ? '13px' : '13.5px',
                      }}
                    >
                      {(row as { ref: string }).ref}
                    </span>
                  </Show>
                </span>
                {/* Right meta */}
                <span
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: compact() ? '8px' : '12px',
                  }}
                >
                  <Show when={isPr}>
                    <Show when={!compact()}>
                      <span
                        style={{
                          'align-items': 'center',
                          border:
                            '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                          'border-radius': '999px',
                          display: 'inline-flex',
                          padding: '2px 9px',
                        }}
                      >
                        <DiffStat
                          add={(row as { add: number }).add}
                          del={(row as { del: number }).del}
                          size={11}
                        />
                      </span>
                    </Show>
                  </Show>
                  <Show when={isPr || isReview}>
                    <span
                      style={{
                        'align-items': 'center',
                        color: 'var(--c4)',
                        display: 'inline-flex',
                        'font-family': appFont,
                        'font-size': '11.5px',
                        gap: '4px',
                      }}
                    >
                      <CommentGlyph size={12} />{' '}
                      {(row as { comments: number }).comments}
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
                    {row.time}
                  </span>
                </span>
              </div>
            );
          }}
        </For>
        {/* Ask AI bar */}
        <div
          style={{
            'border-top':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            padding: '11px 16px',
          }}
        >
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
            <span
              aria-hidden="true"
              style={{ color: 'var(--c4)', display: 'inline-flex' }}
            >
              <PaperclipGlyph size={15} />
            </span>
            <span
              style={{
                color: 'var(--c4)',
                flex: 1,
                'font-family': appFont,
                'font-size': '13.5px',
              }}
            >
              Ask AI, @mention anything
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard-first review (faster than GitHub)
// ---------------------------------------------------------------------------

const reviewCommands = [
  { keys: ['J', 'K'], label: 'Next PR' },
  { keys: ['↵'], label: 'Open' },
  { keys: ['C'], label: 'Comment' },
  { keys: ['⇧', 'A'], label: 'Approve' },
];

function Keycap(props: { label: string }) {
  const [pressed, setPressed] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const press = () => {
    setPressed(false);
    timer = setTimeout(() => setPressed(true), 0);
    setTimeout(() => setPressed(false), 240);
  };
  return (
    <button
      type="button"
      aria-label={props.label}
      class={`gh-keycap${pressed() ? ' is-pressed' : ''}`}
      onClick={press}
      style={{
        'align-items': 'center',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--b1) 80%, var(--b4)), var(--b1))',
        border: '1px solid color-mix(in srgb, var(--b4) 70%, transparent)',
        'border-radius': '8px',
        'box-shadow':
          '0 3px 0 color-mix(in srgb, var(--b0) 70%, var(--b4)), inset 0 1px 0 color-mix(in srgb, var(--c1) 12%, transparent)',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        cursor: 'pointer',
        display: 'inline-grid',
        'font-family': 'rajdhani, body',
        'font-size': mobile() ? '15px' : '17px',
        'font-weight': '700',
        height: mobile() ? '38px' : '44px',
        'line-height': 1,
        'min-width': mobile() ? '38px' : '44px',
        padding: props.label.length > 1 ? '0 12px' : '0',
        'place-items': 'center',
      }}
    >
      {props.label}
    </button>
  );
}

function ReviewCommandGraphic() {
  return (
    <div
      style={{
        display: 'grid',
        gap: mobile() ? '16px' : '20px',
        'grid-template-columns': mobile()
          ? 'repeat(2, minmax(0, 1fr))'
          : 'repeat(4, minmax(0, max-content))',
        'justify-content': 'center',
        width: '100%',
      }}
    >
      <For each={reviewCommands}>
        {(command) => (
          <div
            style={{
              'align-content': 'start',
              display: 'grid',
              gap: '10px',
              'justify-items': 'center',
              padding: mobile() ? '8px 0' : '0 16px',
            }}
          >
            <span
              style={{
                'align-items': 'center',
                display: 'inline-flex',
                gap: '6px',
              }}
            >
              <For each={command.keys}>{(key) => <Keycap label={key} />}</For>
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': 'rajdhani, body',
                'font-size': mobile() ? '12px' : '13px',
                'font-weight': '700',
                'letter-spacing': '0.08em',
                'line-height': 1,
                'text-align': 'center',
                'text-transform': 'uppercase',
              }}
            >
              {command.label}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// @mention a PR anywhere — channel message with an inline PR preview card
// ---------------------------------------------------------------------------

function _MentionGraphic() {
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
          'border-radius': '14px',
          'box-shadow': '0 24px 64px rgb(0 0 0 / 0.34)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(480px, 100%)',
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
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '15px',
              'font-weight': '700',
            }}
          >
            #
          </span>
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '14px',
              'font-weight': '600',
            }}
          >
            eng-reviews
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gap: '14px',
            padding: compact() ? '16px' : '18px',
          }}
        >
          {/* Message with mention */}
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
                gap: '6px',
                'min-width': 0,
                width: '100%',
              }}
            >
              <div
                style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
              >
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': '13px',
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
                  9:24 AM
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
                <MentionPill
                  kind="person"
                  label="Julia"
                  initials="JW"
                  image={avatarJulia}
                />{' '}
                can you review{' '}
                <MentionPill
                  kind="pr"
                  label="fix(auth): stop double session init"
                />{' '}
                before the release?
              </p>
              {/* Inline PR preview card */}
              <div
                style={{
                  'background-color': 'var(--b0)',
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '10px',
                  'box-sizing': 'border-box',
                  display: 'grid',
                  gap: '9px',
                  'margin-top': '2px',
                  padding: '12px 13px',
                }}
              >
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '8px',
                  }}
                >
                  <PrGlyph size={14} color={PR_ORANGE} />
                  <span
                    style={{
                      color: 'var(--c1)',
                      'font-family': appFont,
                      'font-size': '13px',
                      'font-weight': '600',
                      'min-width': 0,
                      overflow: 'hidden',
                      'text-overflow': 'ellipsis',
                      'white-space': 'nowrap',
                    }}
                  >
                    fix(auth): stop double session init on login
                  </span>
                </div>
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    'flex-wrap': 'wrap',
                    gap: '8px',
                  }}
                >
                  <StatusPill state="open" />
                  <RefPill label="macro-inc/macro#4109" />
                  <span
                    style={{
                      'align-items': 'center',
                      border:
                        '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                      'border-radius': '999px',
                      display: 'inline-flex',
                      padding: '3px 10px',
                    }}
                  >
                    <DiffStat add={6} del={20} size={11} />
                  </span>
                  <span
                    style={{
                      'align-items': 'center',
                      color: 'var(--a2)',
                      display: 'inline-flex',
                      'font-family': appFont,
                      'font-size': '11.5px',
                      gap: '4px',
                      'margin-left': 'auto',
                    }}
                  >
                    <CheckCircleGlyph size={12} /> 14 passed
                  </span>
                </div>
              </div>
            </div>
          </div>
          {/* Composer */}
          <div
            style={{
              'align-items': 'center',
              'background-color': '#0a0a0a',
              border:
                '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
              'border-radius': '999px',
              display: 'flex',
              gap: '10px',
              padding: '8px 14px',
            }}
          >
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '13.5px',
              }}
            >
              Message #eng-reviews…
            </span>
            <span
              style={{
                color: 'var(--c4)',
                display: 'inline-flex',
                'margin-left': 'auto',
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
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Synced comments — Macro comment ↔ GitHub
// ---------------------------------------------------------------------------

function SyncedCommentsGraphic() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '0',
        'justify-items': 'center',
        width: '100%',
        'max-width': '560px',
      }}
    >
      {/* Comment written in Macro */}
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': '0 22px 60px rgb(0 0 0 / 0.34)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: '100%',
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
          <PrGlyph size={14} color={PR_ORANGE} />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13px',
              'font-weight': '600',
            }}
          >
            #4109
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
            padding: compact() ? '14px' : '16px 18px',
          }}
        >
          <div
            style={{
              'align-items': 'flex-start',
              display: 'flex',
              gap: '10px',
            }}
          >
            <Avatar
              initials="JW"
              size={26}
              color="var(--b3)"
              image={avatarJulia}
            />
            <div
              style={{
                display: 'grid',
                gap: '3px',
                'min-width': 0,
                width: '100%',
              }}
            >
              <div
                style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
              >
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': '13px',
                    'font-weight': '500',
                  }}
                >
                  Julia
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '11.5px',
                  }}
                >
                  commented in Macro
                </span>
              </div>
              <p
                style={{
                  color: 'var(--c2)',
                  'font-family': appFont,
                  'font-size': compact() ? '13px' : '13.5px',
                  'line-height': 1.55,
                  margin: 0,
                }}
              >
                Looks good, let's ship after the preview check goes green.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sync connector */}
      <div
        aria-hidden="true"
        style={{
          'align-items': 'center',
          display: 'grid',
          'justify-items': 'center',
          padding: '4px 0',
        }}
      >
        <span
          style={{
            'background-color': 'var(--b3)',
            height: '18px',
            width: '2px',
          }}
        />
        <span
          style={{
            'align-items': 'center',
            'background-color': 'color-mix(in srgb, var(--a0) 12%, var(--b0))',
            border: '1px solid color-mix(in srgb, var(--a0) 32%, transparent)',
            'border-radius': '999px',
            color: 'var(--a0)',
            display: 'inline-flex',
            'font-family': "'rajdhani', body",
            'font-size': '10.5px',
            'font-weight': '700',
            gap: '6px',
            'letter-spacing': '0.07em',
            padding: '4px 11px 3px',
            'text-transform': 'uppercase',
          }}
        >
          <SyncGlyph size={12} /> Synced both ways
        </span>
        <span
          style={{
            'background-color': 'var(--b3)',
            height: '18px',
            width: '2px',
          }}
        />
      </div>

      {/* Mirrored on GitHub */}
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '12px',
          'box-shadow': '0 18px 48px rgb(0 0 0 / 0.3)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: '100%',
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
          <IconGithub
            style={{
              color: 'var(--c2)',
              display: 'block',
              height: '15px',
              width: '15px',
            }}
          />
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13px',
              'font-weight': '600',
            }}
          >
            github.com
          </span>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '12px',
              'margin-left': 'auto',
            }}
          >
            macro-inc/macro #4109
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gap: '8px',
            padding: compact() ? '14px' : '16px 18px',
          }}
        >
          <div
            style={{
              'align-items': 'flex-start',
              display: 'flex',
              gap: '10px',
            }}
          >
            <Avatar
              initials="JW"
              size={26}
              color="var(--b3)"
              image={avatarJulia}
            />
            <div
              style={{
                display: 'grid',
                gap: '3px',
                'min-width': 0,
                width: '100%',
              }}
            >
              <div
                style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
              >
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': '13px',
                    'font-weight': '500',
                  }}
                >
                  juliawestphal
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '11.5px',
                  }}
                >
                  commented now
                </span>
              </div>
              <p
                style={{
                  color: 'var(--c2)',
                  'font-family': appFont,
                  'font-size': compact() ? '13px' : '13.5px',
                  'line-height': 1.55,
                  margin: 0,
                }}
              >
                Looks good, let's ship after the preview check goes green.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SyncGlyph(props: { size?: number; color?: string }) {
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
        d="M4 9a8 8 0 0 1 13-3l3 3 M20 5v4h-4 M20 15a8 8 0 0 1-13 3l-3-3 M4 19v-4h4"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Link tasks to PRs
// ---------------------------------------------------------------------------

// Half-filled progress disc used for an "in review" task status, mirroring the
// app's solid status glyphs.
function ReviewProgressGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
  const c = props.color ?? PR_PURPLE;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <circle cx="12" cy="12" r="8.5" fill="none" stroke={c} stroke-width="2" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill={c} />
    </svg>
  );
}

// Dashed empty ring used for the unset "priority" metadata pill.
function DottedCircleGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
  const c = props.color ?? 'var(--c4)';
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
        stroke={c}
        stroke-width="2"
        stroke-linecap="round"
        stroke-dasharray="0.5 4"
      />
    </svg>
  );
}

function _TaskLinkGraphic() {
  const compact = () => mobile();
  const metaPill: JSX.CSSProperties = {
    'align-items': 'center',
    'background-color': 'color-mix(in srgb, var(--c4) 7%, transparent)',
    border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
    'border-radius': '8px',
    'box-sizing': 'border-box',
    display: 'inline-flex',
    'font-family': appFont,
    'font-size': '13px',
    gap: '6px',
    padding: '5px 8px',
  };
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: compact() ? '32px 18px' : '44px 24px',
        width: '100%',
        'max-width': '460px',
      }}
    >
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '14px',
          'box-shadow': '0 24px 64px rgb(0 0 0 / 0.34)',
          'box-sizing': 'border-box',
          display: 'grid',
          gap: compact() ? '14px' : '15px',
          overflow: 'hidden',
          padding: compact() ? '18px' : '22px',
          width: '100%',
        }}
      >
        {/* Task title */}
        <span
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': compact() ? '19px' : '22px',
            'font-weight': '600',
            'letter-spacing': '-0.01em',
            'line-height': 1.2,
          }}
        >
          Fix duplicate session init on login
        </span>
        {/* Metadata pills */}
        <div
          style={{
            'align-items': 'center',
            display: 'flex',
            'flex-wrap': 'wrap',
            gap: '8px',
          }}
        >
          <span style={metaPill}>
            <ReviewProgressGlyph size={14} />
            <span style={{ color: 'var(--c1)', 'font-weight': '500' }}>
              In review
            </span>
            <ChevronGlyph size={11} />
          </span>
          <span style={metaPill}>
            <DottedCircleGlyph size={14} />
            <span style={{ color: 'var(--c4)' }}>Priority</span>
            <ChevronGlyph size={11} />
          </span>
          <span style={metaPill}>
            <Avatar initials="GB" size={18} color="var(--b3)" />
            <span style={{ color: 'var(--c1)', 'font-weight': '500' }}>
              gbirman
            </span>
            <ChevronGlyph size={11} />
          </span>
        </div>
        {/* Linked PR row */}
        <div
          style={{
            'align-items': 'center',
            'background-color': 'color-mix(in srgb, var(--c4) 7%, transparent)',
            border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            'border-radius': '9px',
            'box-sizing': 'border-box',
            display: 'flex',
            gap: '9px',
            'min-width': 0,
            padding: '9px 11px',
          }}
        >
          <IconGithub
            style={{
              color: 'var(--c2)',
              display: 'block',
              flex: 'none',
              height: '15px',
              width: '15px',
            }}
          />
          <span
            style={{
              color: 'var(--c1)',
              flex: '1 1 auto',
              'font-family': appFont,
              'font-size': '13px',
              'font-weight': '500',
              'min-width': 0,
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            fix(auth): stop double session init on login
          </span>
          <span
            style={{
              color: 'var(--c4)',
              flex: 'none',
              'font-family': appFont,
              'font-size': '12.5px',
              'white-space': 'nowrap',
            }}
          >
            macro-inc/macro#4109
          </span>
          <span style={{ flex: 'none' }}>
            <DiffStat add={6} del={20} size={12} />
          </span>
        </div>
        {/* Editor placeholder */}
        <span
          style={{
            color: 'var(--c4)',
            'font-family': appFont,
            'font-size': '13.5px',
            opacity: 0.75,
          }}
        >
          Press '/' for commands, '@' to reference files…
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full-width spotlight compositions for the split LoopsFeatureSection blocks.
// Each = a dimmed full PR window behind + the lifted graphic centered and
// spotlit in front (drop-shadow + a subtle radial color glow), matching the
// email/documents spotlight language. On mobile the window backdrop is dropped
// and the lifted graphic stands on its own.
// ---------------------------------------------------------------------------

function SpotlightComposition(props: {
  children: JSX.Element;
  liftMaxWidth?: string;
}) {
  const compact = () => mobile();
  return (
    <Show
      when={!compact()}
      fallback={
        <div
          style={{ display: 'grid', 'justify-items': 'center', width: '100%' }}
        >
          <div
            style={{
              width: '100%',
              'max-width': props.liftMaxWidth ?? '560px',
            }}
          >
            {props.children}
          </div>
        </div>
      }
    >
      <div
        style={{
          display: 'grid',
          'justify-items': 'center',
          position: 'relative',
          width: '100%',
        }}
      >
        {/* Dimmed full PR window behind. */}
        <div
          aria-hidden="true"
          style={{
            filter: 'saturate(0.85)',
            'mask-image':
              'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
            '-webkit-mask-image':
              'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
            'max-width': '1040px',
            opacity: '0.42',
            'pointer-events': 'none',
            width: '100%',
          }}
        >
          <HeroPrWindow />
        </div>
        {/* Lifted graphic, centered and spotlit in front. */}
        <div
          style={{
            'align-items': 'center',
            display: 'grid',
            inset: '0',
            'justify-items': 'center',
            position: 'absolute',
          }}
        >
          <div
            style={{
              'max-width': props.liftMaxWidth ?? '560px',
              position: 'relative',
              width: '100%',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                background:
                  'radial-gradient(70% 70% at 50% 50%, color-mix(in srgb, var(--ambient-ink) 8%, transparent) 0%, transparent 72%)',
                inset: '-14% -10%',
                'pointer-events': 'none',
                position: 'absolute',
                'z-index': 0,
              }}
            />
            <div
              style={{
                filter: 'drop-shadow(0 40px 80px rgb(0 0 0 / 0.55))',
                position: 'relative',
                'z-index': 1,
              }}
            >
              {props.children}
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

function ReviewSpotlight() {
  return (
    <SpotlightComposition liftMaxWidth="640px">
      <div
        style={{
          'background-color': '#080808',
          border: '1px solid color-mix(in srgb, var(--c4) 12%, transparent)',
          'border-radius': '16px',
          'box-sizing': 'border-box',
          padding: mobile() ? '28px 18px' : '44px 32px',
          width: '100%',
        }}
      >
        <ReviewCommandGraphic />
      </div>
    </SpotlightComposition>
  );
}

function SyncedCommentsSpotlight() {
  return (
    <SpotlightComposition liftMaxWidth="560px">
      <SyncedCommentsGraphic />
    </SpotlightComposition>
  );
}

// ---------------------------------------------------------------------------
// Split feature blocks (one full-bleed spotlight each)
// ---------------------------------------------------------------------------

const reviewBlock: LoopsFeatureBlock = {
  label: 'Pull Requests',
  headline: (
    <>
      Review every PR
      <br />
      keyboard-first.
    </>
  ),
  description:
    'Jump between PRs, open diffs, comment, and approve — without leaving the keyboard.',
  href: 'https://docs.macro.com/product/github',
  heroShot: ReviewSpotlight,
  heroBare: true,
};

const syncedBlock: LoopsFeatureBlock = {
  label: 'Pull Requests',
  headline: (
    <>
      Comments synced
      <br />
      both ways.
    </>
  ),
  description:
    'Comment in Macro and it posts to GitHub. Comment on GitHub and it shows up here. One thread.',
  href: 'https://docs.macro.com/product/github',
  heroShot: SyncedCommentsSpotlight,
  heroBare: true,
};

// ---------------------------------------------------------------------------
// Comparison table (Macro vs GitHub vs Linear vs Graphite)
// ---------------------------------------------------------------------------

type Cell = boolean | 'partial' | string;

const comparisonColumns = ['Macro', 'GitHub', 'Linear', 'Graphite'];

const comparisonRows: { feature: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  {
    feature: 'PRs in a unified inbox with email & chat',
    cells: [true, 'partial', 'partial', 'partial'],
  },
  {
    feature: '@mention PRs in messages & docs',
    cells: [true, false, 'partial', false],
  },
  {
    feature: 'Comments synced both ways with GitHub',
    cells: [true, 'partial', true, 'partial'],
  },
  {
    feature: 'Reliable mention & review notifications',
    cells: [true, 'partial', true, 'partial'],
  },
  {
    feature: 'Link PRs to tasks in one tool',
    cells: [true, 'partial', true, false],
  },
  {
    feature: 'Agents can read your PRs',
    cells: [true, 'partial', false, false],
  },
  {
    feature: 'PRs added to team-level memory',
    cells: [true, false, false, false],
  },
  { feature: 'Keyboard-first review', cells: [true, false, 'partial', true] },
  { feature: 'Open source', cells: [true, false, false, false] },
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
  const isText = () =>
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
        when={isText()}
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

function ComparisonTable() {
  const gridTemplate = () =>
    mobile()
      ? 'minmax(170px, 1.6fr) repeat(4, minmax(58px, 1fr))'
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
// Comparison section (eyebrow + headline + collapsible table + legend)
// ---------------------------------------------------------------------------

function ComparisonSection() {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <section
      aria-label="How Macro Reviews compares"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '28px' : '40px',
        'justify-items': 'center',
        'min-width': '0',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: '14px',
          'justify-items': 'center',
          'max-width': '720px',
          'text-align': 'center',
        }}
      >
        <span style={eyebrowStyle()}>The comparison</span>
        <h2
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            'font-size': mobile() ? '32px' : '44px',
            'font-weight': '410',
            'letter-spacing': '-0.015em',
            'line-height': 1.1,
            margin: 0,
          }}
        >
          PRs alongside tasks and channels.
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-size': mobile() ? '16px' : '19px',
            'line-height': 1.45,
            margin: 0,
            'max-width': '580px',
          }}
        >
          Your code stays on GitHub. Macro brings the PRs into your inbox, next
          to your tasks and chat.
        </p>
      </div>
      <div
        style={{
          width: '100%',
          'max-width': '920px',
          'min-width': '0',
          position: 'relative',
        }}
      >
        <div
          style={{
            'max-height': expanded() ? 'none' : mobile() ? '320px' : '420px',
            overflow: 'hidden',
          }}
        >
          <ComparisonTable />
        </div>
        <Show when={!expanded()}>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{
              'align-items': 'flex-end',
              background:
                'linear-gradient(to bottom, transparent 0, var(--b0) 82%)',
              border: '0',
              bottom: '0',
              cursor: 'pointer',
              display: 'flex',
              height: '120px',
              'justify-content': 'center',
              left: '0',
              padding: '0 0 12px',
              position: 'absolute',
              right: '0',
            }}
          >
            <span
              style={{
                'align-items': 'center',
                color: 'var(--c4)',
                display: 'flex',
                'font-family': "'rajdhani', body",
                'font-size': '11px',
                'font-weight': '700',
                gap: '8px',
                'letter-spacing': '0.1em',
                'text-transform': 'uppercase',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  background: 'var(--b3)',
                  height: '1px',
                  width: '20px',
                }}
              />
              Show more
              <span
                aria-hidden="true"
                style={{
                  background: 'var(--b3)',
                  height: '1px',
                  width: '20px',
                }}
              />
            </span>
          </button>
        </Show>
      </div>
      <div
        style={{
          'align-items': 'center',
          color: 'var(--c4)',
          display: 'flex',
          'flex-wrap': 'wrap',
          gap: mobile() ? '16px' : '24px',
          'justify-content': 'center',
        }}
      >
        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            'font-size': '13px',
            gap: '8px',
          }}
        >
          <CheckMark /> Full support
        </span>
        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            'font-size': '13px',
            gap: '8px',
          }}
        >
          <PartialMark /> Partial / limited
        </span>
        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            'font-size': '13px',
            gap: '8px',
          }}
        >
          <CrossMark /> Not available
        </span>
        <Show when={mobile()}>
          <span
            style={{
              'font-family': 'rajdhani, body',
              'font-size': '11px',
              'letter-spacing': '0.06em',
              opacity: 0.6,
              'text-transform': 'uppercase',
              width: '100%',
              'text-align': 'center',
            }}
          >
            Scroll table sideways →
          </span>
        </Show>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Final CTA (mirrors RouteEmail's EmailFinalCta) + open-source note
// ---------------------------------------------------------------------------

function GithubFinalCta() {
  return (
    <section
      aria-label="Get started"
      style={{
        'align-items': mobile() ? 'start' : 'center',
        display: 'grid',
        gap: mobile() ? '24px' : '28px',
        'justify-items': mobile() ? 'start' : 'center',
        'text-align': mobile() ? 'left' : 'center',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: mobile() ? '14px' : '16px',
          'justify-items': mobile() ? 'start' : 'center',
          'max-width': '585px',
        }}
      >
        <h2
          style={{
            'font-family': 'display',
            'font-size': mobile() ? '38px' : '48px',
            'font-weight': '420',
            'letter-spacing': '-0.015em',
            'line-height': 1.08,
            margin: '0',
          }}
        >
          Review pull requests without leaving your inbox.
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-family': 'body',
            'font-size': mobile() ? '17px' : '19px',
            'font-weight': '400',
            'line-height': 1.55,
            margin: '0',
          }}
        >
          Connect your account in 30 seconds and review pull requests next to
          your email, messages, tasks, and agents. Open source under the AGPLv3.
        </p>
      </div>
      <div
        style={{
          'align-items': 'center',
          display: 'flex',
          'flex-direction': mobile() ? 'column' : 'row',
          gap: mobile() ? '12px' : '14px',
          'justify-content': mobile() ? 'flex-start' : 'center',
          width: mobile() ? '100%' : 'auto',
        }}
      >
        <ConnectGoogleButton buttonName="github_final_connect_google" large />
        <GithubStarButton />
      </div>
    </section>
  );
}

// The /github hero reuses the shared app shell (SceneAppPreview): the PR record
// lives in the main panel with a "Pull Requests" item added to the left rail, so
// the marketing hero reads as the real product — not a lone floating window.
const GithubPanelWindow: Component = () => <HeroPrWindow fill />;

const githubExtraSections: AppSection[] = [
  {
    key: 'github',
    label: 'Pull Requests',
    icon: IconGithub,
    graphic: GithubPanelWindow,
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const RouteGithub: Component = () => {
  setPageSeo({
    title: 'Macro Reviews — Review PRs in Your Inbox',
    description:
      'Bring your GitHub pull requests into Macro — in your inbox alongside email and chat, @mentionable in messages and docs, with comments synced both ways, reliable notifications, tasks linked to PRs, and agents that read your PRs. Open source.',
    path: '/github',
  });

  const [heroSection, setHeroSection] = createSignal('github');

  return (
    <div
      lang="en"
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        'grid-template-columns': 'minmax(0, 1fr)',
        gap: '0',
        'padding-bottom': mobile() ? '48px' : '64px',
        width: '100%',
      }}
    >
      <style>{`
        @media (hover) {
          .gh-cta-button:hover { transform: scale(1.02); }
          .gh-keycap:hover { transform: translateY(-2px); box-shadow: 0 5px 0 color-mix(in srgb, var(--b0) 70%, var(--b4)), inset 0 1px 0 color-mix(in srgb, var(--c1) 16%, transparent); background: linear-gradient(180deg, color-mix(in srgb, var(--b1) 65%, var(--b4)), var(--b1)); }
        }
        .gh-cta-button { transition: transform 160ms ease; }
        .gh-keycap { transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease; }
        .gh-hero-window { transition: box-shadow 200ms ease, border-color 200ms ease; }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes ghKeyPress {
            0% { transform: translateY(0); box-shadow: 0 3px 0 color-mix(in srgb, var(--b0) 70%, var(--b4)), inset 0 1px 0 color-mix(in srgb, var(--c1) 12%, transparent); }
            35% { transform: translateY(3px); box-shadow: 0 0 0 color-mix(in srgb, var(--b0) 70%, var(--b4)), inset 0 1px 0 color-mix(in srgb, var(--c1) 12%, transparent); }
            70% { transform: translateY(-1px); }
            100% { transform: translateY(0); box-shadow: 0 3px 0 color-mix(in srgb, var(--b0) 70%, var(--b4)), inset 0 1px 0 color-mix(in srgb, var(--c1) 12%, transparent); }
          }
          .gh-keycap.is-pressed { animation: ghKeyPress 240ms ease; }
        }
        ${loopsFeatureHoverStyles()}
      `}</style>

      {/* Hero — copy on the gradient backdrop with the masked PR window below. */}
      <div
        style={{
          display: 'flow-root',
          position: 'relative',
          width: '100%',
          'min-width': '0',
        }}
      >
        <HomeHeroBackdrop subtle neutral />

        <section
          style={{
            'box-sizing': 'border-box',
            display: 'grid',
            'justify-items': mobile() ? 'start' : 'center',
            'padding-bottom': '0',
            'padding-inline': mobile() ? '18px' : '24px',
            'padding-top': mobile() ? '96px' : '128px',
            position: 'relative',
            'z-index': 1,
            width: '100%',
          }}
        >
          <div
            style={{
              'box-sizing': 'border-box',
              display: 'grid',
              gap: mobile() ? '24px' : '28px',
              'justify-items': mobile() ? 'start' : 'center',
              'max-width': mobile() ? '100%' : '720px',
              'text-align': mobile() ? 'left' : 'center',
              width: '100%',
            }}
          >
            <HeroEyebrow label="Macro Reviews" mobile={mobile} />
            <h1
              style={{
                'font-family': 'display',
                'font-size': mobile() ? 'clamp(44px, 12vw, 60px)' : '52.36px',
                'font-weight': '380',
                'letter-spacing': '-0.012em',
                'line-height': 1.12,
                margin: '0',
                'white-space': mobile() ? 'normal' : 'nowrap',
              }}
            >
              Review PRs in your inbox.
            </h1>
            <p
              style={{
                color: 'var(--c4)',
                'font-family': 'body',
                'font-size': mobile() ? '16.5px' : '23px',
                'font-weight': '400',
                'line-height': 1.5,
                margin: '0',
                'max-width': mobile() ? '34ch' : '720px',
              }}
            >
              Your GitHub pull requests, in your inbox alongside email and chat
              — @mentionable anywhere, with comments synced both ways.
            </p>
            <div
              style={{
                'align-items': 'center',
                display: 'flex',
                'flex-direction': mobile() ? 'column' : 'row',
                gap: mobile() ? '12px' : '14px',
                'justify-content': mobile() ? 'flex-start' : 'center',
                'margin-top': mobile() ? '4px' : '8px',
                width: mobile() ? '100%' : 'auto',
              }}
            >
              <ConnectGoogleButton buttonName="github_hero_connect_google" />
            </div>
          </div>

          {/* Hero graphic: the PR record nested in the real app shell (left rail +
              main panel), matching the home-page preview, faded into the page. */}
          <div
            style={{
              'box-sizing': 'border-box',
              'margin-bottom': mobile() ? '-80px' : '-130px',
              'margin-top': mobile() ? '52px' : '80px',
              '-webkit-mask-image':
                'linear-gradient(to bottom, #000 0%, #000 66%, transparent 100%)',
              'mask-image':
                'linear-gradient(to bottom, #000 0%, #000 66%, transparent 100%)',
              'max-width': '1080px',
              width: '100%',
            }}
          >
            <SceneAppPreview
              mobile={mobile()}
              active={heroSection()}
              onSelectSection={setHeroSection}
              extraSections={githubExtraSections}
            />
          </div>
        </section>
      </div>

      <HomeSectionRule />

      {/* The fundamentals — single row of differentiators */}
      <GithubFeatureGrid />

      <HomeSectionRule />

      {/* Review, keyboard-first */}
      <div
        style={{
          'padding-block': mobile() ? '56px' : '80px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <LoopsFeatureSection
          block={reviewBlock}
          textLayout="split"
          spotlight
          spotlightGlow={0}
        />
      </div>

      <HomeSectionRule />

      {/* Comments synced both ways */}
      <div
        style={{
          'padding-block': mobile() ? '56px' : '80px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <LoopsFeatureSection
          block={syncedBlock}
          textLayout="split"
          spotlight
          spotlightGlow={0}
        />
      </div>

      {/* 2x2 of concrete GitHub-in-Macro UI elements */}
      <GithubUiGrid />

      {/* Comparison */}
      <ComparisonSection />

      <HomeSectionRule />

      {/* Final CTA */}
      <div
        style={{
          'padding-block': mobile() ? '52px' : '68px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <GithubFinalCta />
      </div>

      {/* Divider + footer */}
      <div
        style={{
          'padding-bottom': mobile() ? '40px' : '48px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <SectionMoreFeatures currentPath="/github" footerOnly />
      </div>
    </div>
  );
};
