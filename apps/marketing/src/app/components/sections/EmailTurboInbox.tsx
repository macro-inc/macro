import { createSignal, For, type JSX, Show } from 'solid-js';
import IconReplyAll from '../../../assets/icons/phosphor/arrow-bend-double-up-left.svg';
import IconReply from '../../../assets/icons/phosphor/arrow-bend-up-left.svg';
import IconForward from '../../../assets/icons/phosphor/arrow-bend-up-right.svg';
import IconDocMd from '../../../assets/icons/wide-file-md.svg';
import IconStar from '../../../assets/icons/wide-star.svg';
import IconTask from '../../../assets/icons/wide-task.svg';
import { AiComposeGraphic } from '../graphics/AiComposeGraphic';
import {
  CalendarIcon,
  CaretDownIcon,
  CommandIcon,
  EnvelopeIcon,
  INK,
  MagnifyingGlassIcon,
} from '../graphics/EmailListCardGraphic';
import { EmptyInboxTray } from '../graphics/EmptyInboxTray';
import { MacroMarkIcon } from '../graphics/MacroMarkIcon';
import { APP_PREVIEW_HEIGHT } from './SceneAppPreview';

// The /email hero: a purpose-built, fully interactive inbox. No app sidebar, no
// other Macro features — just the email surface, tuned so a visitor discovers
// the three things that sell Macro Mail in the first ten seconds: keystroke
// triage (J/K/E/L), Signal vs Noise, and rich email bodies wired into a
// workspace. Clearing Signal earns the inbox-zero tray.

// Same lever as SceneAppPreview's PREVIEW_ZOOM: `zoom` uniformly scales every
// px inside the window (fonts, padding, icons) while the frame's width:100%
// keeps filling its column, so the mockup reads as a denser, more real app
// surface instead of a blown-up mockup. Lower = more zoomed out.
const TURBO_ZOOM = 0.8;

const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const ACCOUNT_WORK = 'var(--a0)';
const ACCOUNT_PERSONAL = 'var(--a2)';
const ACCOUNT_THIRD = 'var(--a4)';

// ---------------------------------------------------------------------------
// Demo data — bodies are segment lists so @mentions render as real chips.
// ---------------------------------------------------------------------------

type Seg =
  | string
  | { kind: 'person'; label: string }
  | { kind: 'doc'; label: string }
  | { kind: 'task'; label: string };

interface Mail {
  id: number;
  who: string;
  initials: string;
  from: string;
  subject: string;
  preview: string;
  time: string;
  account: string;
  group: string;
  unread?: boolean;
  calendar?: boolean;
  noise?: boolean;
  // Count of collapsed earlier messages in the thread — real threads have
  // history, and showing it (collapsed) is most of what makes the reading
  // pane read as a live client rather than a staged screenshot.
  thread?: number;
  // Sort key, newest = largest. The list must stay strictly reverse-
  // chronological even in the All tab, where Signal and Noise interleave.
  ts: number;
  body: Seg[][];
}

const MAILS: Mail[] = [
  {
    id: 0,
    ts: 100,
    who: 'Lena Hartwell',
    initials: 'LH',
    from: 'lena@parkline.co',
    subject: 'Revised SOW before Thursday?',
    preview:
      'Legal signed off on the new terms this morning — the only change is the net-45 payment window. Can you send the updated version before the Thursday call?',
    time: '10:33',
    account: ACCOUNT_WORK,
    group: 'Today',
    unread: true,
    thread: 4,
    body: [
      [
        'Legal signed off on the new terms this morning — the only change from last round is the net-45 payment window in ',
        { kind: 'doc', label: 'Parkline SOW v4' },
        ', section 6.',
      ],
      [
        'Can you send the updated version before the Thursday call? I put ',
        { kind: 'task', label: 'Countersign SOW' },
        ' on our side so it does not slip, and ',
        { kind: 'person', label: 'Ben Aldridge' },
        ' has the signature authority if I am out.',
      ],
      ['Thanks — excited to get this over the line.'],
      ['Best,\nLena'],
    ],
  },
  {
    id: 1,
    ts: 99,
    who: 'Nina Castellano',
    initials: 'NC',
    from: 'nina@macro.com',
    subject: 'Design review for the new onboarding',
    preview:
      'Left notes in the Figma, mostly around the empty states and the second step of the flow — copy feels dense for first-time users right now.',
    time: '9:14',
    account: ACCOUNT_WORK,
    group: 'Today',
    unread: true,
    body: [
      [
        'Went through the whole flow this morning and left comments in ',
        { kind: 'doc', label: 'Onboarding notes' },
        ' — mostly around the empty states, where the copy feels dense for first-time users.',
      ],
      [
        'I filed ',
        { kind: 'task', label: 'Rewrite empty-state copy' },
        ' and assigned it to ',
        { kind: 'person', label: 'Priya Nair' },
        ' since she rewrote the tour last quarter. Second step otherwise looks great.',
      ],
      ['Can review again Friday if you want another pass before it ships.'],
      ['— Nina'],
    ],
  },
  {
    id: 2,
    ts: 96,
    who: 'Marco Delgado',
    initials: 'MD',
    from: 'marco@vantagepoint.vc',
    subject: 'Invitation: Macro <> intro @ 11am',
    preview:
      'You have been invited to an event on Thu Jun 19 from 11:00–11:30am. Agenda attached — mostly want to cover the team, roadmap, and how the pilot went.',
    time: 'Jun 16',
    account: ACCOUNT_WORK,
    group: 'This week',
    calendar: true,
    body: [
      ['Thursday Jun 19, 11:00–11:30am · Google Meet'],
      [
        'Looking forward to the intro. I attached ',
        { kind: 'doc', label: 'Pre-read: Macro intro' },
        ' with a short agenda — mostly want to cover the team, the roadmap, and how the pilot went.',
      ],
      ['If the time stops working, grab any slot on my calendar link below.'],
      ['Best,\nMarco'],
    ],
  },
  {
    id: 3,
    ts: 95,
    who: 'Ben Aldridge',
    initials: 'BA',
    from: 'ben@macro.com',
    subject: 'Re: Q3 roadmap draft',
    preview:
      'Thanks for putting the roadmap together — the sequencing mostly reads right. One thing on the timeline: can we pull the billing work forward a sprint so it lands before the freeze?',
    time: 'Jun 15',
    account: ACCOUNT_WORK,
    group: 'This week',
    thread: 2,
    body: [
      [
        'Thanks for putting ',
        { kind: 'doc', label: 'Q3 Roadmap' },
        ' together — the sequencing mostly reads right to me.',
      ],
      [
        'One thing on the timeline: can we pull the billing work forward a sprint so it lands before the launch freeze? I opened ',
        { kind: 'task', label: 'Pull billing forward one sprint' },
        ' so we can decide there. ',
        { kind: 'person', label: 'Marco Delgado' },
        ' flagged the same risk in the board deck.',
      ],
      ['Everything else can hold until planning on Monday.'],
      ['— Ben'],
    ],
  },
  {
    id: 4,
    ts: 94,
    who: 'Mom',
    initials: 'DB',
    from: 'deb.beckerman@gmail.com',
    subject: 'dinner sunday?',
    preview:
      'your sister is coming into town this weekend, thought we could all get together sunday evening if you are free. nothing fancy, maybe just pasta at the house.',
    time: 'Jun 14',
    account: ACCOUNT_PERSONAL,
    group: 'This week',
    unread: true,
    body: [
      [
        'your sister is coming into town this weekend, thought we could all get together sunday evening if you are free.',
      ],
      [
        'nothing fancy, maybe just pasta at the house. let me know by saturday so i can shop!',
      ],
      ['love,\nmom'],
    ],
  },
  {
    id: 5,
    ts: 89,
    who: 'Claire Donovan',
    initials: 'CD',
    from: 'claire@fieldstone.legal',
    subject: 'Contract countersigned',
    preview:
      'Attaching the fully executed copy for your records. Both signature blocks are complete and the effective date is today. Thanks for the quick turnaround.',
    time: 'Jun 9',
    account: ACCOUNT_WORK,
    group: 'Earlier',
    thread: 6,
    body: [
      [
        'Attaching ',
        { kind: 'doc', label: 'MSA — fully executed.pdf' },
        ' for your records. Both signature blocks are complete and the effective date is today.',
      ],
      [
        'Thanks for the quick turnaround — great working with you, and looking forward to next steps.',
      ],
      ['Best regards,\nClaire Donovan\nFieldstone Legal LLP'],
    ],
  },
  // Noise
  {
    id: 6,
    ts: 93,
    who: 'Ledgerly',
    initials: 'L',
    from: 'notifications@ledgerly.io',
    subject: 'Your June payout is on the way',
    preview:
      '$24,310.55 will arrive in your account ending 4471 by Thursday, June 18. View the full breakdown and fee summary in your dashboard.',
    time: 'Jun 13',
    account: ACCOUNT_THIRD,
    group: 'This week',
    unread: true,
    noise: true,
    body: [
      [
        '$24,310.55 will arrive in your account ending 4471 by Thursday, June 18.',
      ],
      ['View the full breakdown and fee summary in your dashboard.'],
    ],
  },
  {
    id: 7,
    ts: 92,
    who: 'Greg Sandoval',
    initials: 'GS',
    from: 'greg@zynoptes.io',
    subject: 'Re: Zynoptes <> Macro follow up',
    preview:
      'We ran a preliminary scan on your repo and attached the .SARIF results. A couple of medium findings worth a look before you ship to production.',
    time: 'Jun 12',
    account: ACCOUNT_WORK,
    group: 'This week',
    noise: true,
    thread: 3,
    body: [
      [
        'We ran a preliminary scan on your repo and attached the .SARIF results. A couple of medium findings worth a look before you ship to production.',
      ],
      ['Happy to walk through them on a quick call this week if useful.'],
      ['Best,\nGreg Sandoval\nZynoptes Security'],
    ],
  },
  {
    id: 8,
    ts: 90,
    who: 'Waypoint Receipts',
    initials: 'W',
    from: 'receipts@waypoint.com',
    subject: 'Your Wednesday evening trip with Waypoint',
    preview:
      'Thanks for riding. Total $18.40. Here is your receipt with the fare breakdown, tip, and the route you took on Wednesday evening.',
    time: 'Jun 10',
    account: ACCOUNT_PERSONAL,
    group: 'Earlier',
    noise: true,
    body: [
      ['Thanks for riding. Total $18.40.'],
      [
        'Here is your receipt with the fare breakdown, tip, and the route you took on Wednesday evening.',
      ],
    ],
  },
  {
    id: 9,
    ts: 88,
    who: 'The Download',
    initials: 'TD',
    from: 'newsletter@thedownload.dev',
    subject: 'Issue #214: the week in infra',
    preview:
      'Postgres 18 benchmarks, a new take on queues, and why everyone is rewriting in Zig. Plus 14 links you already saw on the front page of Hacker News.',
    time: 'Jun 8',
    account: ACCOUNT_PERSONAL,
    group: 'Earlier',
    noise: true,
    body: [
      [
        'Postgres 18 benchmarks, a new take on queues, and why everyone is rewriting in Zig.',
      ],
      ['Plus: 14 links you already saw on the front page of Hacker News.'],
    ],
  },
];

// ---------------------------------------------------------------------------
// Small glyphs
// ---------------------------------------------------------------------------

function Avatar(props: { initials: string; size?: number }) {
  const s = props.size ?? 26;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': INK.chip,
        border: `1px solid ${INK.chipBorder}`,
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: INK.textDim,
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

function EnvelopeGlyph(props: { calendar?: boolean; unread?: boolean }) {
  return (
    <Show
      when={props.calendar}
      fallback={<EnvelopeIcon bold={props.unread} size={15} />}
    >
      <CalendarIcon bold={props.unread} size={15} />
    </Show>
  );
}

// Group divider matching the hero cards: small muted uppercase label with a
// hairline rule running out to the right edge.
function GroupDivider(props: { label: string }) {
  return (
    <div
      style={{
        'align-items': 'center',
        'box-sizing': 'border-box',
        display: 'flex',
        gap: '12px',
        padding: '5px 10px',
        width: '100%',
      }}
    >
      <span
        style={{
          color: INK.textMuted,
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
          'background-color': INK.hairline,
          flex: '1 1 0',
          height: '0.5px',
        }}
      />
    </div>
  );
}

// Inline body chips — same visual language as the real editor (and the compose
// spotlight further down the page): accent @name pills for people, icon +
// underlined label for docs and tasks.
function BodySeg(props: { seg: Seg }) {
  const seg = props.seg;
  if (typeof seg === 'string') return <>{seg}</>;
  if (seg.kind === 'person') {
    return (
      <span
        style={{
          'background-color': 'color-mix(in srgb, var(--a0) 8%, transparent)',
          'border-radius': '6px',
          color: 'var(--a0)',
          margin: '0 1px',
          padding: '1px 4px',
          'white-space': 'nowrap',
        }}
      >
        @{seg.label}
      </span>
    );
  }
  return (
    <span style={{ 'white-space': 'nowrap' }}>
      <span
        aria-hidden="true"
        style={{
          color: 'var(--a0)',
          display: 'inline-flex',
          margin: '0 3px 0 1px',
          'vertical-align': '-0.22em',
        }}
      >
        <Show
          when={seg.kind === 'doc'}
          fallback={
            <IconTask
              style={{ display: 'block', height: '16px', width: '16px' }}
            />
          }
        >
          <IconDocMd
            style={{ display: 'block', height: '16px', width: '16px' }}
          />
        </Show>
      </span>
      <span
        style={{
          color: INK.textBright,
          'text-decoration-line': 'underline',
          'text-decoration-color': 'rgba(255, 255, 255, 0.22)',
          'text-decoration-thickness': 'max(1px, 0.06em)',
          'text-underline-offset': '2px',
        }}
      >
        {seg.label}
      </span>
    </span>
  );
}

// A physical-looking keycap that depresses when its key is pressed (or when
// tapped — taps trigger the same action as the key).
function Keycap(props: {
  label: string;
  pressed: boolean;
  onPress: () => void;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={`Press ${props.label}`}
      onClick={props.onPress}
      data-pressed={props.pressed ? 'true' : 'false'}
      class="turbo-keycap"
      style={{
        'align-items': 'center',
        background: 'transparent',
        border: props.pressed
          ? '1px solid var(--a0)'
          : `1px solid ${INK.chipBorder}`,
        'border-radius': '6px',
        'box-sizing': 'border-box',
        color: props.pressed ? 'var(--a0)' : INK.textDim,
        cursor: 'pointer',
        display: 'inline-flex',
        'font-family': appFont,
        'font-size': '11px',
        'font-weight': '600',
        height: '22px',
        'justify-content': 'center',
        'line-height': 1,
        'min-width': props.wide ? '30px' : '22px',
        padding: '0 5px',
      }}
    >
      {props.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The interactive window
// ---------------------------------------------------------------------------

const TABS = ['Signal', 'Noise', 'All'] as const;

// In hero mode the demo opens as a tight, curated three-email inbox — the top
// three Signal threads — and auto-triages them to inbox zero on mount. The
// empty-state button then swaps in the full inbox for free play.
const HERO_MAIL_IDS = [0, 1, 2];

export function EmailTurboInbox(props: {
  mobile: () => boolean;
  hero?: boolean;
}) {
  const mobile = props.mobile;

  // Default to "All" so the demo opens on the full inbox (Signal + Noise);
  // visitors can then filter to Signal to see the triage story.
  const [tab, setTab] = createSignal(2);
  // Hero mode opens directly on the inbox-zero state (the curated three are
  // pre-cleared), so the mock reads as "this is where Macro gets you" without
  // an intro animation. The empty-state button then loads the full inbox.
  const [done, setDone] = createSignal<number[]>(
    props.hero ? [...HERO_MAIL_IDS] : []
  );
  const [leaving, setLeaving] = createSignal<number[]>([]);
  const [labeled, setLabeled] = createSignal<number[]>([]);
  const [readIds, setReadIds] = createSignal<number[]>([]);
  const [selected, setSelected] = createSignal(0);
  // The reading pane starts open on desktop (it is the demo's best surface);
  // on mobile it would cover the list, so it starts closed there.
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [pressed, setPressed] = createSignal<string | null>(null);
  const [zeroCelebrate, setZeroCelebrate] = createSignal(false);
  // Hero mode starts on the pre-cleared inbox-zero state; the empty-state button
  // flips this on to reveal the full inbox for free play. Non-hero usage is free
  // play always.
  const [freePlay, setFreePlay] = createSignal(!props.hero);

  let shellEl: HTMLDivElement | undefined;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;

  const matchesTab = (mail: Mail) =>
    tab() === 2 ? true : tab() === 0 ? !mail.noise : !!mail.noise;
  // The email pool: the curated hero trio until the visitor opens the full
  // inbox, then every mail.
  const pool = () =>
    freePlay() ? MAILS : MAILS.filter((m) => HERO_MAIL_IDS.includes(m.id));
  // Strictly newest-first, so Signal and Noise interleave correctly in the
  // All tab (date buckets stay contiguous as a consequence).
  const visible = () =>
    pool()
      .filter((m) => !done().includes(m.id))
      .filter(matchesTab)
      .sort((a, b) => b.ts - a.ts);
  const isUnread = (mail: Mail) =>
    !!mail.unread && !readIds().includes(mail.id);
  const selMail = (): Mail | undefined => visible()[selected()];

  const markRead = (mail: Mail | undefined) => {
    if (!mail || !mail.unread || readIds().includes(mail.id)) return;
    setReadIds((prev) => [...prev, mail.id]);
  };

  type ListItem =
    | { kind: 'header'; label: string }
    | { kind: 'row'; mail: Mail; nav: number; lastInGroup: boolean };
  const grouped = (): ListItem[] => {
    const vis = visible();
    const items: ListItem[] = [];
    vis.forEach((mail, nav) => {
      const prev = vis[nav - 1];
      if (!prev || prev.group !== mail.group)
        items.push({ kind: 'header', label: mail.group });
      const next = vis[nav + 1];
      items.push({
        kind: 'row',
        mail,
        nav,
        lastInGroup: !next || next.group !== mail.group,
      });
    });
    return items;
  };

  const flashKey = (key: string) => {
    setPressed(key);
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(() => setPressed(null), 170);
  };

  const move = (delta: number) => {
    const count = visible().length;
    if (count === 0) return;
    setSelected((s) => Math.max(0, Math.min(s + delta, count - 1)));
    if (previewOpen()) markRead(selMail());
  };

  const selectTab = (index: number) => {
    setTab(index);
    setSelected(0);
    if (visible().length === 0) setPreviewOpen(false);
    // Hand focus straight back to the window so the browser's focus ring never
    // lands on the tab button and J/K/E keep working after a click.
    shellEl?.focus({ preventScroll: true });
  };

  const archiveCurrent = () => {
    const target = selMail();
    if (!target || leaving().includes(target.id)) return;
    setLeaving((prev) => [...prev, target.id]);
    setTimeout(() => {
      setDone((prev) => [...prev, target.id]);
      setLeaving((prev) => prev.filter((id) => id !== target.id));
      const count = visible().length;
      if (count === 0) {
        setPreviewOpen(false);
        // Re-trigger the celebration entrance each time zero is reached.
        setZeroCelebrate(false);
        setTimeout(() => setZeroCelebrate(true), 20);
      } else {
        setSelected((s) => Math.min(s, count - 1));
      }
    }, 230);
  };

  const toggleLabel = () => {
    const target = selMail();
    if (!target) return;
    setLabeled((prev) =>
      prev.includes(target.id)
        ? prev.filter((id) => id !== target.id)
        : [...prev, target.id]
    );
  };

  const reset = () => {
    setDone([]);
    setLeaving([]);
    setLabeled([]);
    setReadIds([]);
    setTab(2);
    setSelected(0);
    setPreviewOpen(false);
    setZeroCelebrate(false);
  };

  // Hero mode only: leave the curated inbox-zero teaser and hand the visitor
  // the full inbox to triage themselves.
  const enterFreePlay = () => {
    reset();
    setFreePlay(true);
    setPreviewOpen(!mobile());
    if (previewOpen()) markRead(selMail());
    shellEl?.focus({ preventScroll: true });
  };

  // Hero mode only: leave free play and return to the curated inbox-zero state
  // (the empty tray + the corner phone), as if the intro had just finished.
  const backToEmpty = () => {
    reset();
    setFreePlay(false);
    setDone([...HERO_MAIL_IDS]);
    // Replay the tray's entrance so the return reads as a deliberate reset.
    setTimeout(() => setZeroCelebrate(true), 20);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key === 'j' || key === 'arrowdown') {
      move(1);
      flashKey('J');
    } else if (key === 'k' || key === 'arrowup') {
      move(-1);
      flashKey('K');
    } else if (key === 'e') {
      archiveCurrent();
      flashKey('E');
    } else if (key === 'l') {
      toggleLabel();
      flashKey('L');
    } else if (key === 'enter' || key === 'o' || key === 'p') {
      if (visible().length > 0) {
        setPreviewOpen((open) => !open);
        if (previewOpen()) markRead(selMail());
      }
      flashKey(key === 'p' ? 'P' : '↵');
    } else if (key === 'escape') {
      // In the hero flow, Esc leaves the live demo entirely (back to inbox
      // zero); elsewhere it just closes the open preview.
      if (props.hero && freePlay()) {
        backToEmpty();
      } else {
        setPreviewOpen(false);
      }
      flashKey('ESC');
    } else {
      return;
    }
    event.preventDefault();
  };

  const splitOpen = () => previewOpen() && !mobile() && visible().length > 0;
  const overlayOpen = () => previewOpen() && mobile() && visible().length > 0;

  const rowBg = (nav: number) =>
    nav === selected() ? INK.rowHover : 'transparent';

  return (
    <section
      aria-label="Interactive Macro Mail demo"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        'padding-bottom': mobile() ? '30px' : '44px',
        'padding-inline': mobile() ? '18px' : '24px',
        // In hero mode the page owns the top spacing (it renders the section
        // copy above); elsewhere the component keeps its own top padding.
        'padding-top': props.hero ? '0' : mobile() ? '52px' : '84px',
        position: 'relative',
        width: '100%',
        'z-index': 1,
      }}
    >
      <style>{`
        .turbo-frame::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(
            135deg,
            color-mix(in srgb, var(--c1) 16%, transparent) 0%,
            transparent 24%,
            transparent 76%,
            color-mix(in srgb, var(--c1) 11%, transparent) 100%
          );
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask-composite: exclude;
          pointer-events: none;
          z-index: 2;
        }
        .turbo-shell:focus-visible {
          box-shadow: var(--shadow-window), 0 0 0 2px color-mix(in srgb, var(--c1) 30%, transparent);
        }
        @keyframes turboRowOut {
          0% { opacity: 1; transform: translateX(0); max-height: 72px; }
          55% { opacity: 0; transform: translateX(46px); max-height: 72px; }
          100% { opacity: 0; transform: translateX(46px); max-height: 0; padding-top: 0; padding-bottom: 0; }
        }
        .turbo-row-leaving {
          animation: turboRowOut 240ms cubic-bezier(0.3, 0.7, 0.4, 1) forwards;
          background-color: rgba(139, 139, 139, 0.16) !important;
          overflow: hidden;
          pointer-events: none;
        }
        @keyframes turboChipIn {
          from { opacity: 0; transform: scale(0.6); }
          to { opacity: 1; transform: scale(1); }
        }
        .turbo-label-chip { animation: turboChipIn 180ms cubic-bezier(0.2, 0.9, 0.4, 1.4) both; }
        @keyframes turboZeroIn {
          0% { opacity: 0; transform: scale(0.94) translateY(8px); }
          60% { opacity: 1; transform: scale(1.015) translateY(-1px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .turbo-zero { animation: turboZeroIn 460ms cubic-bezier(0.2, 0.9, 0.3, 1.1) both; }
        @keyframes turboPanelIn {
          from { opacity: 0; transform: translateX(14px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .turbo-panel { animation: turboPanelIn 200ms cubic-bezier(0.2, 0.8, 0.3, 1) both; }
        .turbo-scroll {
          scrollbar-width: thin;
          scrollbar-color: color-mix(in srgb, var(--c4) 28%, transparent) transparent;
        }
        .turbo-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
        .turbo-scroll::-webkit-scrollbar-track { background: transparent; }
        .turbo-scroll::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--c4) 26%, transparent);
          border-radius: 999px;
        }
        .turbo-scroll::-webkit-scrollbar-thumb:hover {
          background: color-mix(in srgb, var(--c4) 42%, transparent);
        }
        .turbo-keycap {
          transition: transform 90ms ease, border-color 90ms ease, color 90ms ease;
          transform: translateY(-1px);
        }
        .turbo-keycap[data-pressed='true'] {
          transform: translateY(0);
        }
        @keyframes turboPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .turbo-live-dot { animation: turboPulse 1.6s ease-in-out infinite; }
        @media (hover) {
          .turbo-row:hover { background-color: ${INK.rowHover}; }
          .turbo-tab:hover { color: ${INK.textBright}; }
          .turbo-reset:hover { border-color: ${INK.chipBorder}; color: ${INK.textBright}; }
          .turbo-cta:hover { transform: translateY(-1px); filter: brightness(1.06); }
        }
        .turbo-tab { outline: none; }
        .turbo-tab:focus-visible {
          outline: 1px solid color-mix(in srgb, var(--c1) 40%, transparent);
          outline-offset: 1px;
        }
        @media (prefers-reduced-motion: reduce) {
          .turbo-row-leaving, .turbo-zero, .turbo-panel, .turbo-label-chip { animation: none; }
          .turbo-row-leaving { display: none; }
          .turbo-live-dot { animation: none; }
        }
      `}</style>

      <div
        style={{
          display: 'grid',
          'justify-items': 'center',
          'max-width': props.hero && !mobile() ? '820px' : '1080px',
          position: 'relative',
          width: '100%',
        }}
      >
        <div style={{ width: '100%' }}>
          <div
            class="turbo-frame"
            style={{
              'border-radius': mobile() ? '11px' : '14px',
              // Clip inner content to the rounded corners so the window's inner
              // shadow isn't cut into sharp square "notches" by the square-
              // cornered zoom wrapper (visible now that the frame has a lighter
              // gradient behind it). The frame's own drop-shadow is unaffected.
              overflow: 'hidden',
              position: 'relative',
              'box-shadow': mobile()
                ? '0 18px 40px -22px rgb(0 0 0 / 0.7)'
                : '0 4px 12px -6px rgb(0 0 0 / 0.4), 0 26px 48px -18px rgb(0 0 0 / 0.55), 0 64px 100px -44px rgb(0 0 0 / 0.7)',
            }}
          >
            {/* TURBO_ZOOM via transform:scale — the same fixed-ratio "author at
                1x, scale, compensate the footprint" technique as
                HeroScaleToFit, just with a constant ratio instead of a
                measured one (turbo-shell is already fluid-width, so the
                footprint is known up front: height shrinks by TURBO_ZOOM,
                width compensates by growing the scaled layer by 1/TURBO_ZOOM
                so it lands back at exactly 100% after the visual scale). */}
            <div
              style={{
                height: `${(mobile() ? APP_PREVIEW_HEIGHT.mobile : APP_PREVIEW_HEIGHT.desktop) * TURBO_ZOOM}px`,
                overflow: 'hidden',
                width: '100%',
              }}
            >
              <div style={{ overflow: 'hidden', width: '100%' }}>
                <div
                  style={{
                    transform: `scale(${TURBO_ZOOM})`,
                    'transform-origin': 'top left',
                    width: `${100 / TURBO_ZOOM}%`,
                  }}
                >
                  {/* Window shell — matches PreviewWindow chrome, with a focusable region
                so the keyboard drives it. Hover focuses it so keys work instantly. */}
                  <div
                    ref={shellEl}
                    class="turbo-shell"
                    tabindex={0}
                    role="application"
                    aria-label="Interactive Macro Mail inbox. Use J and K to move, E to mark done, L to label, Enter to open the reading pane."
                    onKeyDown={onKeyDown}
                    onMouseEnter={() => shellEl?.focus({ preventScroll: true })}
                    style={{
                      'background-color': INK.bg,
                      border: `1.25px solid ${INK.outerBorder}`,
                      // The shell renders inside the TURBO_ZOOM (0.8) scale, so
                      // hero-card metrics are authored here at 1.25x to land at the
                      // same visual size: radius 17.5 -> 14, padding 10 -> 8.
                      'border-radius': mobile() ? '12.5px' : '17.5px',
                      'box-shadow': 'var(--shadow-window)',
                      'box-sizing': 'border-box',
                      height: mobile()
                        ? `${APP_PREVIEW_HEIGHT.mobile}px`
                        : `${APP_PREVIEW_HEIGHT.desktop}px`,
                      outline: 'none',
                      overflow: 'hidden',
                      padding: '10px',
                      position: 'relative',
                      width: '100%',
                    }}
                  >
                    <div
                      style={{
                        'background-color': INK.bg,
                        'border-radius': '5px',
                        display: 'grid',
                        'grid-template-columns': 'minmax(0, 1fr)',
                        'grid-template-rows': 'auto minmax(0, 1fr)',
                        height: '100%',
                        overflow: 'hidden',
                        position: 'relative',
                        'text-align': 'left',
                      }}
                    >
                      {/* Toolbar */}
                      <div
                        style={{
                          'align-items': 'center',
                          'border-bottom': `0.5px solid ${INK.hairline}`,
                          'box-sizing': 'border-box',
                          display: 'flex',
                          height: mobile() ? '42px' : 'auto',
                          'justify-content': 'space-between',
                          overflow: 'hidden',
                          padding: mobile() ? '0 13px' : '0 0 10px 10px',
                        }}
                      >
                        <div
                          style={{
                            'align-items': 'center',
                            display: 'flex',
                            gap: mobile() ? '10px' : '25px',
                          }}
                        >
                          <MacroMarkIcon
                            aria-label="Macro"
                            style={{
                              color: INK.textDim,
                              display: 'block',
                              fill: 'currentColor',
                              flex: 'none',
                              height: mobile() ? '12px' : '15px',
                              overflow: 'visible',
                              stroke: 'none',
                            }}
                          />

                          {/* Tabs — Signal gets the turbo treatment. */}
                          <div
                            style={{
                              'align-items': 'center',
                              'background-color': '#000',
                              border: `0.5px solid ${INK.hairline}`,
                              'border-radius': '9px',
                              display: 'flex',
                              flex: 'none',
                              gap: '10px',
                              padding: '3px',
                            }}
                          >
                            <For each={TABS}>
                              {(label, index) => {
                                const isActive = () => tab() === index();
                                return (
                                  <button
                                    type="button"
                                    class="turbo-tab"
                                    data-active={isActive() ? 'true' : 'false'}
                                    onClick={() => selectTab(index())}
                                    style={{
                                      'align-items': 'center',
                                      background: isActive()
                                        ? INK.chip
                                        : 'transparent',
                                      border: isActive()
                                        ? `0.5px solid ${INK.chipBorder}`
                                        : '0.5px solid transparent',
                                      'border-radius': '6px',
                                      'box-sizing': 'border-box',
                                      color: isActive()
                                        ? INK.textBright
                                        : INK.textMuted,
                                      cursor: 'pointer',
                                      display:
                                        mobile() && index() === 2
                                          ? 'none'
                                          : 'inline-flex',
                                      'font-family': appFont,
                                      'font-size': '12.5px',
                                      'font-weight': '500',
                                      height: '28px',
                                      'justify-content': 'center',
                                      padding: '0 10px',
                                      'white-space': 'nowrap',
                                    }}
                                  >
                                    {label}
                                  </button>
                                );
                              }}
                            </For>
                          </div>

                          <span
                            style={{
                              'align-items': 'center',
                              color: INK.textMuted,
                              display: 'inline-flex',
                              'font-family': appFont,
                              'font-size': '12.5px',
                              'font-weight': '500',
                              gap: '7px',
                              'white-space': 'nowrap',
                            }}
                          >
                            All inboxes <CaretDownIcon size={15} />
                          </span>
                        </div>

                        <Show when={!mobile()}>
                          <div
                            style={{
                              'align-items': 'center',
                              display: 'flex',
                              gap: '20px',
                            }}
                          >
                            {/* Compose — a circular icon button with the app's
                          square-pen "create" glyph (from macro apps/web). */}
                            <span
                              aria-label="Compose"
                              style={{
                                'align-items': 'center',
                                'background-color': INK.chip,
                                border: `0.5px solid ${INK.hairline}`,
                                'border-radius': '999px',
                                'box-sizing': 'border-box',
                                color: INK.textDim,
                                display: 'inline-flex',
                                flex: 'none',
                                height: '30px',
                                'justify-content': 'center',
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
                                style={{
                                  display: 'block',
                                  overflow: 'visible',
                                }}
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

                            {/* Search — mirrors the real app's toolbar search field. */}
                            <span
                              style={{
                                'align-items': 'center',
                                'background-color': '#000',
                                border: `0.5px solid ${INK.hairline}`,
                                'border-radius': '9px',
                                'box-sizing': 'border-box',
                                color: INK.textMuted,
                                display: 'inline-flex',
                                'font-family': appFont,
                                'font-size': '12.5px',
                                'font-weight': '500',
                                gap: '7px',
                                height: '30px',
                                padding: '0 11px',
                                'white-space': 'nowrap',
                                width: '205px',
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
                                    color: INK.textFaint,
                                    'font-size': '12.5px',
                                    'font-weight': '500',
                                  }}
                                >
                                  F
                                </span>
                              </span>
                            </span>
                          </div>
                        </Show>
                      </div>

                      {/* Content: list + optional reading pane */}
                      <div
                        style={{
                          display: 'grid',
                          'grid-template-columns': splitOpen()
                            ? 'minmax(0, 1.02fr) minmax(0, 0.98fr)'
                            : 'minmax(0, 1fr)',
                          'min-height': 0,
                          position: 'relative',
                        }}
                      >
                        {/* List */}
                        <div
                          class="turbo-scroll"
                          style={{
                            'align-content': 'start',
                            display: 'grid',
                            // A single full-height row when empty so the inbox-zero
                            // state can center vertically (a percentage min-height
                            // can't resolve inside an auto row).
                            'grid-template-rows':
                              visible().length === 0
                                ? 'minmax(0, 1fr)'
                                : 'none',
                            'min-height': 0,
                            'min-width': 0,
                            'overflow-x': 'hidden',
                            'overflow-y': 'auto',
                            'padding-block':
                              visible().length === 0 ? '0' : '10px',
                            'row-gap': visible().length === 0 ? '0' : '5px',
                          }}
                        >
                          <Show
                            when={visible().length > 0}
                            fallback={
                              <div
                                style={{
                                  'align-content': 'center',
                                  display: 'grid',
                                  'font-family': appFont,
                                  'justify-items': 'center',
                                  padding: '24px',
                                  position: 'relative',
                                }}
                              >
                                {/* The entrance animation lives on this content-sized
                            wrapper, not the full-height cell — its scale
                            overshoot would otherwise spill past the scrollport
                            and flash a scrollbar. */}
                                <div
                                  class={
                                    zeroCelebrate() ? 'turbo-zero' : undefined
                                  }
                                  style={{
                                    display: 'grid',
                                    gap: '10px',
                                    'justify-items': 'center',
                                  }}
                                >
                                  <EmptyInboxTray
                                    width={mobile() ? 120 : 150}
                                  />
                                  <span
                                    style={{
                                      color: INK.textBright,
                                      'font-size': '16px',
                                      'font-weight': '600',
                                      position: 'relative',
                                    }}
                                  >
                                    Inbox zero
                                  </span>
                                  <span
                                    style={{
                                      color: INK.textMuted,
                                      'font-size': '13px',
                                      position: 'relative',
                                      'text-align': 'center',
                                    }}
                                  >
                                    {props.hero && !freePlay()
                                      ? "You're all caught up. Enjoy the quiet."
                                      : `${done().length} email${done().length === 1 ? '' : 's'} handled. Nothing left${tab() === 0 ? ' in Signal' : tab() === 1 ? ' in Noise' : ''}.`}
                                  </span>
                                  {/* In hero mode the inbox-zero state is the lead, so the
                              button is the page's invitation into the live demo —
                              a filled accent pill; once in free play every zero
                              after that just replays with the quiet reset. */}
                                  <button
                                    type="button"
                                    class={
                                      props.hero && !freePlay()
                                        ? 'turbo-cta'
                                        : 'turbo-reset'
                                    }
                                    onClick={
                                      props.hero && !freePlay()
                                        ? enterFreePlay
                                        : reset
                                    }
                                    style={
                                      props.hero && !freePlay()
                                        ? {
                                            background: 'var(--a0)',
                                            border: '1px solid transparent',
                                            'border-radius': '999px',
                                            color: 'var(--b0)',
                                            cursor: 'pointer',
                                            'font-family': appFont,
                                            'font-size': '13px',
                                            'font-weight': '500',
                                            'margin-top': '8px',
                                            padding: '8px 18px',
                                            position: 'relative',
                                            transition:
                                              'transform 160ms ease, filter 160ms ease',
                                          }
                                        : {
                                            background: INK.chip,
                                            border: `0.5px solid ${INK.chipBorder}`,
                                            'border-radius': '999px',
                                            color: INK.textDim,
                                            cursor: 'pointer',
                                            'font-family': appFont,
                                            'font-size': '12px',
                                            'font-weight': '500',
                                            'margin-top': '4px',
                                            padding: '6px 14px',
                                            position: 'relative',
                                            transition:
                                              'border-color 160ms ease, color 160ms ease',
                                          }
                                    }
                                  >
                                    {props.hero && !freePlay()
                                      ? 'Try it yourself'
                                      : 'Replay demo'}
                                  </button>
                                </div>
                              </div>
                            }
                          >
                            <For each={grouped()}>
                              {(item) =>
                                item.kind === 'header' ? (
                                  <GroupDivider label={item.label} />
                                ) : (
                                  <div
                                    class={
                                      leaving().includes(item.mail.id)
                                        ? 'turbo-row turbo-row-leaving'
                                        : 'turbo-row'
                                    }
                                    onClick={() => {
                                      setSelected(item.nav);
                                      setPreviewOpen(true);
                                      markRead(item.mail);
                                    }}
                                    onMouseEnter={() => {
                                      if (!leaving().includes(item.mail.id))
                                        setSelected(item.nav);
                                    }}
                                    style={{
                                      'align-items': 'center',
                                      'background-color': rowBg(item.nav),
                                      'border-radius': '7.5px',
                                      cursor: 'pointer',
                                      display: 'grid',
                                      gap: mobile() ? '9px' : '10px',
                                      'grid-template-columns': mobile()
                                        ? 'auto auto 92px minmax(0, 1fr) auto'
                                        : 'auto auto 125px minmax(0, 1fr) auto',
                                      height: mobile() ? 'auto' : '30px',
                                      'max-height': '72px',
                                      padding: mobile() ? '8px 7px' : '0 10px',
                                    }}
                                  >
                                    <span
                                      aria-hidden="true"
                                      style={{
                                        'background-color': isUnread(item.mail)
                                          ? INK.unreadDot
                                          : 'transparent',
                                        'border-radius': '999px',
                                        flex: 'none',
                                        height: '5px',
                                        width: '5px',
                                      }}
                                    />
                                    <EnvelopeGlyph
                                      calendar={item.mail.calendar}
                                      unread={isUnread(item.mail)}
                                    />
                                    <span
                                      style={{
                                        color: isUnread(item.mail)
                                          ? INK.textBright
                                          : INK.textDim,
                                        'font-family': appFont,
                                        'font-size': mobile()
                                          ? '13px'
                                          : '12.5px',
                                        'font-weight': 500,
                                        'min-width': 0,
                                        overflow: 'hidden',
                                        'text-overflow': 'ellipsis',
                                        'white-space': 'nowrap',
                                      }}
                                    >
                                      {item.mail.who}
                                    </span>
                                    {/* Subject + preview flow together and fill the
                                  track to the date column, truncating with an
                                  ellipsis — same treatment whether or not the
                                  reading pane is open. */}
                                    <div
                                      style={{
                                        'align-items': 'baseline',
                                        display: 'flex',
                                        gap: '10px',
                                        'min-width': 0,
                                        overflow: 'hidden',
                                      }}
                                    >
                                      <span
                                        style={{
                                          color: isUnread(item.mail)
                                            ? INK.textBright
                                            : INK.textDim,
                                          flex: '0 1 auto',
                                          'font-family': appFont,
                                          'font-size': '12.5px',
                                          'font-weight': 500,
                                          'min-width': 0,
                                          overflow: 'hidden',
                                          'text-overflow': 'ellipsis',
                                          'white-space': 'nowrap',
                                        }}
                                      >
                                        {item.mail.subject}
                                      </span>
                                      <Show when={!mobile()}>
                                        <span
                                          style={{
                                            color: INK.textMuted,
                                            flex: '1 1 0',
                                            'font-family': appFont,
                                            'font-size': '12.5px',
                                            'font-weight': 500,
                                            'min-width': 0,
                                            overflow: 'hidden',
                                            'text-overflow': 'ellipsis',
                                            'white-space': 'nowrap',
                                          }}
                                        >
                                          {item.mail.preview}
                                        </span>
                                      </Show>
                                    </div>
                                    <span
                                      style={{
                                        'align-items': 'center',
                                        display: 'flex',
                                        flex: 'none',
                                        gap: '8px',
                                      }}
                                    >
                                      <Show
                                        when={labeled().includes(item.mail.id)}
                                      >
                                        <span
                                          class="turbo-label-chip"
                                          style={{
                                            'background-color': INK.chip,
                                            border: `0.5px solid ${INK.chipBorder}`,
                                            'border-radius': '5px',
                                            color: INK.textDim,
                                            'font-family': appFont,
                                            'font-size': '10px',
                                            'font-weight': '700',
                                            'letter-spacing': '0.04em',
                                            'line-height': 1,
                                            padding: '3px 5px',
                                          }}
                                        >
                                          VIP
                                        </span>
                                      </Show>
                                      <span
                                        style={{
                                          color: INK.textDim,
                                          'font-family': appFont,
                                          'font-size': '12.5px',
                                          'font-weight': 500,
                                          'text-align': 'right',
                                          'white-space': 'nowrap',
                                          width: '80px',
                                        }}
                                      >
                                        {item.mail.time}
                                      </span>
                                    </span>
                                  </div>
                                )
                              }
                            </For>
                          </Show>
                        </div>

                        {/* Reading pane (desktop split) */}
                        <Show when={splitOpen()}>
                          <ReadingPane
                            mail={selMail()!}
                            labeled={labeled().includes(selMail()!.id)}
                            mobile={false}
                            onClose={() => setPreviewOpen(false)}
                            onDone={archiveCurrent}
                          />
                        </Show>

                        {/* Reading pane (mobile overlay) */}
                        <Show when={overlayOpen()}>
                          <div
                            style={{
                              'background-color': INK.bg,
                              inset: '0',
                              position: 'absolute',
                              'z-index': 3,
                            }}
                          >
                            <ReadingPane
                              mail={selMail()!}
                              labeled={labeled().includes(selMail()!.id)}
                              mobile
                              onClose={() => setPreviewOpen(false)}
                              onDone={archiveCurrent}
                            />
                          </div>
                        </Show>
                      </div>
                    </div>

                    {/* Ambient light over the whole panel, matching the homepage
                  mockup: a soft highlight pooling in the top-left and a gentle
                  shade in the bottom-right. */}
                    <div
                      aria-hidden="true"
                      style={{
                        background:
                          'radial-gradient(125% 115% at 0% 0%, color-mix(in srgb, var(--ambient-ink) 5%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 2%, transparent) 22%, transparent 52%), ' +
                          'radial-gradient(130% 118% at 100% 100%, color-mix(in srgb, var(--b0) 26%, transparent) 0%, color-mix(in srgb, var(--b0) 9%, transparent) 28%, transparent 58%)',
                        'border-radius': mobile() ? '12.5px' : '17.5px',
                        inset: '0',
                        'pointer-events': 'none',
                        position: 'absolute',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Hero mode only: the AI-compose phone from the "drafts you'd actually
            send" section, resting on the mock's lower-right corner as a
            supporting device. Decorative (pointer-events: none) so it never
            steals the keyboard-triage focus that is the demo's whole point;
            scaled down from its natural size and anchored bottom-right so it
            juts just past the edge. Hidden on mobile, where there is no room,
            and once the visitor opens the full inbox (free play), where the
            keystroke guide takes over the lower edge. */}
        <Show when={props.hero && !mobile() && !freePlay()}>
          <div
            aria-hidden="true"
            style={{
              bottom: '-56px',
              filter: 'drop-shadow(0 44px 80px rgb(0 0 0 / 0.6))',
              'pointer-events': 'none',
              position: 'absolute',
              right: '-48px',
              transform: 'scale(0.74)',
              'transform-origin': 'bottom right',
              width: '280px',
              'z-index': 3,
            }}
          >
            <AiComposeGraphic />
          </div>
        </Show>

        {/* Keystroke guide — a single backgroundless row below the mock:
            "Live demo" pinned left, the shortcut legend in a line, and the
            "exit" button (back to inbox-zero) pinned right. Only shown once the
            visitor opens the full inbox for free play; wraps on mobile. */}
        <Show when={freePlay()}>
          <div
            style={{
              'align-items': 'center',
              'box-sizing': 'border-box',
              'column-gap': '16px',
              display: 'flex',
              'flex-wrap': 'wrap',
              'justify-content': 'space-between',
              'margin-top': mobile() ? '28px' : '20px',
              position: 'relative',
              'row-gap': '10px',
              width: '100%',
              'z-index': 4,
            }}
          >
            {/* Live demo — pinned left */}
            <span
              style={{
                'align-items': 'center',
                color: 'var(--c4)',
                display: 'inline-flex',
                flex: 'none',
                'font-family': appFont,
                'font-size': '11.5px',
                gap: '6px',
              }}
            >
              <span
                class="turbo-live-dot"
                style={{
                  'background-color': 'var(--a0)',
                  'border-radius': '999px',
                  display: 'block',
                  height: '6px',
                  width: '6px',
                }}
              />
              Live demo
            </span>

            {/* Shortcut legend — a single line, no background */}
            <Show
              when={!mobile()}
              fallback={
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '12px',
                  }}
                >
                  Tap an email to read it — ✓ marks it done
                </span>
              }
            >
              <div
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  'flex-wrap': 'wrap',
                  gap: '18px',
                  'justify-content': 'center',
                }}
              >
                <HintGroup label="Navigate">
                  <Keycap
                    label="J"
                    pressed={pressed() === 'J'}
                    onPress={() => {
                      move(1);
                      flashKey('J');
                    }}
                  />
                  <Keycap
                    label="K"
                    pressed={pressed() === 'K'}
                    onPress={() => {
                      move(-1);
                      flashKey('K');
                    }}
                  />
                </HintGroup>
                <HintGroup label="Mark done">
                  <Keycap
                    label="E"
                    pressed={pressed() === 'E'}
                    onPress={() => {
                      archiveCurrent();
                      flashKey('E');
                    }}
                  />
                </HintGroup>
                <HintGroup label="Label">
                  <Keycap
                    label="L"
                    pressed={pressed() === 'L'}
                    onPress={() => {
                      toggleLabel();
                      flashKey('L');
                    }}
                  />
                </HintGroup>
                <HintGroup label="Preview">
                  <Keycap
                    label="↵"
                    wide
                    pressed={pressed() === '↵'}
                    onPress={() => {
                      if (visible().length > 0) setPreviewOpen((open) => !open);
                      flashKey('↵');
                    }}
                  />
                  <Keycap
                    label="P"
                    pressed={pressed() === 'P'}
                    onPress={() => {
                      if (visible().length > 0) setPreviewOpen((open) => !open);
                      flashKey('P');
                    }}
                  />
                </HintGroup>
                <HintGroup label="Exit">
                  <Keycap
                    label="Esc"
                    wide
                    pressed={pressed() === 'ESC'}
                    onPress={() => {
                      backToEmpty();
                      flashKey('ESC');
                    }}
                  />
                </HintGroup>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </section>
  );
}

function HintGroup(props: { label: string; children: JSX.Element }) {
  return (
    <span
      style={{ 'align-items': 'center', display: 'inline-flex', gap: '6px' }}
    >
      <span
        style={{
          color: 'var(--c4)',
          'font-family': appFont,
          'font-size': '11.5px',
          'font-weight': '300',
          'white-space': 'nowrap',
        }}
      >
        {props.label}
      </span>
      <span
        style={{ 'align-items': 'center', display: 'inline-flex', gap: '4px' }}
      >
        {props.children}
      </span>
    </span>
  );
}

// The reading pane: rendered as the right split on desktop and a full-window
// overlay on mobile. Bodies are rich — people, docs, and tasks render as the
// same mention chips the real editor produces.
function ReadingPane(props: {
  mail: Mail;
  labeled: boolean;
  mobile: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <div
      class="turbo-panel"
      style={{
        'border-left': props.mobile ? 'none' : `0.5px solid ${INK.hairline}`,
        display: 'grid',
        'grid-template-rows': 'auto minmax(0, 1fr) auto',
        height: '100%',
        'min-width': 0,
        overflow: 'hidden',
      }}
    >
      {/* Pane header */}
      <div
        style={{
          'border-bottom': `0.5px solid ${INK.hairline}`,
          display: 'grid',
          gap: '10px',
          padding: props.mobile ? '12px 13px' : '14px 20px',
        }}
      >
        <div style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}>
          <Show when={props.mobile}>
            <button
              type="button"
              aria-label="Back to inbox"
              onClick={props.onClose}
              style={{
                'align-items': 'center',
                background: 'transparent',
                border: 'none',
                color: INK.textDim,
                cursor: 'pointer',
                display: 'inline-flex',
                'font-family': appFont,
                'font-size': '12.5px',
                gap: '3px',
                padding: '0',
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
                  d="M15 6l-6 6 6 6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              Inbox
            </button>
          </Show>
          <span
            style={{
              color: INK.textBright,
              'font-family': appFont,
              'font-size': props.mobile ? '14px' : '15px',
              'font-weight': '600',
              'min-width': 0,
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            {props.mail.subject}
          </span>
          <Show when={props.labeled}>
            <span
              class="turbo-label-chip"
              style={{
                'background-color': INK.chip,
                border: `0.5px solid ${INK.chipBorder}`,
                'border-radius': '5px',
                color: INK.textDim,
                flex: 'none',
                'font-family': appFont,
                'font-size': '10px',
                'font-weight': '700',
                'letter-spacing': '0.04em',
                'line-height': 1,
                padding: '3px 5px',
              }}
            >
              VIP
            </span>
          </Show>
          <Show when={!props.mobile}>
            <button
              type="button"
              aria-label="Close reading pane"
              onClick={props.onClose}
              style={{
                'align-items': 'center',
                background: 'transparent',
                border: 'none',
                color: INK.textMuted,
                cursor: 'pointer',
                display: 'inline-flex',
                'margin-left': 'auto',
                padding: '2px',
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                aria-hidden="true"
                style={{ display: 'block' }}
              >
                <path
                  d="M6 6l12 12M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </Show>
        </div>
        <div style={{ 'align-items': 'center', display: 'flex', gap: '9px' }}>
          <Avatar initials={props.mail.initials} size={24} />
          <span
            style={{
              color: INK.textDim,
              'font-family': appFont,
              'font-size': '12.5px',
              'font-weight': '500',
            }}
          >
            {props.mail.who}
          </span>
          <span
            style={{
              color: INK.textMuted,
              'font-family': appFont,
              'font-size': '12px',
              'min-width': 0,
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            {props.mail.from}
          </span>
          <span
            style={{
              color: INK.textMuted,
              'font-family': appFont,
              'font-size': '11.5px',
              'margin-left': 'auto',
              'white-space': 'nowrap',
            }}
          >
            {props.mail.time}
          </span>
        </div>
      </div>

      {/* Body */}
      <div
        class="turbo-scroll"
        style={{
          'align-content': 'start',
          display: 'grid',
          gap: '12px',
          'min-height': 0,
          'overflow-y': 'auto',
          padding: props.mobile ? '14px 13px' : '16px 20px',
        }}
      >
        {/* Collapsed thread history — threads have a past; showing it (folded)
            is what makes the pane read as a live client. */}
        <Show when={props.mail.thread}>
          <div
            style={{ 'align-items': 'center', display: 'flex', gap: '10px' }}
          >
            <span
              style={{
                'align-items': 'center',
                color: INK.textMuted,
                display: 'inline-flex',
                flex: 'none',
                'font-family': appFont,
                'font-size': '11.5px',
                gap: '6px',
                'line-height': 1,
                'white-space': 'nowrap',
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                aria-hidden="true"
                style={{ display: 'block' }}
              >
                <circle cx="12" cy="5" r="1.6" fill="currentColor" />
                <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                <circle cx="12" cy="19" r="1.6" fill="currentColor" />
              </svg>
              {props.mail.thread} earlier
            </span>
            <span
              aria-hidden="true"
              style={{
                'background-color': INK.hairline,
                flex: '1 1 0',
                height: '0.5px',
              }}
            />
          </div>
        </Show>
        <For each={props.mail.body}>
          {(para) => (
            <p
              style={{
                color: INK.textDim,
                'font-family': appFont,
                'font-size': props.mobile ? '13px' : '13.5px',
                'line-height': 1.65,
                margin: '0',
                'white-space': 'pre-line',
              }}
            >
              <For each={para}>{(seg) => <BodySeg seg={seg} />}</For>
            </p>
          )}
        </For>
      </div>

      {/* Action toolbar — pinned to the pane bottom. */}
      <div
        style={{
          'align-items': 'center',
          'border-top': `0.5px solid ${INK.hairline}`,
          display: 'flex',
          gap: '8px',
          padding: props.mobile ? '10px 13px 12px' : '12px 20px 14px',
        }}
      >
        <span
          style={{
            'align-items': 'center',
            'background-color': INK.chip,
            border: `0.5px solid ${INK.hairline}`,
            'border-radius': '999px',
            color: INK.textDim,
            display: 'inline-flex',
            'font-family': appFont,
            'font-size': '12px',
            'font-weight': '400',
            gap: '5px',
            padding: '5px 11px',
            'white-space': 'nowrap',
          }}
        >
          <IconReply
            aria-hidden="true"
            style={{
              display: 'block',
              flex: 'none',
              height: '12px',
              width: '12px',
            }}
          />
          Reply
          <span style={{ color: INK.textMuted, 'font-size': '10.5px' }}>R</span>
        </span>
        <span
          aria-label="Reply all"
          role="img"
          style={{
            'align-items': 'center',
            'background-color': INK.chip,
            border: `0.5px solid ${INK.hairline}`,
            'border-radius': '999px',
            color: INK.textDim,
            display: 'inline-flex',
            flex: 'none',
            height: '25px',
            'justify-content': 'center',
            width: '25px',
          }}
        >
          <IconReplyAll
            aria-hidden="true"
            style={{
              display: 'block',
              flex: 'none',
              height: '12px',
              width: '12px',
            }}
          />
        </span>
        <span
          aria-label="Forward"
          role="img"
          style={{
            'align-items': 'center',
            'background-color': INK.chip,
            border: `0.5px solid ${INK.hairline}`,
            'border-radius': '999px',
            color: INK.textDim,
            display: 'inline-flex',
            flex: 'none',
            height: '25px',
            'justify-content': 'center',
            width: '25px',
          }}
        >
          <IconForward
            aria-hidden="true"
            style={{
              display: 'block',
              flex: 'none',
              height: '12px',
              width: '12px',
            }}
          />
        </span>
        <span
          style={{
            'align-items': 'center',
            'background-color': INK.chip,
            border: `0.5px solid ${INK.hairline}`,
            'border-radius': '999px',
            color: INK.textDim,
            display: 'inline-flex',
            'font-family': appFont,
            'font-size': '12px',
            'font-weight': '400',
            gap: '5px',
            padding: '5px 11px',
            'white-space': 'nowrap',
          }}
        >
          <IconStar
            aria-hidden="true"
            style={{
              display: 'block',
              flex: 'none',
              height: '16px',
              width: '16px',
            }}
          />
          Draft with AI
        </span>
        <button
          type="button"
          onClick={props.onDone}
          style={{
            'align-items': 'center',
            'background-color': INK.chip,
            border: `0.5px solid ${INK.chipBorder}`,
            'border-radius': '999px',
            color: INK.textBright,
            cursor: 'pointer',
            display: 'inline-flex',
            'font-family': appFont,
            'font-size': '12px',
            'font-weight': '450',
            gap: '5px',
            'margin-left': 'auto',
            padding: '5px 11px',
            'white-space': 'nowrap',
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{ display: 'block' }}
          >
            <path
              d="M4 12.5 L9.5 18 L20 6.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          Done
          <span
            style={{
              'font-weight': '400',
              opacity: 0.7,
              'font-size': '10.5px',
            }}
          >
            E
          </span>
        </button>
      </div>
    </div>
  );
}
