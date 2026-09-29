import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import inboxBgUrl from '../../../assets/graphics/inbox-bg.svg?url';
import IconAi from '../../../assets/icons/icon-ai.svg';
import IconCall from '../../../assets/icons/icon-call.svg';
import IconChannels from '../../../assets/icons/icon-channels.svg';
import IconCompany from '../../../assets/icons/icon-company.svg';
import IconEmail from '../../../assets/icons/icon-email.svg';
import IconFolder from '../../../assets/icons/icon-folder.svg';
import IconHome from '../../../assets/icons/icon-home.svg';
import IconInbox from '../../../assets/icons/icon-inbox.svg';
import IconPlus from '../../../assets/icons/icon-plus.svg';
import IconSearch from '../../../assets/icons/icon-search.svg';
import IconTasks from '../../../assets/icons/icon-tasks.svg';
import IconDotsThree from '../../../assets/icons/phosphor/dots-three-vertical.svg';
import IconFilePdf from '../../../assets/icons/phosphor/file-pdf.svg';
import IconSend from '../../../assets/icons/phosphor/paper-plane-tilt-fill.svg';
import IconX from '../../../assets/icons/phosphor/x.svg';
import IconTaskDone from '../../../assets/icons/square-task-done-circle.svg';
import IconTaskInProgress from '../../../assets/icons/square-task-in-progress-circle.svg';
import IconCalendarRow from '../../../assets/icons/wide-calendar.svg';
import IconChat from '../../../assets/icons/wide-chat.svg';
import IconEmailRow from '../../../assets/icons/wide-email.svg';
import IconDocMd from '../../../assets/icons/wide-file-md.svg';
import IconPriorityHigh from '../../../assets/icons/wide-priority-high.svg';
import IconPriorityLow from '../../../assets/icons/wide-priority-low.svg';
import IconPriorityMedium from '../../../assets/icons/wide-priority-medium.svg';
import avatarJacobPersonal from '../../../assets/people/jacob-personal.webp';
import avatarJacobVc from '../../../assets/people/jacob-vc.webp';
import avatarJacobWork from '../../../assets/people/jacob-work.webp';
import { isMobileViewport, viewportWidth } from '../../utils/utilBreakpoint';
import {
  CtaIcon,
  ctaHref,
  ctaLabel,
  handleCtaClick,
} from '../../utils/utilCta';
import { createVisible } from '../../utils/utilVisible';
import { AiComposeGraphic } from '../graphics/AiComposeGraphic';
import {
  CalendarIcon,
  CommandIcon,
  EnvelopeIcon,
  MagnifyingGlassIcon,
} from '../graphics/EmailListCardGraphic';
import { Cube, IsoFigure, Tile } from '../graphics/IsoLineArt';
import { MacroMarkIcon } from '../graphics/MacroMarkIcon';
import { TabsInset } from '../graphics/MockupChrome';
import { PreviewListDivider } from '../graphics/PreviewListDivider';
import { PreviewWindow } from '../graphics/PreviewWindow';
import { SsgDesktop, SsgMobile } from '../utils/SsgGate';

const _HERO_DEMO_VIDEO_ID = 'tnsxkywzTvY';

// ---------------------------------------------------------------------------
// Shared style fragments (matching the homepage / tasks bento language)
// ---------------------------------------------------------------------------

const mobile = isMobileViewport;

// Faux-app chrome uses a neutral UI sans so the mocks read as real product
// screenshots rather than marketing copy (the marketing type stays rajdhani /
// roboto-slab via the site's 'body' / 'display' families).
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Per-account accent dots reused across mocks (multi-inbox story).
const ACCOUNT_WORK = 'var(--a0)';
const ACCOUNT_PERSONAL = 'var(--a2)';
const ACCOUNT_THIRD = 'var(--a4)';

// Surface + stroke palette lifted verbatim from Multi-inbox.svg (the shared-
// accounts graphic) so the compose mockup shares its exact panel tone — a cool
// blue-black surface with grey strokes — rather than the neutral near-black it
// used before. Text and accent stay on the site's semantic vars (--c1/--c4 are
// already tonally matched to the SVG's #BFBFBF/#8B8B8B greys) for consistency.
const _INBOX_PANEL = {
  fill: '#070707', // card / window surface — neutral dark (was cool #060709)
  fillRaised: '#191919', // raised surface — neutral (was cool #16191F)
  stroke: '#353535', // panel + dropdown border
  strokeSoft: '#262626', // inner hairline dividers
};

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
  color?: string;
}): JSX.CSSProperties {
  const s = props.size ?? 16;
  return {
    color: props.color
      ? props.color
      : props.accent
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
  color?: string;
}) {
  const Icon = NAV_ICONS[props.name];
  if (!Icon) return null;
  return <Icon aria-hidden="true" style={navIconStyle(props)} />;
}

function Avatar(props: {
  initials: string;
  size?: number;
  color?: string;
  fontScale?: number;
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
        'font-size': `${Math.round(s * (props.fontScale ?? 0.38))}px`,
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
// Hero: realistic app window (email list + Ask-AI bar)
// ---------------------------------------------------------------------------

const emailTabs = ['Signal', 'Noise', 'All'];

interface HeroRow {
  who: string;
  subject: string;
  preview: string;
  time: string;
  account: string;
  // Date bucket the row belongs to. Rows are kept in descending date order so
  // each bucket stays contiguous and the list reads like Superhuman's
  // date-separated inbox.
  group: string;
  unread?: boolean;
  calendar?: boolean;
  noise?: boolean;
}

const heroRows: HeroRow[] = [
  // Today
  {
    who: 'Lena Hartwell',
    subject: 'Revised SOW before Thursday?',
    preview:
      'Legal signed off on the new terms. Can you send the updated version before the Thursday call so we can get it countersigned this week?',
    time: '10:33',
    account: ACCOUNT_WORK,
    group: 'Today',
    unread: true,
  },
  {
    who: 'Nina Castellano',
    subject: 'Design review for the new onboarding',
    preview:
      'Left notes in the Figma, mostly around the empty states and the second step, where the copy feels a little dense for first-time users.',
    time: '9:14',
    account: ACCOUNT_WORK,
    group: 'Today',
    unread: true,
  },
  // This week
  {
    who: 'Marco Delgado',
    subject: 'Invitation: Macro <> intro @ 11am',
    preview:
      'You have been invited to an event on Thu Jun 19, 2026 from 11:00–11:30am. Agenda and a short pre-read are attached for the team.',
    time: 'Jun 16',
    account: ACCOUNT_WORK,
    group: 'This week',
    calendar: true,
  },
  {
    who: 'Greg Sandoval',
    subject: 'Re: Zynoptes <> Macro follow up',
    preview:
      'We ran a preliminary scan on your repo and attached the .SARIF results. A couple of medium findings worth a look before we ship to production.',
    time: 'Jun 16',
    account: ACCOUNT_WORK,
    group: 'This week',
    noise: true,
  },
  {
    who: 'Ben Aldridge',
    subject: 'Re: Q3 roadmap draft',
    preview:
      'Thanks for putting this together. One thing on the timeline: can we pull the billing work forward a sprint so it lands before the launch freeze?',
    time: 'Jun 15',
    account: ACCOUNT_WORK,
    group: 'This week',
  },
  {
    who: 'Mom',
    subject: 'dinner sunday?',
    preview:
      "your sister is coming into town, thought we could all get together sunday evening if you're free. nothing fancy, maybe just pasta at the house.",
    time: 'Jun 14',
    account: ACCOUNT_PERSONAL,
    group: 'This week',
    unread: true,
  },
  {
    who: 'Ledgerly',
    subject: 'Your June payout is on the way',
    preview:
      '$24,310.55 will arrive in your account ending 4471 by Thursday, June 18. View the full breakdown and fee summary in your dashboard.',
    time: 'Jun 13',
    account: ACCOUNT_THIRD,
    group: 'This week',
    unread: true,
    noise: true,
  },
  // Earlier this month
  {
    who: 'Waypoint Receipts',
    subject: 'Your Wednesday evening trip with Waypoint',
    preview:
      "Thanks for riding. Total $18.40. Here's your receipt with the fare breakdown, tip, and the route you took on Wednesday evening.",
    time: 'Jun 10',
    account: ACCOUNT_PERSONAL,
    group: 'Earlier this month',
    noise: true,
  },
  {
    who: 'Claire Donovan',
    subject: 'Contract countersigned',
    preview:
      'Attaching the fully executed copy for your records. Thanks for the quick turnaround, and great working with you. Looking forward to next steps.',
    time: 'Jun 9',
    account: ACCOUNT_WORK,
    group: 'Earlier this month',
  },
  {
    who: 'Hannah Mercer',
    subject: 'Re: Letters to the kids at Summerfield',
    preview:
      "Hi fam! It's my annual plea for letters to the kids this summer at camp — even a quick postcard means the world to them, so please send something this week.",
    time: 'Jun 8',
    account: ACCOUNT_PERSONAL,
    group: 'Earlier this month',
  },
];

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

function EnvelopeGlyph(props: { calendar?: boolean }) {
  const Icon = props.calendar ? IconCalendarRow : IconEmailRow;
  return (
    <Icon
      aria-hidden="true"
      style={{
        color: 'var(--c4)',
        display: 'block',
        flex: 'none',
        height: '16px',
        width: '16px',
      }}
    />
  );
}

export function HeroAppWindow() {
  const [activeTab, setActiveTab] = createSignal(0);
  const [archived, setArchived] = createSignal<number[]>([]);
  const [selected, setSelected] = createSignal(0);
  const [_interacted, setInteracted] = createSignal(false);

  const matchesTab = (row: HeroRow) =>
    activeTab() === 2 ? true : activeTab() === 0 ? !row.noise : !!row.noise;
  const visibleRows = () =>
    heroRows
      .map((row, i) => ({ row, i }))
      .filter(({ i }) => !archived().includes(i))
      .filter(({ row }) => matchesTab(row));

  // Flatten the visible rows into a render list with date-group headers
  // injected whenever the bucket changes. `nav` keeps each row's index into
  // visibleRows() so J/K/E selection still lines up with the flat list.
  type HeroListItem =
    | { kind: 'header'; label: string }
    | { kind: 'row'; row: HeroRow; nav: number; lastInGroup: boolean };
  const groupedRows = (): HeroListItem[] => {
    const vis = visibleRows();
    const items: HeroListItem[] = [];
    vis.forEach((entry, nav) => {
      const prev = vis[nav - 1];
      if (!prev || prev.row.group !== entry.row.group) {
        items.push({ kind: 'header', label: entry.row.group });
      }
      const next = vis[nav + 1];
      items.push({
        kind: 'row',
        row: entry.row,
        nav,
        lastInGroup: !next || next.row.group !== entry.row.group,
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
    const rows = visibleRows();
    const target = rows[selected()];
    if (!target) return;
    setArchived((prev) => [...prev, target.i]);
    setSelected((s) => Math.max(0, Math.min(s, rows.length - 2)));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const rows = visibleRows();
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
      class="hero-app-window"
      mask="linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 66%, rgb(0 0 0 / 0.18) 100%)"
      interactive={{
        ariaLabel:
          'Interactive Macro inbox demo. Use J and K to navigate, E to archive.',
        onKeyDown,
      }}
    >
      <style>{`
          /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
             build-time prerender paints correctly on phones before the JS
             bundle loads. */
          .email-gfx-hero-toolbar { height: 46px; padding: 0 16px; }
          .email-gfx-hero-title { font-size: 14px; }
          .email-gfx-hero-compose { display: inline-flex; }
          .email-gfx-hero-rows { min-height: 247px; }
          .email-gfx-hero-empty { min-height: 247px; }
          .email-gfx-hero-row {
            gap: 11px;
            grid-template-columns: auto auto 136px minmax(0, 1fr) auto;
            padding: 11px 16px;
          }
          .email-gfx-hero-cell { font-size: 14px; }
          @media (max-width: 699px) {
            .email-gfx-hero-toolbar { height: 42px; padding: 0 13px; }
            .email-gfx-hero-title { font-size: 13px; }
            .email-gfx-hero-compose { display: none; }
            .email-gfx-hero-rows { min-height: 0; }
            .email-gfx-hero-empty { min-height: 120px; }
            .email-gfx-hero-row {
              gap: 9px;
              grid-template-columns: auto auto 92px minmax(0, 1fr) auto;
              padding: 10px 13px;
            }
            .email-gfx-hero-cell { font-size: 13px; }
            .email-gfx-hero-preview { display: none; }
          }
        `}</style>
      {/* Email pane */}
      <div
        style={{
          display: 'grid',
          'grid-template-rows': 'auto 1fr auto',
          'min-width': 0,
        }}
      >
        {/* Toolbar: title + tabs + actions */}
        <div
          class="email-gfx-hero-toolbar"
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--b4) 18%, transparent)',
            'box-sizing': 'border-box',
            display: 'flex',
            gap: '14px',
            overflow: 'hidden',
          }}
        >
          <span
            class="email-gfx-hero-title"
            style={{
              'align-items': 'center',
              // Bright, but not pure white (matches Linear's ~0.85 title gray).
              color: 'color-mix(in srgb, var(--c1) 55%, var(--c2))',
              display: 'inline-flex',
              'font-family': appFont,
              'font-weight': '550',
              gap: '6px',
            }}
          >
            Email
          </span>
          <SsgDesktop>
            <TabsInset
              tabs={emailTabs}
              active={activeTab()}
              onSelect={selectTab}
            />
          </SsgDesktop>
          <SsgMobile>
            <TabsInset
              tabs={emailTabs}
              active={activeTab()}
              onSelect={selectTab}
              compact
              compactMaxIndex={1}
            />
          </SsgMobile>
          <span
            style={{
              'align-items': 'center',
              color: 'var(--c2)',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '12.5px',
              gap: '6px',
              'margin-left': 'auto',
              padding: '5px 0',
              'white-space': 'nowrap',
            }}
          >
            All inboxes <ChevronGlyph size={11} />
          </span>
          {/* Inert chrome: rendered always, hidden on phones via the media-
                queried class so the prerender is correct on both. */}
          <span
            class="email-gfx-hero-compose"
            style={{
              'align-items': 'center',
              border:
                '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
              'border-radius': '7px',
              color: 'var(--c2)',
              'font-family': appFont,
              'font-size': '12.5px',
              gap: '5px',
              padding: '5px 10px',
              'white-space': 'nowrap',
            }}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 256 256"
              width="12"
              height="12"
              fill="currentColor"
              style={{ display: 'block', flex: 'none' }}
            >
              <path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z" />
            </svg>
            Compose
          </span>
        </div>

        {/* Rows */}
        <div
          class="hero-app-rows email-gfx-hero-rows"
          style={{
            display: 'grid',
            'align-content': 'start',
          }}
        >
          <Show
            when={visibleRows().length > 0}
            fallback={
              <div
                class="email-gfx-hero-empty"
                style={{
                  'align-items': 'center',
                  color: 'var(--c4)',
                  display: 'grid',
                  'font-family': appFont,
                  gap: '8px',
                  'justify-items': 'center',
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
                  Inbox zero
                </span>
                <span style={{ 'font-size': '13px' }}>
                  You've cleared this view.
                </span>
              </div>
            }
          >
            <For each={groupedRows()}>
              {(item) =>
                item.kind === 'header' ? (
                  <>
                    <SsgDesktop>
                      <PreviewListDivider label={item.label} />
                    </SsgDesktop>
                    <SsgMobile>
                      <PreviewListDivider label={item.label} compact />
                    </SsgMobile>
                  </>
                ) : (
                  <div
                    class="hero-row email-gfx-hero-row"
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
                      // Fixed name/subject columns (set in the CSS class) so
                      // they line up across rows — each row is its own grid,
                      // so auto tracks won't align.
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        'background-color': item.row.unread
                          ? 'var(--a0)'
                          : 'transparent',
                        'border-radius': '999px',
                        flex: 'none',
                        height: '7px',
                        width: '7px',
                      }}
                    />
                    <EnvelopeGlyph calendar={item.row.calendar} />
                    <span
                      class="email-gfx-hero-cell"
                      style={{
                        color: item.row.unread ? 'var(--c2)' : 'var(--c4)',
                        'font-family': appFont,
                        'font-weight': '400',
                        'min-width': 0,
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                      }}
                    >
                      {item.row.who}
                    </span>
                    {/* Subject never truncates; the preview flows inline right
                          after it and truncates to fill the remaining space. */}
                    <div
                      style={{
                        'align-items': 'baseline',
                        display: 'flex',
                        gap: '7px',
                        'min-width': 0,
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        class="email-gfx-hero-cell"
                        style={{
                          color: item.row.unread ? 'var(--c2)' : 'var(--c4)',
                          flex: 'none',
                          'font-family': appFont,
                          'font-weight': '400',
                          'white-space': 'nowrap',
                        }}
                      >
                        {item.row.subject}
                      </span>
                      {/* Inert text: rendered always, hidden on phones via
                            the media-queried class. */}
                      <span
                        class="email-gfx-hero-preview"
                        style={{
                          color:
                            'color-mix(in srgb, var(--c4) 66%, transparent)',
                          flex: '1 1 0',
                          'font-family': appFont,
                          'font-size': '14px',
                          'min-width': 0,
                          overflow: 'hidden',
                          'text-overflow': 'ellipsis',
                          'white-space': 'nowrap',
                        }}
                      >
                        {item.row.preview.replace(/[…\s]+$/u, '')}
                      </span>
                    </div>
                    <span
                      style={{
                        'align-items': 'center',
                        display: 'flex',
                        gap: '8px',
                      }}
                    >
                      <span
                        style={{
                          color: 'var(--c4)',
                          'font-family': appFont,
                          'font-size': '12px',
                          'white-space': 'nowrap',
                        }}
                      >
                        {item.row.time}
                      </span>
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
// Multi-inbox graphic: connected accounts -> one triage list
// ---------------------------------------------------------------------------

const connectedAccounts = [
  {
    photo: avatarJacobWork,
    name: 'jacob@macro.com',
    kind: 'Google Workspace',
    count: '3',
  },
  {
    photo: avatarJacobPersonal,
    name: 'jacob.personal@gmail.com',
    kind: 'Gmail · Personal',
    count: '2',
  },
  {
    photo: avatarJacobVc,
    name: 'jacob@founders.vc',
    kind: 'Gmail',
    count: '2',
  },
];

export function MultiInboxCard() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'background-color': '#0a0a0a',
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
          'border-bottom':
            '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          display: 'flex',
          gap: '8px',
          padding: '11px 14px',
        }}
      >
        <span
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': '13.5px',
            'font-weight': '600',
          }}
        >
          All inboxes
        </span>
        <ChevronGlyph size={11} />
        <span
          style={{
            color: 'var(--c4)',
            'font-family': appFont,
            'font-size': '12px',
            'margin-left': 'auto',
          }}
        >
          3 accounts · 7 in Signal
        </span>
      </div>
      <For each={connectedAccounts}>
        {(acct, i) => (
          <div
            style={{
              'align-items': 'center',
              'border-top':
                i() === 0
                  ? '0'
                  : '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
              display: 'flex',
              gap: '11px',
              padding: '11px 14px',
            }}
          >
            <img
              src={acct.photo}
              alt=""
              width="26"
              height="26"
              loading="lazy"
              style={{
                border:
                  '1px solid color-mix(in srgb, var(--c4) 14%, transparent)',
                'border-radius': '999px',
                'box-sizing': 'border-box',
                display: 'block',
                flex: 'none',
                height: '26px',
                'object-fit': 'cover',
                width: '26px',
              }}
            />
            <div style={{ display: 'grid', gap: '2px', 'min-width': 0 }}>
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': compact() ? '13px' : '14px',
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                }}
              >
                {acct.name}
              </span>
              <span
                style={{
                  'align-items': 'center',
                  color: 'var(--c4)',
                  display: 'flex',
                  'font-family': appFont,
                  'font-size': '11.5px',
                  gap: '6px',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    'background-color':
                      'color-mix(in srgb, var(--c4) 50%, transparent)',
                    'border-radius': '999px',
                    height: '6px',
                    width: '6px',
                  }}
                />{' '}
                {acct.kind}
              </span>
            </div>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '12px',
                'margin-left': 'auto',
              }}
            >
              {acct.count}
            </span>
            {/* Per-account options: color-code and disconnect collapse behind one menu affordance. */}
            <span
              role="img"
              aria-label="Account options"
              style={{
                'align-items': 'center',
                color: 'color-mix(in srgb, var(--c4) 70%, transparent)',
                display: 'inline-flex',
                flex: 'none',
                height: '22px',
                'justify-content': 'center',
                'margin-left': '4px',
                width: '22px',
              }}
            >
              <IconDotsThree
                aria-hidden="true"
                style={{
                  display: 'block',
                  flex: 'none',
                  height: '15px',
                  width: '15px',
                }}
              />
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

function MultiInboxGraphic() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '14px',
        padding: compact() ? '32px 18px' : '44px 24px',
        width: '100%',
        'max-width': '500px',
      }}
    >
      <MultiInboxCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compose + @mention graphic (typing + filtering + insertion animation)
// ---------------------------------------------------------------------------

// "ref" is an inline Macro-document reference (a live clickable link), distinct
// from "doc" (a file that becomes an attachment).
type ComposePill = {
  kind: 'person' | 'doc' | 'ref';
  label: string;
  initials?: string;
};
type ComposeFrame = {
  commit: (string | ComposePill)[];
  tail: string;
  recipients: ComposePill[];
};

const COMPOSE_RECIPIENT: ComposePill = {
  kind: 'person',
  label: 'Dana Whitfield',
  initials: 'DW',
};
const COMPOSE_PDF: ComposePill = { kind: 'doc', label: 'Pitch memo.pdf' };
const COMPOSE_DOC: ComposePill = { kind: 'ref', label: 'Q3 launch plan' };

// The app's per-kind object hues (--color-note / --color-pdf in the editor):
// the accent with its lightness and chroma kept, rotated to violet for a
// markdown doc and to red for a PDF. Same values ChannelsGraphics and
// DocsMarkdownScene use for docs.
const COMPOSE_HUE_DOC = 'oklch(from var(--a0) l c 293deg)';
const COMPOSE_HUE_PDF = 'oklch(from var(--a0) l c 25deg)';

/** `amount` is the entry ramp, 0..1, read off the scene's clock; omitted, the
 * pill is simply present. */
function ComposeInlinePill(props: {
  pill: ComposePill;
  recipient?: boolean;
  amount?: number;
}) {
  const entry = (): JSX.CSSProperties => {
    const a = props.amount;
    if (a === undefined || a >= 1) return {};
    return {
      opacity: a.toFixed(3),
      transform: `scale(${(0.7 + a * 0.3).toFixed(3)})`,
      'transform-origin': 'left center',
    };
  };
  // Recipient chips (the To field) are the real composer's: an 18px initials
  // avatar and a 13px name on a translucent var(--b3) pill. Inline body
  // @mentions match the real editor too: an accent @name pill for people and
  // an icon + underlined label for files (see UserMention / DocumentMention).
  if (props.recipient && props.pill.kind === 'person') {
    return (
      <span
        style={{
          'align-items': 'center',
          'background-color': 'color-mix(in srgb, var(--b3) 70%, transparent)',
          'border-radius': '999px',
          display: 'inline-flex',
          gap: '6px',
          // The avatar is the From row's 22px, capped by a 1px pill; the pill
          // is pulled back by that 1px so both avatars start at the same
          // distance from their label.
          'margin-left': '-1px',
          padding: '1px 9px 1px 1px',
          ...entry(),
        }}
      >
        <span
          aria-hidden="true"
          style={{
            'background-color': 'var(--b4)',
            border: '1px solid color-mix(in srgb, var(--c1) 16%, transparent)',
            'border-radius': '999px',
            'box-sizing': 'border-box',
            color: 'var(--c1)',
            display: 'inline-grid',
            flex: 'none',
            'font-family': appFont,
            'font-size': '8px',
            'font-weight': '600',
            height: '22px',
            overflow: 'hidden',
            'place-items': 'center',
            width: '22px',
          }}
        >
          {props.pill.initials ?? ''}
        </span>
        <span
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': '13px',
          }}
        >
          {props.pill.label}
        </span>
      </span>
    );
  }
  if (props.pill.kind === 'person') {
    return (
      <span
        style={{
          'background-color': 'color-mix(in oklab, var(--a0) 8%, transparent)',
          'border-radius': '6px',
          color: 'var(--a0)',
          display: 'inline-block',
          'font-family': appFont,
          // An inline-block's box is its line box, so on the body's 1.7
          // measure the highlight would stand 24px plus padding; tightened
          // to hug the glyphs instead.
          'line-height': 1.35,
          padding: '0 3px',
          'vertical-align': 'baseline',
          'white-space': 'nowrap',
          ...entry(),
        }}
      >
        @{props.pill.label}
      </span>
    );
  }
  // Inline document reference and file attachment — identical treatment to the
  // interactive hero mockup's mention chips: a 16px accent file icon plus an
  // underlined label, no pill background.
  const FileIcon = props.pill.kind === 'ref' ? IconDocMd : IconFilePdf;
  return (
    <span
      style={{
        display: 'inline-block',
        'vertical-align': 'baseline',
        'white-space': 'nowrap',
        ...entry(),
      }}
    >
      <span
        aria-hidden="true"
        style={{
          color: props.pill.kind === 'ref' ? COMPOSE_HUE_DOC : COMPOSE_HUE_PDF,
          display: 'inline-flex',
          margin: '0 3px 0 1px',
          'vertical-align': '-0.22em',
        }}
      >
        <FileIcon style={{ display: 'block', height: '16px', width: '16px' }} />
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
        {props.pill.label}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The compose demo's clock
//
// Rebuilt from a setTimeout flipbook into the shape the other two animated
// scenes on this site use (sections/TasksLifecycleScene.tsx and
// featureGraphics/DocsMarkdownScene.tsx): the scene is a pure function of `t`,
// milliseconds into CYCLE, and one requestAnimationFrame in the owner below
// advances it. What that buys, in the order it matters here:
//
//   - It holds the finished message when it is not being watched. The old
//     version seeded the signal with COMPOSE_STATIC for the prerender and then
//     called tick() synchronously in onMount, so every visitor watched the
//     message appear and vanish on hydration.
//   - It stops when it is off screen. The old timer ran for the life of the
//     page, about seventeen wakeups a second, each re-rendering two <For>s.
//   - It honours prefers-reduced-motion, which the old typing ignored --
//     only the pill pop-in was covered, and that was CSS.
//
// The pills also come off CSS and onto the clock for the same reason the tasks
// scene gives at its own flip: a CSS animation fires on node creation, so it
// cannot be seeked and it replays wrongly on a wrap.
// ---------------------------------------------------------------------------

/** Per character of body text. */
const COMPOSE_TYPE_MS = 42;
/** The beat before a mention resolves, and the pause after it lands. */
const COMPOSE_BEAT_MS = 180;
const COMPOSE_SETTLE_MS = 260;
/** How long a pill takes to ease in. Was the .compose-fill keyframe's 260ms. */
const COMPOSE_PILL_MS = 260;
/** Before the first keystroke, and on the finished message. */
const COMPOSE_LEAD_MS = 500;
const COMPOSE_HOLD_MS = 1300;
/**
 * How it starts over. The old version backspaced all sixty-four characters and
 * three pills at 20ms each -- a rewind that was 28% of the cycle and read as
 * the demo being undone. A composer has a send button drawn on it already, so
 * it sends instead: the glyph pulses, the card empties, and the empty card is
 * exactly what it is at t=0, so the wrap needs nothing to hide it.
 */
const COMPOSE_SEND_MS = 360;
/** The card empties on one frame at COMPOSE_TL.clear, so what follows is just
    how long it stands empty before the first keystroke of the next pass. */
const COMPOSE_BLANK_MS = 880;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const composeEase = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
/** How many stamps in a table have landed. */
const countAt = (stamps: number[], now: number) => {
  let n = 0;
  while (n < stamps.length && stamps[n] <= now) n++;
  return n;
};

/**
 * One timestamp per character. A flat cadence reads as a machine; deterministic
 * jitter, a longer beat on a space and longer still after a full stop read as a
 * person -- and being a table it costs the same to seek into as to play
 * through. Lifted from TasksLifecycleScene's CHAR_AT.
 */
function composeStamps(text: string, from: number): number[] {
  const out: number[] = [];
  let acc = from;
  for (let i = 0; i < text.length; i++) {
    let d =
      COMPOSE_TYPE_MS + (((i * 7919) % 11) - 5) * (COMPOSE_TYPE_MS * 0.055);
    if (text[i] === ' ') d += COMPOSE_TYPE_MS * 0.85;
    if (i > 0 && text[i - 1] === '.') d += COMPOSE_TYPE_MS * 5;
    acc += d;
    out.push(acc);
  }
  return out;
}

type ComposePlanPart =
  | { k: 'text'; text: string; at: number[] }
  | { k: 'pill'; pill: ComposePill; at: number };

/** When each pill lands, by identity -- the three are module singletons. */
const COMPOSE_PILL_AT = new Map<ComposePill, number>();

const COMPOSE_PLAN: ComposePlanPart[] = (() => {
  const out: ComposePlanPart[] = [];
  let now = COMPOSE_LEAD_MS;
  const type = (text: string) => {
    const at = composeStamps(text, now);
    now = at.length ? at[at.length - 1] : now;
    out.push({ k: 'text', text, at });
  };
  const mention = (pill: ComposePill) => {
    now += COMPOSE_BEAT_MS;
    COMPOSE_PILL_AT.set(pill, now);
    out.push({ k: 'pill', pill, at: now });
    now += COMPOSE_SETTLE_MS;
  };
  type('Hey ');
  mention(COMPOSE_RECIPIENT);
  type(', sharing two things ahead of the Thursday call: the ');
  mention(COMPOSE_DOC);
  type(' and ');
  mention(COMPOSE_PDF);
  type('.');
  return out;
})();

const COMPOSE_TYPED_END = (() => {
  const last = COMPOSE_PLAN[COMPOSE_PLAN.length - 1];
  return last.k === 'text' ? last.at[last.at.length - 1] : last.at;
})();

const COMPOSE_TL = {
  /** The send glyph pulses; on the far side of it the card is empty. */
  send: COMPOSE_TYPED_END + COMPOSE_HOLD_MS,
  clear: COMPOSE_TYPED_END + COMPOSE_HOLD_MS + COMPOSE_SEND_MS,
} as const;

export const COMPOSE_CYCLE = COMPOSE_TL.clear + COMPOSE_BLANK_MS;
/**
 * The frame the server paints, the frame a reduced-motion visitor holds, and
 * the frame the card sits on until it is actually scrolled to: the finished
 * message, so every word of the copy is in the static HTML.
 */
export const COMPOSE_REST_T = COMPOSE_TYPED_END + 400;

/** The whole composer state at a moment, derived rather than stored. */
function composeFrameAt(now: number): ComposeFrame {
  if (now >= COMPOSE_TL.clear) {
    return { commit: [], tail: '', recipients: [] };
  }
  const commit: (string | ComposePill)[] = [];
  const recipients: ComposePill[] = [];
  let tail = '';
  for (const part of COMPOSE_PLAN) {
    if (part.k === 'pill') {
      if (now < part.at) break;
      commit.push(part.pill);
      if (part.pill.kind === 'person') recipients.push(part.pill);
      continue;
    }
    const n = countAt(part.at, now);
    if (n < part.text.length) {
      tail = part.text.slice(0, n);
      break;
    }
    commit.push(part.text);
  }
  return { commit, tail, recipients };
}

/** A pill's entry ramp, 0..1, off the clock rather than off node creation. */
const composePillAmount = (pill: ComposePill, now: number) => {
  const at = COMPOSE_PILL_AT.get(pill);
  if (at === undefined) return 1;
  return composeEase(clamp01((now - at) / COMPOSE_PILL_MS));
};

/** Inner hairlines: a hair above the card's own surface, not a ruled line. */
const COMPOSE_HAIRLINE = 'color-mix(in srgb, var(--c1) 5%, transparent)';

function ComposeMentionScene(props: { t: Accessor<number> }) {
  const t = props.t;
  const frame = createMemo(() => composeFrameAt(t()));
  /** The send press, as a pulse on the glyph that is already drawn there. */
  const sendPulse = () => {
    const k = clamp01((t() - COMPOSE_TL.send) / COMPOSE_SEND_MS);
    return k > 0 && k < 1 ? Math.sin(k * Math.PI) : 0;
  };

  // Viewport-dependent padding lives in the email-gfx-compose-field class (not
  // a JS ternary) so the prerender paints correctly on phones.
  const fieldRow: JSX.CSSProperties = {
    'align-items': 'center',
    'border-bottom': `1px solid ${COMPOSE_HAIRLINE}`,
    display: 'flex',
    flex: '0 0 auto',
    gap: '10px',
    'min-height': '21px',
  };
  // The To row reserves the chip's exact 24px (22px avatar in 1px pads) in
  // both states so the rows below never move when the placeholder gives way
  // to the chip. Whole pixels on purpose: the page renders at zoom 1.1, and a
  // half-pixel row shifts on rounding. A separate object rather than a spread
  // with an override in the JSX: the compiler applied the literal key before
  // the spread, so fieldRow's 21px won.
  const toRow: JSX.CSSProperties = { ...fieldRow, 'min-height': '24px' };
  // No fixed label width: each value sits the row's 10px gap from its own key
  // rather than the three values sharing a left edge.
  const labelStyle: JSX.CSSProperties = {
    color: 'var(--c4)',
    flex: 'none',
    'font-family': appFont,
    'font-size': '13px',
  };

  return (
    <div
      class="email-gfx-compose-wrap"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        width: '100%',
      }}
    >
      <style>{`
        /* The caret is the one thing here that is not on the clock: its
           phase should follow the wall clock rather than restart every time
           the loop wraps. Defined locally because the rule this markup used
           to borrow is unreachable from either page this graphic appears on:
           SceneAppPreview is not mounted on home or /email at all, and
           SectionFeatureGrid's copy sits inside a Show that is closed for the
           part= the home page asks for. The caret never actually blinked. */
        .email-gfx-caret { background-color: var(--c1); }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes emailGfxCaret { 0%, 52% { opacity: 1; } 53%, 100% { opacity: 0; } }
          .email-gfx-caret { animation: emailGfxCaret 1.08s steps(1) infinite; }
        }
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           build-time prerender paints correctly on phones before the JS
           bundle loads. */
        /*
         * Surface, strokes, spacing and type are the real editor's, measured
         * off the live-editor iframe this card replaced on the home page
         * (public/live-editor at c354414, ?mode=email): Inter 400 with
         * grayscale smoothing, 12px 16px rows on a var(--b2) hairline, a
         * 14px/1.7 body padded 14px 16px, and a 430px box with no outer
         * padding -- the iframe's wrapper had none, so the card ran the full
         * 460px of its column.
         */
        .email-gfx-compose-wrap {
          padding: 0;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        .email-gfx-compose-card {
          display: flex;
          flex-direction: column;
          height: 430px;
          /* The editor inherits Tailwind's html line-height; every 13px and
             14px run in the chrome sits on it (19.5px / 21px boxes). */
          line-height: 1.5;
        }
        .email-gfx-compose-header { padding: 9px 14px; }
        .email-gfx-compose-field { padding: 12px 16px; }
        .email-gfx-compose-text { font-size: 14px; }
        .email-gfx-compose-body {
          flex: 1 1 auto;
          min-height: 0;
          padding: 14px 16px;
        }
        @media (max-width: 699px) {
          .email-gfx-compose-wrap { padding: 32px 0; }
          .email-gfx-compose-card { height: auto; }
          .email-gfx-compose-header { padding: 8px 12px; }
          .email-gfx-compose-field { padding: 11px 14px; }
          .email-gfx-compose-text { font-size: 13px; }
          .email-gfx-compose-body {
            min-height: 116px;
            padding: 14px 14px 12px;
          }
        }
      `}</style>
      <div
        class="email-gfx-compose-card"
        style={{
          // The live editor's own surface and the wrapper stroke
          // ComposeMentionLive drew around it, not the INBOX_PANEL greys.
          'background-color': 'color-mix(in srgb, var(--b1) 70%, var(--b0))',
          border: '1px solid color-mix(in srgb, var(--c4) 9%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          position: 'relative',
          width: 'min(460px, 100%)',
        }}
      >
        {/* Compose header bar — close (left) + send (right) */}
        <div
          class="email-gfx-compose-header"
          style={{
            'align-items': 'center',
            'border-bottom': `1px solid ${COMPOSE_HAIRLINE}`,
            display: 'flex',
            'justify-content': 'space-between',
          }}
        >
          <IconX
            style={{
              color: 'var(--c4)',
              display: 'block',
              height: '15px',
              width: '15px',
            }}
          />
          <IconSend
            style={{
              color: 'var(--a0)',
              display: 'block',
              height: '16px',
              transform: `scale(${(1 - sendPulse() * 0.22).toFixed(3)})`,
              width: '16px',
            }}
          />
        </div>
        {/* From */}
        <div class="email-gfx-compose-field" style={fieldRow}>
          <span style={labelStyle}>From</span>
          <img
            src={avatarJacobWork}
            alt=""
            width="22"
            height="22"
            loading="lazy"
            style={{
              border:
                '1px solid color-mix(in srgb, var(--c1) 16%, transparent)',
              'border-radius': '999px',
              'box-sizing': 'border-box',
              display: 'block',
              flex: 'none',
              height: '22px',
              'object-fit': 'cover',
              width: '22px',
            }}
          />
          <span
            class="email-gfx-compose-text"
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
            }}
          >
            Jacob Beckerman
          </span>
          <ChevronGlyph size={11} />
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '13px',
              'margin-left': 'auto',
            }}
          >
            Cc Bcc
          </span>
        </div>
        {/* To / recipients */}
        <div class="email-gfx-compose-field" style={toRow}>
          <span style={labelStyle}>To</span>
          <Show
            when={frame().recipients.length > 0}
            fallback={
              <span
                class="email-gfx-compose-text"
                style={{
                  color: 'var(--b4)',
                  'font-family': appFont,
                }}
              >
                Recipients
              </span>
            }
          >
            <For each={frame().recipients}>
              {(r) => (
                <ComposeInlinePill
                  pill={r}
                  recipient
                  amount={composePillAmount(r, t())}
                />
              )}
            </For>
          </Show>
        </div>
        {/* Subject */}
        <div class="email-gfx-compose-field" style={fieldRow}>
          <span style={labelStyle}>Subject</span>
          <span
            class="email-gfx-compose-text"
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
            }}
          >
            Pitch memo: follow up
          </span>
        </div>
        {/* Body with @ */}
        <div
          class="email-gfx-compose-body"
          style={{
            'box-sizing': 'border-box',
            position: 'relative',
          }}
        >
          {/* The editor's paragraph: first:mt-1.5 / last:mb-1.5 on a 14px/1.7
              measure, in --color-ink (c0). */}
          <span
            class="email-gfx-compose-text"
            style={{
              color: 'var(--c0)',
              display: 'block',
              'font-family': appFont,
              'line-height': 1.7,
              margin: '6px 0',
              'white-space': 'pre-wrap',
            }}
          >
            <For each={frame().commit}>
              {(seg) =>
                typeof seg === 'string' ? (
                  <span>{seg}</span>
                ) : (
                  <ComposeInlinePill
                    pill={seg}
                    amount={composePillAmount(seg, t())}
                  />
                )
              }
            </For>
            {frame().tail}
            <span
              aria-hidden="true"
              class="email-gfx-caret"
              style={{
                'background-color': 'var(--c1)',
                display: 'inline-block',
                height: '15px',
                'margin-left': '1px',
                'vertical-align': 'middle',
                width: '1.5px',
              }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Advances the compose scene's clock with a single requestAnimationFrame
 * accumulating real dt, and only while the card is on screen. The same owner
 * DocsMarkdownGraphic uses, for the same reasons written out there.
 *
 * Reduced motion holds on COMPOSE_REST_T -- the finished message -- and never
 * starts the loop. That is also the frame the prerender paints and the frame
 * the card holds until it is actually reached, so the copy is in the static
 * HTML and a card below the fold is never seen to appear and vanish. A card
 * already within createVisible's 160px margin at load does start from the top,
 * which is the intent: it is on screen, so it should play.
 */
export function ComposeMentionGraphic() {
  const [t, setT] = createSignal(COMPOSE_REST_T);
  let frameEl: HTMLDivElement | undefined;

  const visible = createVisible(() => frameEl, '160px');
  const reduce = () =>
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [running, setRunning] = createSignal(false);

  // The loop exists only while it is running, so scrolling the card away
  // cancels the rAF outright and coming back re-seeds `last` -- otherwise the
  // first frame back would bill the whole idle interval to a single step.
  createEffect(() => {
    // Two guards, not one. Folded together, a visitor who turns Reduce Motion
    // on mid-session and then scrolls the card away and back re-runs this
    // effect, returns before scheduling a frame, and leaves `t` frozen
    // wherever it happened to stop -- which for about a fifth of the cycle is
    // an empty composer. Pinning the rest frame is what the docblock promises.
    if (reduce()) {
      setT(COMPOSE_REST_T);
      return;
    }
    if (!visible()) return;
    // Start from the top the first time the card is actually reached, rather
    // than from the resting frame the server painted.
    if (!untrack(running)) {
      setRunning(true);
      setT(0);
    }
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      // Clamp dt: the first frame after mount, and the first after a
      // backgrounded tab resumes firing rAF, can carry hundreds of ms.
      const dt = Math.min(now - last, 64);
      last = now;
      const raw = untrack(t) + dt;
      setT(raw >= COMPOSE_CYCLE ? raw - COMPOSE_CYCLE : raw);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return (
    <div
      ref={frameEl}
      role="img"
      aria-label="A Macro email being composed: typing an @mention adds Dana Whitfield to the recipients, and two more @mentions attach a document and a PDF inline, before the message is sent."
    >
      <ComposeMentionScene t={t} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison table
// ---------------------------------------------------------------------------

type Cell = boolean | 'partial' | string;

const comparisonColumns = ['Macro', 'Superhuman', 'Outlook', 'Gmail'];

const comparisonRows: { feature: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  {
    feature: 'Multiple accounts in one inbox',
    cells: [true, true, 'partial', 'partial'],
  },
  {
    feature: 'Email, chat & tasks in one place',
    cells: [true, false, 'partial', false],
  },
  {
    feature: 'AI separates signal from noise',
    cells: [true, 'partial', 'partial', 'partial'],
  },
  { feature: 'Keyboard-first, sub-100ms', cells: [true, true, false, false] },
  { feature: 'Send later & snooze', cells: [true, true, true, 'partial'] },
  {
    feature: '@mention docs, people & tasks',
    cells: [true, false, false, false],
  },
  { feature: 'Shared team memory', cells: [true, false, false, false] },
  {
    feature: 'Agents draft & send for you',
    cells: [true, false, false, false],
  },
  { feature: 'Open source', cells: [true, false, false, false] },
  { feature: 'Price / seat / month', cells: ['$40', '$30', '$13', '$7'] },
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
  // 'partial' is a string too, so test it before the generic price-text branch.
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
  const softBorder = 'color-mix(in srgb, var(--b4) 14%, transparent)';
  const macroBorder = 'color-mix(in srgb, var(--a0) 26%, transparent)';
  const gridTemplate = () =>
    mobile()
      ? 'minmax(132px, 1.4fr) repeat(4, minmax(58px, 1fr))'
      : 'minmax(0, 2.2fr) minmax(0, 1.1fr) repeat(3, minmax(0, 1fr))';

  const headerCellStyle = (macro: boolean): JSX.CSSProperties => ({
    'align-items': 'center',
    'background-color': macro
      ? 'color-mix(in srgb, var(--a0) 11%, transparent)'
      : 'transparent',
    color: macro ? 'var(--a0)' : 'var(--c2)',
    display: 'flex',
    'font-family': 'rajdhani, body',
    'font-size': mobile() ? '12px' : '15px',
    'font-weight': '700',
    'justify-content': 'center',
    'letter-spacing': '0.06em',
    'line-height': 1.1,
    padding: mobile() ? '15px 6px' : '18px 12px',
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
          'background-color': 'color-mix(in srgb, var(--b1) 28%, var(--b0))',
          border: `1px solid ${softBorder}`,
          'border-radius': mobile() ? '16px' : '20px',
          'box-shadow': 'var(--shadow-panel-sm)',
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': gridTemplate(),
          'min-width': mobile() ? '480px' : 'auto',
          overflow: 'hidden',
        }}
      >
        <div style={{ 'border-bottom': `1px solid ${softBorder}` }} />
        <For each={comparisonColumns}>
          {(col, index) => (
            <div
              style={{
                ...headerCellStyle(index() === 0),
                'border-bottom':
                  index() === 0
                    ? '1px solid color-mix(in srgb, var(--a0) 50%, transparent)'
                    : `1px solid ${softBorder}`,
              }}
            >
              {col}
            </div>
          )}
        </For>

        <For each={comparisonRows}>
          {(row, rowIndex) => {
            const lastRow = rowIndex() === comparisonRows.length - 1;
            return (
              <>
                <div
                  style={{
                    'align-items': 'center',
                    'background-color':
                      'color-mix(in srgb, var(--b1) 28%, var(--b0))',
                    'border-bottom': lastRow ? '0' : `1px solid ${softBorder}`,
                    color: 'var(--c2)',
                    display: 'flex',
                    'font-family': 'body',
                    'font-size': mobile() ? '13px' : '16px',
                    'font-weight': '600',
                    'line-height': 1.3,
                    padding: mobile() ? '14px 12px 14px 16px' : '16px 22px',
                    position: mobile() ? 'sticky' : 'static',
                    left: mobile() ? '0' : 'auto',
                    'z-index': mobile() ? 1 : 'auto',
                  }}
                >
                  {row.feature}
                </div>
                <For each={row.cells}>
                  {(cell, cellIndex) => {
                    const macro = cellIndex() === 0;
                    return (
                      <div
                        style={{
                          'align-items': 'center',
                          'background-color': macro
                            ? 'color-mix(in srgb, var(--a0) 6%, transparent)'
                            : 'transparent',
                          'border-bottom': lastRow
                            ? '0'
                            : `1px solid ${softBorder}`,
                          'border-left': macro
                            ? `1px solid ${macroBorder}`
                            : '0',
                          'border-right': macro
                            ? `1px solid ${macroBorder}`
                            : '0',
                          display: 'flex',
                          'justify-content': 'center',
                          padding: mobile() ? '14px 6px' : '16px 12px',
                        }}
                      >
                        <ComparisonCell value={cell} macro={macro} />
                      </div>
                    );
                  }}
                </For>
              </>
            );
          }}
        </For>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Primary CTA — matches the home-page "Get started" button.
// ---------------------------------------------------------------------------

function _PrimaryCta(props: { buttonName: string; label?: string }) {
  return (
    <a
      href={ctaHref()}
      class="email-cta-button"
      onClick={(event) => handleCtaClick(event, props.buttonName)}
      style={{
        'align-items': 'center',
        'background-color': 'var(--c1)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--b0)',
        cursor: 'default',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': mobile() ? '16px' : '17px',
        'font-weight': '700',
        gap: '8px',
        height: mobile() ? '46px' : '48px',
        'justify-content': 'center',
        'letter-spacing': '0.01em',
        'line-height': 1,
        padding: '0 28px',
        'text-decoration': 'none',
        transition: 'transform 160ms ease',
        'white-space': 'nowrap',
      }}
    >
      <CtaIcon size={16} opacity={0.9} />
      {ctaLabel(props.label ?? 'Get started')}
    </a>
  );
}

// ---------------------------------------------------------------------------
// "Main selling points" — three pillars with animated isometric line art
// (mirrors SectionHomeIntro, adapted to the email story).
// ---------------------------------------------------------------------------

const emailIntroMotion = `
  @keyframes emFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes emKeyPress { 0%, 66%, 100% { transform: translateY(0); } 82% { transform: translateY(2px); } }
  .em-float { animation: emFloat 5s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  .em-key { animation: emKeyPress 2.8s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  @media (prefers-reduced-motion: reduce) { .em-float, .em-key { animation: none; } }
`;

function FigInboxes(props: { height: string }) {
  return (
    <IsoFigure height={props.height} strokeWidth={1.35}>
      <g class="em-float" style={{ 'animation-delay': '-0.2s' }}>
        <Tile cx={70} cy={92} w={38} t={7} />
      </g>
      <g class="em-float" style={{ 'animation-delay': '-1.6s' }}>
        <Tile cx={70} cy={64} w={38} t={7} />
      </g>
      <g class="em-float" style={{ 'animation-delay': '-3.0s' }}>
        <Tile cx={70} cy={36} w={38} t={7} />
      </g>
    </IsoFigure>
  );
}

function FigUnified(props: { height: string }) {
  const blocks = [
    { cx: 70, cy: 40, w: 20, h: 22, delay: '-0.3s' },
    { cx: 50, cy: 66, w: 18, h: 20, delay: '-1.9s' },
    { cx: 90, cy: 66, w: 18, h: 20, delay: '-1.0s' },
  ];
  return (
    <IsoFigure height={props.height} strokeWidth={1.35}>
      <Tile cx={70} cy={96} w={50} t={6} />
      <For each={blocks}>
        {(b) => (
          <g class="em-float" style={{ 'animation-delay': b.delay }}>
            <Cube cx={b.cx} cy={b.cy} w={b.w} h={b.h} />
          </g>
        )}
      </For>
    </IsoFigure>
  );
}

function FigKeys(props: { height: string }) {
  const cols = 5;
  const rows = 3;
  const step = 10;
  const originX = 40;
  const originY = 40;
  const keys: { cx: number; cy: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      keys.push({
        cx: originX + step * (c + r),
        cy: originY + (step / 2) * (c - r),
      });
    }
  }
  keys.sort((a, b) => a.cy - b.cy);
  return (
    <IsoFigure height={props.height} strokeWidth={1.35}>
      <Tile cx={70} cy={74} w={56} t={5} />
      <For each={keys}>
        {(key, i) => (
          <g class={i() === 7 ? 'em-key' : undefined}>
            <Cube cx={key.cx} cy={key.cy} w={3.4} h={4} />
          </g>
        )}
      </For>
      <Cube cx={70} cy={66} w={12} h={3.5} />
    </IsoFigure>
  );
}

const emailPillars: {
  fig: string;
  title: string;
  body: string;
  Graphic: (props: { height: string }) => JSX.Element;
}[] = [
  {
    fig: 'Fig 01',
    title: 'All your inboxes',
    body: 'Gmail and Outlook, work and personal — every account triaged together in one fast, unified list.',
    Graphic: FigInboxes,
  },
  {
    fig: 'Fig 02',
    title: 'Not just email',
    body: 'Messages, @mentions, and agent tasks land in the same inbox, so nothing is stranded in another app.',
    Graphic: FigUnified,
  },
  {
    fig: 'Fig 03',
    title: 'Keyboard-first',
    body: 'Every action is a single keystroke, sub-100ms. Triage hundreds of emails without touching the mouse.',
    Graphic: FigKeys,
  },
];

function _EmailIntro() {
  const compact = () => mobile();
  const stacked = () => viewportWidth() < 820;
  const figureHeight = () => (compact() ? '150px' : '168px');
  const figureArea = () => (compact() ? '168px' : '186px');

  return (
    <section
      aria-label="Why Macro Mail"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: compact() ? '40px' : '56px',
        padding: '0',
        width: '100%',
      }}
    >
      <style>{emailIntroMotion}</style>
      <h2
        style={{
          'font-family': 'display',
          'font-size': compact() ? '28px' : 'clamp(32px, 4vw, 46px)',
          'font-weight': '420',
          'letter-spacing': '-0.015em',
          'line-height': 1.14,
          margin: '0',
          'max-width': '920px',
        }}
      >
        <span style={{ color: 'var(--c1)' }}>One inbox</span>{' '}
        <span style={{ color: 'var(--c4)' }}>
          for email, messages, @mentions, and tasks — with AI that sorts signal
          from noise.
        </span>
      </h2>

      <div
        style={{
          color: 'color-mix(in srgb, var(--a0) 34%, transparent)',
          display: 'grid',
          gap: stacked() ? '44px' : '0',
          'grid-template-columns': stacked()
            ? '1fr'
            : 'repeat(3, minmax(0, 1fr))',
          width: '100%',
        }}
      >
        <For each={emailPillars}>
          {(pillar, index) => (
            <div
              style={{
                'border-left':
                  !stacked() && index() > 0
                    ? '1px solid color-mix(in srgb, var(--b4) 20%, transparent)'
                    : 'none',
                'align-content': 'start',
                'box-sizing': 'border-box',
                display: 'grid',
                gap: compact() ? '20px' : '28px',
                padding: stacked()
                  ? '0'
                  : index() === 0
                    ? '0 38px 0 0'
                    : '0 38px',
              }}
            >
              <span
                style={{
                  color: 'color-mix(in srgb, var(--c4) 60%, transparent)',
                  'font-family': 'rajdhani, body',
                  'font-size': compact() ? '11px' : '12px',
                  'font-weight': '700',
                  'letter-spacing': '0.14em',
                  'text-transform': 'uppercase',
                }}
              >
                {pillar.fig}
              </span>
              <div
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  height: figureArea(),
                  'justify-content': 'center',
                  width: '100%',
                }}
              >
                <pillar.Graphic height={figureHeight()} />
              </div>
              <div style={{ display: 'grid', gap: compact() ? '8px' : '10px' }}>
                <h3
                  style={{
                    color: 'var(--c2)',
                    'font-family': 'body',
                    'font-size': compact() ? '14px' : '15px',
                    'font-weight': '700',
                    'letter-spacing': '0.07em',
                    'line-height': 1.2,
                    margin: '0',
                    'text-transform': 'uppercase',
                  }}
                >
                  {pillar.title}
                </h3>
                <p
                  style={{
                    color: 'var(--c4)',
                    'font-family': 'body',
                    'font-size': compact() ? '15px' : '16px',
                    'font-weight': '600',
                    'line-height': 1.5,
                    margin: '0',
                    'max-width': '360px',
                  }}
                >
                  {pillar.body}
                </p>
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Multi-inbox — spotlight: the full inbox dimmed behind, the account selector
// lifted and spotlit in front (mirrors the home-page email block).
// ---------------------------------------------------------------------------

export function MultiInboxSpotlight() {
  const compact = () => mobile();
  return (
    <Show when={!compact()} fallback={<MultiInboxGraphic />}>
      <div style={{ position: 'relative', width: '100%' }}>
        <div
          aria-hidden="true"
          style={{
            filter: 'saturate(0.85)',
            'mask-image':
              'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
            '-webkit-mask-image':
              'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
            opacity: '0.42',
            'pointer-events': 'none',
          }}
        >
          <HeroAppWindow />
        </div>
        <div
          style={{
            'align-items': 'center',
            display: 'grid',
            inset: '0',
            'justify-items': 'start',
            position: 'absolute',
          }}
        >
          <div
            style={{
              'max-width': '420px',
              'padding-left': '3%',
              position: 'relative',
              width: '100%',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                background:
                  'radial-gradient(70% 70% at 50% 50%, color-mix(in srgb, var(--b1) 40%, var(--ambient-ink) 12%) 0%, transparent 72%)',
                inset: '-16% -12%',
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
              <MultiInboxCard />
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Email, messages & mentions in one — a faithful recreation of the real Macro
// unified inbox (modeled on js/app .../list-entity wide-layout). A full-width
// background pane that cycles a light-gray rounded selection through the rows.
// ---------------------------------------------------------------------------

const SUCCESS = 'oklch(0.7 0.16 162)';
const FAILURE = 'oklch(0.64 0.21 25)';

function AtGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <circle
        cx="12"
        cy="12"
        r="3.3"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <path
        d="M15.3 12c0 1.9 1 2.9 2.1 2.9 1.5 0 2.4-1.5 2.4-3.3A8 8 0 1 0 15 18.7"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  );
}

function PrGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <circle cx="6.5" cy="6" r="2.3" />
      <circle cx="6.5" cy="18" r="2.3" />
      <path d="M6.5 8.3v7.4" />
      <circle cx="17.5" cy="18" r="2.3" />
      <path d="M17.5 15.7V11a3 3 0 0 0-3-3h-3.5" />
      <path d="M13 6l-2 2 2 2" />
    </svg>
  );
}

function MiniCheck(props: { color?: string }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M5 12.5l4.5 4.5L19 6.5"
        stroke={props.color ?? 'currentColor'}
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function PriorityGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <rect x="3" y="14" width="4" height="6" rx="1" />
      <rect x="10" y="9" width="4" height="11" rx="1" opacity="0.55" />
      <rect x="17" y="4" width="4" height="16" rx="1" opacity="0.3" />
    </svg>
  );
}

function ChatGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path d="M4 5.5h16v10H9l-4 3v-3H4z" />
    </svg>
  );
}

type InboxKind =
  | 'email'
  | 'calendar'
  | 'message'
  | 'mention'
  | 'task'
  | 'pr'
  | 'ai';
type InboxHeaderIcon = 'channel' | 'folder' | 'doc';

type InboxRowData = {
  kind: InboxKind;
  unread?: boolean;
  /** Sender / channel (left, bold) — or the full title for task/pr/ai. */
  primary: string;
  /** Muted connector before boldSecondary, e.g. "mentioned you in". */
  lead?: string;
  /** Bright part of the preview (subject / doc name). */
  boldSecondary?: string;
  /** Muted preview / message text. */
  secondary?: string;
  /** primary is the wide title that fills the row (task / pr / ai). */
  wideTitle?: boolean;
  time: string;
  prAdds?: number;
  prDels?: number;
  prComments?: number;
  prOk?: boolean;
  status?: string;
  priority?: string;
  assignee?: string;
};

type InboxItem =
  | { kind: 'header'; icon: InboxHeaderIcon; label: string }
  | { kind: 'row'; row: InboxRowData };

const inboxItems: InboxItem[] = [
  { kind: 'header', icon: 'channel', label: 'building in public' },
  {
    kind: 'row',
    row: {
      kind: 'pr',
      unread: true,
      primary: 'Adapt dark theme and input focus styling for mobile #4158',
      wideTitle: true,
      prAdds: 82,
      prDels: 24,
      prComments: 4,
      prOk: true,
      time: '36m',
    },
  },
  {
    kind: 'row',
    row: {
      kind: 'message',
      primary: 'building-in-public',
      lead: '9 replies from Wolf and 3 others \u00B7',
      secondary:
        'Looking at the home page \u2014 is there a button to the blog?',
      time: '1h',
    },
  },
  {
    kind: 'header',
    icon: 'folder',
    label: 'Comms Team \u2014 Email, DMs, Channels',
  },
  {
    kind: 'row',
    row: {
      kind: 'message',
      unread: true,
      primary: 'comms',
      lead: 'Evan \u00B7',
      secondary: '@teo the backfill inserts the latest 500 signal emails first',
      time: '2h',
    },
  },
  {
    kind: 'row',
    row: {
      kind: 'calendar',
      primary: 'Julia Westphal',
      boldSecondary: 'Invitation: Launch Dinner @ Jun 30, 6:30 PM',
      secondary: 'Join with Google Meet',
      time: '10:53',
    },
  },
  { kind: 'header', icon: 'doc', label: 'Onboarding improvements (June 2026)' },
  {
    kind: 'row',
    row: {
      kind: 'task',
      primary: "Can't get to relevant documents",
      wideTitle: true,
      status: 'Completed',
      priority: 'Low',
      assignee: 'S',
      time: 'Jun 17',
    },
  },
  {
    kind: 'row',
    row: {
      kind: 'mention',
      unread: true,
      primary: 'Owen Bales',
      lead: 'mentioned you in',
      boldSecondary: 'Q3 launch plan',
      time: '9:14',
    },
  },
  {
    kind: 'row',
    row: {
      kind: 'email',
      primary: 'Macro via TestFlight',
      boldSecondary: 'Macro App 2.0.5 (174) is now available to test',
      secondary: 'Open TestFlight on your iOS device to install',
      time: 'Jun 17',
    },
  },
  {
    kind: 'row',
    row: {
      kind: 'ai',
      primary: 'Current Macro Events',
      lead: 'AI responded \u00B7',
      secondary:
        "Lots happening \u2014 here's the live snapshot as of right now",
      time: 'Jun 17',
    },
  },
];

const _UNIFIED_ROW_INDICES = inboxItems
  .map((item, i) => (item.kind === 'row' ? i : -1))
  .filter((i) => i >= 0);

const inboxPill = (): JSX.CSSProperties => ({
  'align-items': 'center',
  'background-color': 'color-mix(in srgb, var(--b0) 45%, transparent)',
  border: '1px solid color-mix(in srgb, var(--b4) 55%, transparent)',
  'border-radius': '999px',
  display: 'inline-flex',
  flex: 'none',
  'font-family': appFont,
  'font-size': '11.5px',
  'font-weight': '500',
  gap: '4px',
  'line-height': 1,
  padding: '3px 8px',
  'white-space': 'nowrap',
});

function _InboxIcon(props: { kind: InboxKind }) {
  const accent = props.kind === 'pr' || props.kind === 'ai';
  return (
    <span
      style={{
        'align-items': 'center',
        color: accent ? 'var(--a0)' : 'var(--c4)',
        display: 'inline-flex',
        flex: 'none',
        height: '16px',
        'justify-content': 'center',
        width: '16px',
      }}
    >
      {props.kind === 'email' ? (
        <MacroNavIcon name="email" size={16} />
      ) : props.kind === 'calendar' ? (
        <CalendarIcon size={16} />
      ) : props.kind === 'message' ? (
        <MacroNavIcon name="channels" size={16} />
      ) : props.kind === 'mention' ? (
        <AtGlyph />
      ) : props.kind === 'task' ? (
        <MacroNavIcon name="tasks" size={16} />
      ) : props.kind === 'pr' ? (
        <PrGlyph />
      ) : (
        <MacroNavIcon name="agents" size={16} accent />
      )}
    </span>
  );
}

function _InboxHeaderIconEl(props: { icon: InboxHeaderIcon }) {
  return (
    <span
      style={{
        'align-items': 'center',
        color: 'var(--c4)',
        display: 'inline-flex',
        flex: 'none',
        height: '15px',
        'justify-content': 'center',
        width: '15px',
      }}
    >
      {props.icon === 'channel' ? (
        <MacroNavIcon name="channels" size={15} />
      ) : props.icon === 'folder' ? (
        <MacroNavIcon name="files" size={15} />
      ) : (
        <IconDocMd
          style={{ display: 'block', height: '15px', width: '15px' }}
        />
      )}
    </span>
  );
}

function _InboxRowContent(props: { row: InboxRowData }) {
  const r = props.row;
  return (
    <Show
      when={!r.wideTitle}
      fallback={
        <span
          style={{
            'align-items': 'center',
            color: 'var(--c1)',
            display: 'inline-flex',
            flex: 1,
            'font-family': appFont,
            'font-size': '14px',
            'font-weight': r.unread ? '600' : '500',
            gap: '7px',
            'min-width': 0,
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            {r.primary}
          </span>
          <Show when={r.kind === 'pr' && r.prOk}>
            <span
              style={{ color: SUCCESS, display: 'inline-flex', flex: 'none' }}
            >
              <MiniCheck color={SUCCESS} />
            </span>
          </Show>
        </span>
      }
    >
      <span
        style={{
          color: 'var(--c1)',
          flex: 'none',
          'font-family': appFont,
          'font-size': '14px',
          'font-weight': r.unread ? '600' : '500',
          'max-width': mobile() ? '110px' : '168px',
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }}
      >
        {r.primary}
      </span>
      <span
        style={{
          flex: 1,
          'font-family': appFont,
          'font-size': '14px',
          'min-width': 0,
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }}
      >
        <Show when={r.lead}>
          <span style={{ color: 'var(--c4)' }}>{r.lead} </span>
        </Show>
        <Show when={r.boldSecondary}>
          <span style={{ color: 'var(--c2)', 'font-weight': '500' }}>
            {r.boldSecondary}
          </span>
        </Show>
        <Show when={r.secondary}>
          <span style={{ color: 'var(--c4)' }}>
            {r.boldSecondary ? '  ' : ''}
            {r.secondary}
          </span>
        </Show>
      </span>
    </Show>
  );
}

function _InboxRowMeta(props: { row: InboxRowData }) {
  const r = props.row;
  return (
    <span
      style={{ 'align-items': 'center', display: 'inline-flex', gap: '6px' }}
    >
      <Show when={r.kind === 'pr'}>
        <span style={inboxPill()}>
          <span style={{ color: SUCCESS, 'font-weight': '600' }}>
            +{r.prAdds}
          </span>
          <span style={{ color: FAILURE }}>
            {'\u2212'}
            {r.prDels}
          </span>
        </span>
        <span style={{ ...inboxPill(), color: 'var(--c2)' }}>
          <span style={{ color: 'var(--c4)', display: 'inline-flex' }}>
            <ChatGlyph />
          </span>
          {r.prComments}
        </span>
      </Show>
      <Show when={r.kind === 'task'}>
        <span style={inboxPill()}>
          <MiniCheck color={SUCCESS} />
          <span style={{ color: 'var(--c2)' }}>{r.status}</span>
        </span>
        <span style={inboxPill()}>
          <span style={{ color: 'var(--c4)', display: 'inline-flex' }}>
            <PriorityGlyph />
          </span>
          <span style={{ color: 'var(--c2)' }}>{r.priority}</span>
        </span>
        <Avatar initials={r.assignee ?? ''} size={20} color="var(--b3)" />
      </Show>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The "everything inbox" — a STATIC list that mirrors the interactive mockup's
// row anatomy (dot · icon · sender · subject + preview · time) but mixes item
// types: email, chat/DM, document, pull request, channel notification, invite.
// ---------------------------------------------------------------------------

type URowKind =
  | 'email'
  | 'chat'
  | 'document'
  | 'pr'
  | 'channel'
  | 'calendar'
  | 'task';
type UItem =
  | { kind: 'header'; label: string }
  | {
      kind: 'row';
      type: URowKind;
      who: string;
      subject: string;
      preview: string;
      time: string;
      unread?: boolean;
      // Item-specific attributes rendered in the trailing meta column.
      adds?: number; // PR additions
      dels?: number; // PR deletions
      state?: 'Open' | 'Merged'; // PR state
      status?: string; // task status
      priority?: string; // task priority
      assignee?: string; // task assignee initials
      replies?: number; // channel reply count
      comments?: number; // document comment count
      at?: string; // calendar event time
    };

// Per-entity accent colour + short label, so each row reads as a distinct kind
// of thing rather than "just another email". The icon, type chip and (for some
// types) the trailing meta all key off this.
// A cohesive family rather than a neon rainbow: even perceptual lightness/chroma
// (~oklch L 0.72–0.82, C 0.10–0.15) with hues spread evenly and kept clear of the
// orange accent (--a0, hue ~44) so no type gets mistaken for a highlight.
const UNIFIED_META: Record<URowKind, { color: string; label: string }> = {
  email: { color: '#fa6b52', label: 'Email' }, // coral — the flagship type gets the punchiest hue
  chat: { color: '#73b0ee', label: 'DM' }, // blue
  channel: { color: '#5dcbd1', label: 'Channel' }, // cyan
  document: { color: '#b191ea', label: 'Doc' }, // violet
  pr: { color: '#64cf80', label: 'PR' }, // green
  task: { color: '#e0c262', label: 'Task' }, // gold
  calendar: { color: '#ee7d8d', label: 'Event' }, // rose
};

// Timestamps are consistent by group: clock times for Today, dates for Earlier.
const unifiedItems: UItem[] = [
  { kind: 'header', label: 'Today' },
  {
    kind: 'row',
    type: 'email',
    who: 'Lena Hartwell',
    subject: 'Revised SOW before Thursday?',
    preview:
      'Legal signed off on the new terms this morning — the only change from last round is the net-45 payment window in section 6.',
    time: '10:33',
    unread: true,
  },
  {
    kind: 'row',
    type: 'pr',
    who: 'Dana Whitfield',
    subject: 'Adapt dark theme and input focus styling for mobile #4158',
    preview:
      'adapts the dark-theme tokens and input focus rings so they hold up on smaller screens',
    time: '10:07',
    unread: true,
    adds: 82,
    dels: 24,
    state: 'Open',
  },
  {
    kind: 'row',
    type: 'chat',
    who: 'Evan Chen',
    subject: 'the backfill inserts the latest 500 signal emails first',
    preview: 'then pages the rest in behind it so search stays fast',
    time: '9:41',
  },
  {
    kind: 'row',
    type: 'channel',
    who: 'building-in-public',
    subject: 'Wolf: is there a button through to the blog?',
    preview: "couldn't find one from the home page nav or the footer",
    time: '9:20',
    replies: 9,
  },
  {
    kind: 'row',
    type: 'task',
    who: 'Sasha Rankin',
    subject: 'Rewrite empty-state copy for first-time users',
    preview:
      'assigned to you in Onboarding — copy feels dense the first time through, especially the empty states',
    time: '8:52',
    unread: true,
    status: 'In progress',
    priority: 'High',
    assignee: 'SR',
  },
  {
    kind: 'row',
    type: 'document',
    who: 'Priya Nair',
    subject: 'Onboarding notes',
    preview:
      'shared a document with you covering the second step of the onboarding flow',
    time: '8:31',
    comments: 3,
  },
  { kind: 'header', label: 'Earlier' },
  {
    kind: 'row',
    type: 'calendar',
    who: 'Julia Westphal',
    subject: 'Invitation: Launch Dinner',
    preview: 'Thursday Jun 30 · The Foundry · Join with Google Meet',
    time: 'Jun 18',
    at: '6:30 PM',
  },
  {
    kind: 'row',
    type: 'email',
    who: 'Macro via TestFlight',
    subject: 'Macro 2.0.5 (174) is now available to test',
    preview:
      'Open TestFlight on your iOS device to install this build, then drop notes in the beta feedback channel.',
    time: 'Jun 17',
  },
  {
    kind: 'row',
    type: 'task',
    who: 'Owen Bales',
    subject: "Can't get to relevant documents",
    preview:
      'closed in Onboarding improvements — resolved by the new document quick-switcher',
    time: 'Jun 16',
    status: 'Done',
    priority: 'Low',
    assignee: 'OB',
  },
  {
    kind: 'row',
    type: 'pr',
    who: 'Owen Bales',
    subject: 'Fix flaky realtime sync test #4119',
    preview:
      'merged into main after two approvals; the intermittent retry timeout is gone',
    time: 'Jun 15',
    adds: 14,
    dels: 6,
    state: 'Merged',
  },
];

// A small tinted pill labelling the row's entity type (skipped for plain email).
function UnifiedTypeChip(props: { type: URowKind }) {
  const meta = UNIFIED_META[props.type];
  return (
    <span
      style={{
        'align-self': 'center',
        'background-color': `color-mix(in srgb, ${meta.color} 15%, transparent)`,
        'border-radius': '5px',
        color: meta.color,
        flex: 'none',
        'font-family': appFont,
        'font-size': '9.5px',
        'font-weight': 500,
        'letter-spacing': '0.04em',
        'line-height': 1,
        padding: '3px 5px',
        'text-transform': 'uppercase',
      }}
    >
      {meta.label}
    </span>
  );
}

function UnifiedRowIcon(props: { type: URowKind; unread?: boolean }) {
  return (
    <span
      style={{
        'align-items': 'center',
        color: UNIFIED_META[props.type].color,
        display: 'inline-flex',
        flex: 'none',
        height: '16px',
        'justify-content': 'center',
        width: '16px',
      }}
    >
      {props.type === 'email' ? (
        <EnvelopeIcon
          bold={props.unread}
          size={15}
          color={UNIFIED_META.email.color}
        />
      ) : props.type === 'calendar' ? (
        <CalendarIcon bold={props.unread} size={15} />
      ) : props.type === 'chat' ? (
        <IconChat style={{ display: 'block', height: '15px', width: '15px' }} />
      ) : props.type === 'document' ? (
        <IconDocMd
          style={{ display: 'block', height: '15px', width: '15px' }}
        />
      ) : props.type === 'pr' ? (
        <PrGlyph />
      ) : props.type === 'task' ? (
        <MacroNavIcon name="tasks" size={16} color={UNIFIED_META.task.color} />
      ) : (
        <MacroNavIcon
          name="channels"
          size={16}
          color={UNIFIED_META.channel.color}
        />
      )}
    </span>
  );
}

function UnifiedGroupDivider(props: { label: string }) {
  return (
    <div
      style={{
        'align-items': 'center',
        'box-sizing': 'border-box',
        display: 'flex',
        gap: '12px',
        padding: '10px 10px 5px',
        width: '100%',
      }}
    >
      <span
        style={{
          color: '#8b8b8b',
          'font-family': appFont,
          'font-size': '10px',
          'font-weight': 500,
          'letter-spacing': '0.06em',
          'text-transform': 'uppercase',
          'white-space': 'nowrap',
        }}
      >
        {props.label}
      </span>
      <span
        aria-hidden="true"
        style={{
          'background-color': '#1f1f1f',
          flex: '1 1 0',
          height: '0.5px',
        }}
      />
    </div>
  );
}

function TaskProgressIcon(props: { status?: string }) {
  const done = () => props.status === 'Done';
  return (
    <span
      style={{
        'align-items': 'center',
        color: done() ? '#57ab5a' : 'var(--a0)',
        display: 'inline-flex',
        flex: 'none',
      }}
    >
      <Show
        when={done()}
        fallback={
          <IconTaskInProgress
            style={{ display: 'block', height: '13px', width: '13px' }}
          />
        }
      >
        <IconTaskDone
          style={{ display: 'block', height: '13px', width: '13px' }}
        />
      </Show>
    </span>
  );
}

function TaskPriorityIcon(props: { priority?: string }) {
  const Icon =
    props.priority === 'High'
      ? IconPriorityHigh
      : props.priority === 'Medium'
        ? IconPriorityMedium
        : IconPriorityLow;
  return (
    <span
      style={{
        'align-items': 'center',
        color: '#8b8b8b',
        display: 'inline-flex',
        flex: 'none',
      }}
    >
      <Icon style={{ display: 'block', height: '12px', width: 'auto' }} />
    </span>
  );
}

function UnifiedInboxWindow() {
  const compact = () => mobile();
  return (
    <div
      class="unified-window"
      style={{
        // Single window (no inner border) mirroring the interactive mockup:
        // warm near-black, one defined edge, a subtle highlight rim (::after),
        // the window shadow, and a bottom fade.
        'background-color': '#060709',
        border: '1px solid #2f2c2c',
        'border-radius': compact() ? '12px' : '14px',
        'box-shadow': 'var(--shadow-window)',
        'box-sizing': 'border-box',
        '-webkit-mask-image':
          'linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 50%, rgb(0 0 0 / 0) 100%)',
        'mask-image':
          'linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 50%, rgb(0 0 0 / 0) 100%)',
        overflow: 'hidden',
        padding: '7px',
        position: 'relative',
        'text-align': 'left',
        width: '100%',
      }}
    >
      <div
        style={{
          'align-items': 'center',
          'border-bottom': '1px solid #1f1f1f',
          display: 'flex',
          gap: compact() ? '10px' : '14px',
          'margin-bottom': '5px',
          padding: compact() ? '11px 13px' : '12px 16px',
        }}
      >
        {/* Lead with the Macro mark, like the mockup's chrome. */}
        <MacroMarkIcon
          aria-label="Macro"
          style={{
            color: '#bfbfbf',
            display: 'block',
            fill: 'currentColor',
            flex: 'none',
            height: compact() ? '13px' : '15px',
            overflow: 'visible',
            stroke: 'none',
          }}
        />
        {/* Chip tab group — same treatment as the mockup's Signal/Noise/All. */}
        <div
          style={{
            'align-items': 'center',
            'background-color': '#000',
            border: '0.5px solid #1f1f1f',
            'border-radius': '9px',
            display: 'flex',
            flex: 'none',
            gap: '3px',
            padding: '3px',
          }}
        >
          <For each={['Signal', 'Noise', 'All']}>
            {(tab, i) => (
              <span
                style={{
                  'background-color': i() === 0 ? '#16191f' : 'transparent',
                  border:
                    i() === 0
                      ? '0.5px solid #353535'
                      : '0.5px solid transparent',
                  'border-radius': '6px',
                  'box-sizing': 'border-box',
                  color: i() === 0 ? '#ffffff' : '#8b8b8b',
                  // Keep the Signal / Noise split visible on compact layouts;
                  // only the less essential All tab is hidden there.
                  display: compact() && i() > 1 ? 'none' : 'inline-block',
                  'font-family': appFont,
                  'font-size': '12.5px',
                  'font-weight': '500',
                  padding: '4px 10px',
                }}
              >
                {tab}
              </span>
            )}
          </For>
        </div>
        {/* Create — the mockup's circular square-pen compose button. */}
        <span
          aria-label="Create"
          style={{
            'align-items': 'center',
            'background-color': '#16191f',
            border: '0.5px solid #1f1f1f',
            'border-radius': '999px',
            'box-sizing': 'border-box',
            color: '#bfbfbf',
            display: compact() ? 'none' : 'inline-flex',
            flex: 'none',
            height: '30px',
            'justify-content': 'center',
            'margin-left': 'auto',
            width: '30px',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.125"
            stroke-linecap="round"
            stroke-linejoin="round"
            style={{ display: 'block', overflow: 'visible' }}
          >
            <g transform="translate(3 3)">
              <path
                fill="none"
                stroke="currentColor"
                d="M6.856027.562744H2.744083C1.539228.562744.5625,1.539472.5625,2.744327v6.511834c0,1.204855.976728,2.181583,2.181583,2.181583h6.511834c1.204855,0,2.181583-.976728,2.181583-2.181583v-4.215376"
              />
              <path
                fill="currentColor"
                stroke="none"
                d="M11.437328,0c.144043,0,.288086.054688.397949.164551.219238.219727.219238.576172,0,.795898l-5.437988,5.4375c-.253567.233332-1.076189.719721-1.294939.499995-.219727-.219727.24857-1.028461.500017-1.295893L11.039379.164551c.109863-.109863.253906-.164551.397949-.164551Z"
              />
            </g>
          </svg>
        </span>
        {/* Search field + shortcut — mirrors the mockup's toolbar. */}
        <span
          style={{
            'align-items': 'center',
            'background-color': '#000',
            border: '0.5px solid #1f1f1f',
            'border-radius': '9px',
            'box-sizing': 'border-box',
            color: '#8b8b8b',
            display: compact() ? 'none' : 'inline-flex',
            'font-family': appFont,
            'font-size': '12.5px',
            'font-weight': '500',
            gap: '7px',
            height: '30px',
            padding: '0 11px',
            'white-space': 'nowrap',
            width: '200px',
          }}
        >
          <MagnifyingGlassIcon size={15} />
          Search
          <span
            style={{
              'align-items': 'center',
              display: 'inline-flex',
              gap: '2.5px',
              'margin-left': 'auto',
            }}
          >
            <CommandIcon size={15} />
            <span
              style={{
                color: '#353535',
                'font-size': '12.5px',
                'font-weight': '500',
              }}
            >
              F
            </span>
          </span>
        </span>
      </div>

      <For each={unifiedItems}>
        {(item) =>
          item.kind === 'header' ? (
            <UnifiedGroupDivider label={item.label} />
          ) : (
            <div style={{ padding: '1px 6px' }}>
              <div
                class="unified-row"
                style={{
                  'align-items': 'center',
                  'border-radius': '7.5px',
                  display: 'grid',
                  gap: compact() ? '9px' : '10px',
                  // Fixed meta column (col 5) so the 1fr preview always ends at
                  // the same x across rows — reads as a clean table rather than a
                  // ragged edge. Width fits the widest meta (a merged PR row).
                  'grid-template-columns': compact()
                    ? 'auto auto 96px minmax(0, 1fr) auto auto'
                    : 'auto auto 132px minmax(0, 1fr) 124px 64px',
                  height: compact() ? 'auto' : '34px',
                  padding: compact() ? '7px 8px' : '0 4px 0 10px',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    'background-color': item.unread ? '#ff8f00' : 'transparent',
                    'border-radius': '999px',
                    flex: 'none',
                    height: '5px',
                    width: '5px',
                  }}
                />
                <UnifiedRowIcon type={item.type} unread={item.unread} />
                <span
                  style={{
                    color: item.unread ? '#ffffff' : '#bfbfbf',
                    'font-family': appFont,
                    'font-size': compact() ? '13px' : '12.5px',
                    'font-weight': item.unread ? 500 : 400,
                    'min-width': 0,
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'white-space': 'nowrap',
                  }}
                >
                  {item.who}
                </span>
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: compact() ? '7px' : '9px',
                    'min-width': 0,
                    overflow: 'hidden',
                  }}
                >
                  <Show when={!compact() && UNIFIED_META[item.type].label}>
                    <UnifiedTypeChip type={item.type} />
                  </Show>
                  <span
                    style={{
                      // Chat/channel are message content, not a subject line — keep
                      // the whole preview one muted tone, no bright/dim separation.
                      color:
                        item.type === 'chat' || item.type === 'channel'
                          ? '#8b8b8b'
                          : item.unread
                            ? '#ffffff'
                            : '#bfbfbf',
                      flex: '0 1 auto',
                      'font-family': appFont,
                      'font-size': '12.5px',
                      'font-weight': item.unread ? 500 : 400,
                      'min-width': 0,
                      overflow: 'hidden',
                      'text-overflow': 'ellipsis',
                      'white-space': 'nowrap',
                    }}
                  >
                    {item.subject}
                  </span>
                  <Show when={!compact()}>
                    <span
                      style={{
                        color: '#8b8b8b',
                        flex: '1 1 0',
                        'font-family': appFont,
                        'font-size': '12.5px',
                        'font-weight': 400,
                        'min-width': 0,
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                      }}
                    >
                      {item.preview}
                    </span>
                  </Show>
                  {/* Channel reply count trails the preview, right-justified with a
                        little padding — sits with the content, not the meta column. */}
                  <Show when={item.type === 'channel' && item.replies != null}>
                    <span
                      style={{
                        color: '#8b8b8b',
                        flex: 'none',
                        'font-family': appFont,
                        'font-size': '11.5px',
                        'font-weight': 600,
                        'padding-left': '6px',
                        'white-space': 'nowrap',
                      }}
                    >
                      +{item.replies} replies
                    </span>
                  </Show>
                </div>
                {/* Item-specific meta column: PR line changes / task status.
                      Multi-piece rows (PR chip + stats, task icons) space-between to
                      fill the fixed column; a lone piece flows from flex-end so it
                      still sits snug against the time. */}
                <span
                  style={{
                    'padding-left': compact() ? '0' : '24px',
                    'align-items': 'center',
                    display: compact() ? 'none' : 'flex',
                    flex: 'none',
                    gap: '10px',
                    'justify-content':
                      item.type === 'task' ||
                      (item.type === 'pr' && item.state != null)
                        ? 'space-between'
                        : 'flex-end',
                  }}
                >
                  {item.type === 'pr' && item.adds != null ? (
                    <>
                      <Show when={item.state}>
                        <span
                          style={{
                            'background-color': `color-mix(in srgb, ${item.state === 'Merged' ? '#a371f7' : '#3fb950'} 15%, transparent)`,
                            'border-radius': '5px',
                            color:
                              item.state === 'Merged' ? '#a371f7' : '#3fb950',
                            'font-family': appFont,
                            'font-size': '9.5px',
                            'font-weight': 500,
                            'letter-spacing': '0.04em',
                            'line-height': 1,
                            padding: '3px 5px',
                            'text-transform': 'uppercase',
                            'white-space': 'nowrap',
                          }}
                        >
                          {item.state}
                        </span>
                      </Show>
                      <span
                        style={{
                          'font-family': appFont,
                          'font-size': '11.5px',
                          'font-weight': 600,
                          'white-space': 'nowrap',
                        }}
                      >
                        <span style={{ color: '#57ab5a' }}>+{item.adds}</span>{' '}
                        <span style={{ color: '#e5687d' }}>−{item.dels}</span>
                      </span>
                    </>
                  ) : item.type === 'task' ? (
                    <>
                      <TaskProgressIcon status={item.status} />
                      <TaskPriorityIcon priority={item.priority} />
                      <Avatar
                        initials={item.assignee ?? ''}
                        size={18}
                        color="#353c5e"
                        fontScale={0.5}
                      />
                    </>
                  ) : item.type === 'document' && item.comments != null ? (
                    <span
                      style={{
                        color: '#8b8b8b',
                        'font-family': appFont,
                        'font-size': '11.5px',
                        'font-weight': 600,
                        'white-space': 'nowrap',
                      }}
                    >
                      {item.comments} comments
                    </span>
                  ) : item.type === 'calendar' && item.at ? (
                    <span
                      style={{
                        color: UNIFIED_META.calendar.color,
                        'font-family': appFont,
                        'font-size': '11.5px',
                        'font-weight': 600,
                        'white-space': 'nowrap',
                      }}
                    >
                      {item.at}
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    color: '#bfbfbf',
                    'font-family': appFont,
                    'font-size': '12.5px',
                    'font-weight': item.unread ? 500 : 400,
                    'text-align': 'right',
                    'white-space': 'nowrap',
                    width: compact() ? 'auto' : '64px',
                  }}
                >
                  {item.time}
                </span>
              </div>
            </div>
          )
        }
      </For>

      {/* Ambient surface glow — matches the interactive mockup: a soft
            highlight pooling top-left and a gentle shade bottom-right. Sits
            above the rows (z-index 1) but below the ::after edge rim (z-index 2). */}
      <div
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(125% 115% at 0% 0%, color-mix(in srgb, var(--ambient-ink) 5%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 2%, transparent) 22%, transparent 52%), ' +
            'radial-gradient(130% 118% at 100% 100%, color-mix(in srgb, var(--b0) 26%, transparent) 0%, color-mix(in srgb, var(--b0) 9%, transparent) 28%, transparent 58%)',
          'border-radius': 'inherit',
          inset: 0,
          'pointer-events': 'none',
          position: 'absolute',
          'z-index': 1,
        }}
      />
    </div>
  );
}

export function UnifiedInboxPlayer() {
  return (
    <div style={{ display: 'grid', 'justify-items': 'center', width: '100%' }}>
      <style>{`
        .unified-row { transition: background-color 240ms ease; }
        .unified-row:hover { background-color: rgba(139, 139, 139, 0.1); }
        .unified-window::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(135deg, color-mix(in srgb, var(--c1) 16%, transparent) 0%, transparent 24%, transparent 76%, color-mix(in srgb, var(--c1) 11%, transparent) 100%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          pointer-events: none;
          z-index: 2;
        }
        .unified-frame { position: relative; }
        .unified-frame::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(to bottom, color-mix(in srgb, var(--c1) 10%, transparent) 0%, color-mix(in srgb, var(--c1) 7%, transparent) 45%, transparent 80%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          pointer-events: none;
        }
      `}</style>
      <div
        style={{
          filter: 'drop-shadow(0 30px 60px rgb(0 0 0 / 0.45))',
          'max-width': '1160px',
          width: '100%',
        }}
      >
        {/* Same rounded gradient frame as the "Email less" graphic: a top-lit
            gradient fill plus a masked 1px gradient border ring. */}
        <div
          class="unified-frame"
          style={{
            'box-sizing': 'border-box',
            'border-radius': mobile() ? '12px' : '14px',
            background:
              'linear-gradient(to bottom, color-mix(in srgb, var(--c1) 24%, transparent) 0%, color-mix(in srgb, var(--c1) 5%, transparent) 45%, transparent 62%)',
            'padding-top': mobile() ? '0' : '48px',
            'padding-left': mobile() ? '0' : '48px',
            'padding-right': mobile() ? '0' : '48px',
            width: '100%',
          }}
        >
          <UnifiedInboxWindow />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard-first — an interactive triage demo. Drive it with J / K / E, or by
// tapping the keys (mirrors the home page's "interactive" treatment).
// ---------------------------------------------------------------------------

const kbRows: {
  who: string;
  subject: string;
  time: string;
  unread?: boolean;
}[] = [
  {
    who: 'Sarah Kim',
    subject: 'Revised SOW before Thursday?',
    time: '10:33',
    unread: true,
  },
  {
    who: 'Priya Patel',
    subject: 'Design review for onboarding',
    time: '9:14',
    unread: true,
  },
  { who: 'Marcus Lee', subject: 'Re: Q3 roadmap draft', time: 'Jun 15' },
  { who: 'Mom', subject: 'dinner sunday?', time: 'Jun 14', unread: true },
  { who: 'Dana Whitfield', subject: 'Contract countersigned', time: 'Jun 9' },
  { who: 'Rachel Beckerman', subject: 'Letters to the kids', time: 'Jun 8' },
];

function BigKey(props: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      class={`email-keycap${props.active ? ' is-pressed' : ''}`}
      onClick={props.onPress}
      style={{
        'align-items': 'center',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--b1) 80%, var(--b4)), var(--b1))',
        border: '1px solid color-mix(in srgb, var(--b4) 70%, transparent)',
        'border-radius': '9px',
        'box-shadow':
          '0 3px 0 color-mix(in srgb, var(--b0) 70%, var(--b4)), inset 0 1px 0 color-mix(in srgb, var(--c1) 12%, transparent)',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        cursor: 'pointer',
        display: 'inline-grid',
        'font-family': 'rajdhani, body',
        'font-size': mobile() ? '16px' : '18px',
        'font-weight': '700',
        height: mobile() ? '42px' : '48px',
        'line-height': 1,
        'min-width': mobile() ? '42px' : '48px',
        'place-items': 'center',
      }}
    >
      {props.label}
    </button>
  );
}

function _KeyboardSpeedGraphic() {
  const compact = () => mobile();
  const [archived, setArchived] = createSignal<number[]>([]);
  const [selected, setSelected] = createSignal(0);
  const [pressed, setPressed] = createSignal<string | null>(null);
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearTimeout(pressTimer);
    clearTimeout(clearTimer);
  });

  const visible = () =>
    kbRows
      .map((row, i) => ({ row, i }))
      .filter(({ i }) => !archived().includes(i));
  const flash = (key: string) => {
    setPressed(null);
    pressTimer = setTimeout(() => setPressed(key), 0);
    clearTimer = setTimeout(
      () => setPressed((p) => (p === key ? null : p)),
      220
    );
  };
  const move = (delta: number) => {
    const count = visible().length;
    if (!count) return;
    setSelected((s) => Math.max(0, Math.min(s + delta, count - 1)));
  };
  const archiveCurrent = () => {
    const v = visible();
    const target = v[selected()];
    if (!target) return;
    setArchived((a) => [...a, target.i]);
    setSelected((s) => Math.max(0, Math.min(s, v.length - 2)));
  };
  const reset = () => {
    setArchived([]);
    setSelected(0);
  };
  const act = (key: string) => {
    flash(key);
    if (key === 'J') move(1);
    else if (key === 'K') move(-1);
    else if (key === 'E') archiveCurrent();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === 'j' || k === 'arrowdown') {
      act('J');
      e.preventDefault();
    } else if (k === 'k' || k === 'arrowup') {
      act('K');
      e.preventDefault();
    } else if (k === 'e') {
      act('E');
      e.preventDefault();
    }
  };

  const keyGroups: { keys: string[]; caption: string }[] = [
    { keys: ['J', 'K'], caption: 'Navigate' },
    { keys: ['E'], caption: 'Archive' },
  ];

  return (
    <div style={{ display: 'grid', 'justify-items': 'center', width: '100%' }}>
      <div
        style={{
          'max-width': compact() ? '100%' : '600px',
          position: 'relative',
          width: '100%',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(82% 80% at 50% 42%, color-mix(in srgb, var(--b1) 42%, var(--ambient-ink) 16%) 0%, transparent 72%)',
            inset: '-24% -20%',
            'pointer-events': 'none',
            position: 'absolute',
            'z-index': 0,
          }}
        />
        <div
          tabindex={0}
          role="application"
          aria-label="Interactive inbox. Press J and K to move, E to archive."
          class="hero-app-window"
          onKeyDown={onKeyDown}
          style={{
            'background-color': '#080808',
            border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
            'border-radius': '12px',
            'box-shadow': 'var(--shadow-window)',
            'box-sizing': 'border-box',
            filter: 'drop-shadow(0 34px 64px rgb(0 0 0 / 0.5))',
            outline: 'none',
            overflow: 'hidden',
            padding: '7px',
            position: 'relative',
            width: '100%',
            'z-index': 1,
          }}
        >
          <div
            style={{
              'background-color': '#080808',
              border:
                '1px solid color-mix(in srgb, var(--c4) 12%, transparent)',
              'border-radius': '8px',
              overflow: 'hidden',
              'text-align': 'left',
            }}
          >
            <div
              style={{
                'align-items': 'center',
                'border-bottom':
                  '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                display: 'flex',
                gap: '10px',
                padding: compact() ? '11px 13px' : '12px 16px',
              }}
            >
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': compact() ? '14px' : '15px',
                  'font-weight': '600',
                }}
              >
                Signal
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  'font-family': appFont,
                  'font-size': '12.5px',
                  'margin-left': 'auto',
                }}
              >
                {visible().length} unread
              </span>
            </div>
            <div style={{ 'min-height': compact() ? '0' : '248px' }}>
              <Show
                when={visible().length > 0}
                fallback={
                  <div
                    style={{
                      'align-items': 'center',
                      color: 'var(--c4)',
                      display: 'grid',
                      gap: '12px',
                      'justify-items': 'center',
                      'min-height': compact() ? '160px' : '248px',
                      padding: '24px',
                    }}
                  >
                    <span style={{ color: 'var(--a0)' }}>
                      <SparkleGlyph size={22} />
                    </span>
                    <span
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-size': '15px',
                        'font-weight': '600',
                      }}
                    >
                      Inbox zero
                    </span>
                    <button
                      type="button"
                      onClick={reset}
                      style={{
                        background: 'transparent',
                        border:
                          '1px solid color-mix(in srgb, var(--c4) 24%, transparent)',
                        'border-radius': '999px',
                        color: 'var(--c2)',
                        cursor: 'pointer',
                        'font-family': 'rajdhani, body',
                        'font-size': '12px',
                        'font-weight': '700',
                        'letter-spacing': '0.06em',
                        padding: '7px 15px',
                        'text-transform': 'uppercase',
                      }}
                    >
                      Replay
                    </button>
                  </div>
                }
              >
                <For each={visible()}>
                  {(entry, navIndex) => (
                    <div
                      class="hero-row"
                      onClick={() => setSelected(navIndex())}
                      onMouseEnter={() => setSelected(navIndex())}
                      style={{
                        'align-items': 'center',
                        'background-color':
                          navIndex() === selected()
                            ? 'color-mix(in srgb, var(--c1) 6%, transparent)'
                            : 'transparent',
                        'border-bottom':
                          navIndex() === visible().length - 1
                            ? '0'
                            : '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                        cursor: 'pointer',
                        display: 'grid',
                        gap: compact() ? '9px' : '11px',
                        'grid-template-columns':
                          'auto auto minmax(0, 1fr) auto',
                        padding: compact() ? '10px 13px' : '11px 16px',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          'background-color': entry.row.unread
                            ? 'var(--a0)'
                            : 'transparent',
                          'border-radius': '999px',
                          flex: 'none',
                          height: '7px',
                          width: '7px',
                        }}
                      />
                      <EnvelopeGlyph />
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
                            'font-weight': entry.row.unread ? '700' : '500',
                          }}
                        >
                          {entry.row.who}
                        </span>
                        <span
                          style={{
                            color: 'var(--c4)',
                            'font-family': appFont,
                            'font-size': compact() ? '13px' : '14px',
                          }}
                        >
                          {'\u2003'}
                          {entry.row.subject}
                        </span>
                      </span>
                      <span
                        style={{
                          color: 'var(--c4)',
                          'font-family': appFont,
                          'font-size': '12px',
                          'white-space': 'nowrap',
                        }}
                      >
                        {entry.row.time}
                      </span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
            <div
              style={{
                'align-items': 'center',
                'background-color':
                  'color-mix(in srgb, var(--b1) 22%, transparent)',
                'border-top':
                  '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                display: 'flex',
                gap: compact() ? '18px' : '32px',
                'justify-content': 'center',
                padding: compact() ? '13px' : '16px',
              }}
            >
              <For each={keyGroups}>
                {(group) => (
                  <div
                    style={{
                      'align-items': 'center',
                      display: 'flex',
                      gap: '8px',
                    }}
                  >
                    <For each={group.keys}>
                      {(k) => (
                        <BigKey
                          label={k}
                          active={pressed() === k}
                          onPress={() => act(k)}
                        />
                      )}
                    </For>
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': 'rajdhani, body',
                        'font-size': '12px',
                        'font-weight': '700',
                        'letter-spacing': '0.08em',
                        'margin-left': '4px',
                        'text-transform': 'uppercase',
                      }}
                    >
                      {group.caption}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
      <span
        style={{
          color: 'color-mix(in srgb, var(--c4) 70%, transparent)',
          'font-family': 'body',
          'font-size': '13px',
          'font-weight': '600',
          'margin-top': compact() ? '20px' : '26px',
          'text-align': 'center',
        }}
      >
        Tap the keys, or click the inbox and use your keyboard.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full-bleed spotlight compositions — a full inbox dimmed in the background
// with one element (composer / AI draft) lifted and spotlit in front, mirroring
// the homepage email block and the Documents properties spotlight.
// ---------------------------------------------------------------------------

export function EmailComposeSpotlight() {
  const compact = () => mobile();
  return (
    <Show when={!compact()} fallback={<ComposeMentionGraphic />}>
      <div style={{ position: 'relative', width: '100%' }}>
        <div
          aria-hidden="true"
          style={{
            filter: 'saturate(0.85)',
            opacity: '0.42',
            overflow: 'hidden',
            'pointer-events': 'none',
            // Zoom + radial fade matching the accounts graphic, so the two read
            // as one visual family.
            '-webkit-mask-image':
              'radial-gradient(72% 84% at 40% 46%, #000 42%, transparent 100%)',
            'mask-image':
              'radial-gradient(72% 84% at 40% 46%, #000 42%, transparent 100%)',
          }}
        >
          <div
            style={{
              transform: 'scale(1.7)',
              'transform-origin': '40% 12%',
              width: '100%',
            }}
          >
            <img
              src={inboxBgUrl}
              alt=""
              draggable={false}
              style={{
                display: 'block',
                height: 'auto',
                'user-select': 'none',
                width: '100%',
              }}
            />
          </div>
        </div>
        <div
          style={{
            'align-items': 'start',
            display: 'grid',
            inset: '0',
            'justify-items': 'start',
            position: 'absolute',
          }}
        >
          <div
            style={{
              'margin-left': '60px',
              'max-width': '500px',
              'padding-left': '3%',
              position: 'relative',
              // Zoom the whole compose card out a touch so more of the inbox
              // backdrop shows around it; scales text, pills and padding as one.
              // Anchored top-left and lifted so the card's top aligns with the
              // heading beside it (offsets the mock's own top padding).
              transform: 'translatex(-48px) translateY(-82px) scale(0.88)',
              'transform-origin': 'left top',
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
              <ComposeMentionGraphic />
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

export function EmailAiSpotlight() {
  const compact = () => mobile();
  return (
    <Show when={!compact()} fallback={<AiComposeGraphic />}>
      <div
        style={{
          display: 'grid',
          'justify-items': 'center',
          position: 'relative',
          width: '100%',
        }}
      >
        {/* Full-width inbox, dimmed and centered behind the lifted phone. */}
        <div
          aria-hidden="true"
          style={{
            'align-items': 'center',
            display: 'grid',
            inset: '0',
            'justify-items': 'center',
            'pointer-events': 'none',
            position: 'absolute',
          }}
        >
          <div
            style={{
              filter: 'saturate(0.85)',
              'mask-image':
                'radial-gradient(120% 92% at 50% 50%, #000 28%, transparent 78%)',
              '-webkit-mask-image':
                'radial-gradient(120% 92% at 50% 50%, #000 28%, transparent 78%)',
              'max-width': '1040px',
              opacity: '0.3',
              width: '100%',
            }}
          >
            <HeroAppWindow />
          </div>
        </div>
        {/* The AI draft phone, lifted and spotlit in front. */}
        <div style={{ position: 'relative', 'z-index': 1 }}>
          <div
            aria-hidden="true"
            style={{
              background:
                'radial-gradient(58% 58% at 50% 46%, color-mix(in srgb, var(--ambient-ink) 9%, transparent) 0%, transparent 72%)',
              inset: '-10% -55%',
              'pointer-events': 'none',
              position: 'absolute',
              'z-index': 0,
            }}
          />
          <div
            style={{
              filter: 'drop-shadow(0 44px 86px rgb(0 0 0 / 0.6))',
              position: 'relative',
              'z-index': 1,
            }}
          >
            <AiComposeGraphic />
          </div>
        </div>
      </div>
    </Show>
  );
}
