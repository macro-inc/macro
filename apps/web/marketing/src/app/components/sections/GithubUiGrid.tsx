import { For, type JSX, Show } from 'solid-js';
import IconGithub from '../../../assets/icons/icon-github.svg';
import { viewportWidth } from '../../utils/utilBreakpoint';

// Concrete 2x2 grid of GitHub-in-Macro UI elements, mirroring DocumentsUiGrid:
// grayscale near-black mocks above captions. Each cell shows
// exactly one legible mock — no layered/dimmed compositions — so the four
// graphics stay distinct at a glance: an inbox list, a chat message, a task
// record, and a synced comment pair.

type UiCell = {
  title: string;
  body: string;
  Graphic: () => JSX.Element;
  // Cell 1's list fades out at the bottom ("the list continues"); cards that
  // end in a sentence stay fully visible instead of being sliced by the mask.
  fade?: boolean;
};

// Linear-style near-black surface stack above the page bg (--b0).
const ghSurfaceL2 = '#0a0a0a';
const ghPanelBorder = 'color-mix(in srgb, var(--c4) 12%, transparent)';
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Diff stats stay green/red because they're meaningful, but kept subtle.
const PR_GREEN = 'var(--a2)';
const PR_PURPLE = 'var(--a4)';
const DIFF_RED = 'oklch(0.72 0.17 22)';

function CardShell(props: { children: JSX.Element; width?: string }) {
  return (
    <div
      style={{
        'background-color': ghSurfaceL2,
        border: `1px solid ${ghPanelBorder}`,
        'border-radius': '12px',
        'box-shadow': '0 22px 60px rgb(0 0 0 / 0.5)',
        'box-sizing': 'border-box',
        overflow: 'hidden',
        'text-align': 'left',
        width: props.width ?? 'min(360px, 100%)',
      }}
    >
      {props.children}
    </div>
  );
}

// --- Shared glyphs ----------------------------------------------------------

function PrGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
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

// Octicon git-merge, for the merged row in the inbox list.
function MergeGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
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

function MailGlyph(props: { size?: number; color?: string }) {
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

function CheckCircleGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 13;
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

function _SyncGlyph(props: { size?: number; color?: string }) {
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

function Avatar(props: { initials: string; size?: number }) {
  const s = props.size ?? 24;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': 'var(--b3)',
        border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        display: 'inline-grid',
        flex: 'none',
        'font-family': appFont,
        'font-size': `${Math.round(s * 0.38)}px`,
        'font-weight': 600,
        height: `${s}px`,
        'place-items': 'center',
        width: `${s}px`,
      }}
    >
      {props.initials}
    </span>
  );
}

function DiffStat(props: { add: number; del: number; size?: number }) {
  const fs = props.size ?? 11.5;
  return (
    <span
      style={{
        'align-items': 'center',
        display: 'inline-flex',
        'font-family': "'rajdhani', body",
        'font-size': `${fs}px`,
        'font-weight': 700,
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

function StatusPill() {
  return (
    <span
      style={{
        'align-items': 'center',
        border: `1px solid color-mix(in srgb, ${PR_GREEN} 40%, transparent)`,
        'border-radius': '999px',
        color: PR_GREEN,
        display: 'inline-flex',
        'font-family': appFont,
        'font-size': '11px',
        'font-weight': 600,
        gap: '5px',
        padding: '2px 9px 2px 7px',
      }}
    >
      <PrGlyph size={11} color={PR_GREEN} />
      Open
    </span>
  );
}

// --- Cell 1: the unified inbox itself (PRs land next to email & chat) --------
type MiniRow =
  | {
      kind: 'pr';
      title: string;
      ref: string;
      unread?: boolean;
      merged?: boolean;
    }
  | { kind: 'email'; who: string; note: string; unread?: boolean }
  | { kind: 'message'; who: string; note: string };

const miniInboxRows: (MiniRow & { time: string })[] = [
  {
    kind: 'pr',
    title: 'Add PR entity type filter',
    ref: '#4107',
    unread: true,
    time: '12:05',
  },
  {
    kind: 'email',
    who: 'Mary Kim',
    note: 'Re: auth refactor',
    unread: true,
    time: '11:58',
  },
  {
    kind: 'pr',
    title: 'fix(split): spotlight classes',
    ref: '#4113',
    unread: true,
    time: '12:03',
  },
  {
    kind: 'message',
    who: '#eng-reviews',
    note: 'Can you take a look?',
    time: '11:52',
  },
  { kind: 'pr', title: 'fix(email): double init', ref: '#4109', time: '11:45' },
  {
    kind: 'pr',
    title: 'feat(doppler): iac projects',
    ref: '#4106',
    merged: true,
    time: '11:44',
  },
];

function MiniInboxRowIcon(props: { row: MiniRow }) {
  const r = props.row;
  if (r.kind === 'pr') {
    return (
      <span style={{ display: 'inline-flex' }}>
        <Show
          when={r.merged}
          fallback={<PrGlyph size={13} color="var(--a0)" />}
        >
          <MergeGlyph size={13} color={PR_PURPLE} />
        </Show>
      </span>
    );
  }
  if (r.kind === 'message')
    return (
      <span
        style={{
          color: 'var(--c4)',
          'font-family': appFont,
          'font-size': '14px',
          'font-weight': 700,
        }}
      >
        #
      </span>
    );
  return (
    <span style={{ color: 'var(--c4)', display: 'inline-flex' }}>
      <MailGlyph size={13} color="var(--c4)" />
    </span>
  );
}

function MiniInbox() {
  return (
    <CardShell width="min(420px, 100%)">
      <div
        style={{
          'align-items': 'center',
          'border-bottom': `1px solid ${ghPanelBorder}`,
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
            'font-weight': 600,
          }}
        >
          Inbox
        </span>
        <span
          style={{
            color: 'var(--c4)',
            'font-family': appFont,
            'font-size': '12px',
            'margin-left': 'auto',
          }}
        >
          Signal
        </span>
      </div>
      <For each={miniInboxRows}>
        {(row, i) => (
          <div
            style={{
              'align-items': 'center',
              'border-bottom':
                i() === miniInboxRows.length - 1
                  ? '0'
                  : `1px solid ${ghPanelBorder}`,
              display: 'grid',
              gap: '10px',
              'grid-template-columns': 'auto auto minmax(0, 1fr) auto',
              padding: '10px 14px',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                'background-color': (row as { unread?: boolean }).unread
                  ? 'var(--a0)'
                  : 'transparent',
                'border-radius': '999px',
                flex: 'none',
                height: '6px',
                width: '6px',
              }}
            />
            <span
              style={{
                'align-items': 'center',
                display: 'inline-flex',
                'justify-content': 'center',
                width: '16px',
              }}
            >
              <MiniInboxRowIcon row={row} />
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
                    'font-size': '13px',
                    'font-weight': (row as { unread?: boolean }).unread
                      ? 700
                      : 500,
                  }}
                >
                  {(row as { who: string }).who}{' '}
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '13px',
                  }}
                >
                  {(row as { note: string }).note}
                </span>
              </Show>
              <Show when={row.kind === 'message'}>
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': '13px',
                    'font-weight': 600,
                  }}
                >
                  {(row as { who: string }).who}{' '}
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '13px',
                  }}
                >
                  {(row as { note: string }).note}
                </span>
              </Show>
              <Show when={row.kind === 'pr'}>
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': '13px',
                    'font-weight': (row as { unread?: boolean }).unread
                      ? 600
                      : 500,
                  }}
                >
                  {(row as { title: string }).title}{' '}
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '13px',
                  }}
                >
                  {(row as { ref: string }).ref}
                </span>
              </Show>
            </span>
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
          </div>
        )}
      </For>
    </CardShell>
  );
}

// --- Cell 2: @mention a PR in a message --------------------------------------
function MentionCard() {
  return (
    <CardShell width="min(340px, 100%)">
      <div
        style={{
          'align-items': 'flex-start',
          display: 'flex',
          gap: '10px',
          padding: '14px 15px',
        }}
      >
        <Avatar initials="JB" size={26} />
        <div
          style={{ display: 'grid', gap: '6px', 'min-width': 0, width: '100%' }}
        >
          <p
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
              'line-height': 1.5,
              margin: 0,
            }}
          >
            <span style={{ color: 'var(--c1)', 'font-weight': 500 }}>
              <span
                style={{
                  display: 'inline-flex',
                  'margin-right': '3px',
                  'vertical-align': 'middle',
                }}
              >
                <Avatar initials="MK" size={15} />
              </span>
              <span
                style={{
                  'text-decoration': 'underline',
                  'text-decoration-color':
                    'color-mix(in srgb, var(--c4) 45%, transparent)',
                  'text-underline-offset': '2px',
                }}
              >
                Mary
              </span>
            </span>{' '}
            can you review{' '}
            <span
              style={{
                color: 'var(--c1)',
                'font-weight': 500,
                'white-space': 'nowrap',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  'margin-right': '3px',
                  'vertical-align': 'middle',
                }}
              >
                <PrGlyph size={12} color="var(--a0)" />
              </span>
              <span
                style={{
                  'text-decoration': 'underline',
                  'text-decoration-color':
                    'color-mix(in srgb, var(--c4) 45%, transparent)',
                  'text-underline-offset': '2px',
                }}
              >
                #4109
              </span>
            </span>
            ?
          </p>
          <div
            style={{
              background: 'var(--b0)',
              border: `1px solid ${ghPanelBorder}`,
              'border-radius': '9px',
              'box-sizing': 'border-box',
              display: 'grid',
              gap: '8px',
              padding: '10px 11px',
            }}
          >
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
            >
              <PrGlyph size={13} color="var(--a0)" />
              <span
                style={{
                  color: 'var(--c1)',
                  'font-family': appFont,
                  'font-size': '12.5px',
                  'font-weight': 600,
                  'min-width': 0,
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                }}
              >
                fix(auth): stop double session init
              </span>
            </div>
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
            >
              <StatusPill />
              <span
                style={{
                  'align-items': 'center',
                  color: PR_GREEN,
                  display: 'inline-flex',
                  'font-family': appFont,
                  'font-size': '11px',
                  gap: '4px',
                  'margin-left': 'auto',
                }}
              >
                <CheckCircleGlyph size={11} /> 14 passed
              </span>
            </div>
          </div>
        </div>
      </div>
    </CardShell>
  );
}

// --- Cell 3: task linked to a PR ---------------------------------------------
function ReviewProgressGlyph(props: { size?: number }) {
  const s = props.size ?? 14;
  const c = 'var(--c2)';
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

function TaskLinkMock() {
  return (
    <CardShell width="min(360px, 100%)">
      <div style={{ display: 'grid', gap: '13px', padding: '16px 17px' }}>
        <span
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': '15.5px',
            'font-weight': 600,
            'letter-spacing': '-0.01em',
            'line-height': 1.25,
          }}
        >
          Fix duplicate session init on login
        </span>
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
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--c4) 7%, transparent)',
              border: `1px solid ${ghPanelBorder}`,
              'border-radius': '8px',
              'box-sizing': 'border-box',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '12.5px',
              gap: '6px',
              padding: '5px 9px',
            }}
          >
            <ReviewProgressGlyph size={13} />
            <span style={{ color: 'var(--c1)', 'font-weight': 500 }}>
              In review
            </span>
          </span>
          <span
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--c4) 7%, transparent)',
              border: `1px solid ${ghPanelBorder}`,
              'border-radius': '8px',
              'box-sizing': 'border-box',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '12.5px',
              gap: '6px',
              padding: '5px 9px',
            }}
          >
            <Avatar initials="GB" size={17} />
            <span style={{ color: 'var(--c1)', 'font-weight': 500 }}>
              gbirman
            </span>
          </span>
        </div>
        <div
          style={{
            'align-items': 'center',
            'background-color': 'color-mix(in srgb, var(--c4) 7%, transparent)',
            border: `1px solid ${ghPanelBorder}`,
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
              'font-size': '12.5px',
              'font-weight': 500,
              'min-width': 0,
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            fix(auth): stop double session init
          </span>
          <span style={{ flex: 'none' }}>
            <DiffStat add={6} del={20} />
          </span>
        </div>
      </div>
    </CardShell>
  );
}

// --- Cell 4: comments synced both ways ---------------------------------------
// --- Cell 4: notifications that actually work — a push-banner stack ---------
function PushNotificationsMock() {
  const banner: JSX.CSSProperties = {
    'align-items': 'center',
    'background-color': 'color-mix(in srgb, var(--b1) 92%, var(--b0))',
    border: '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
    'border-radius': '14px',
    'box-shadow': 'var(--shadow-panel-lg)',
    'box-sizing': 'border-box',
    display: 'flex',
    gap: '11px',
    padding: '12px 14px',
    width: '100%',
  };
  const appBadge = (
    <span
      style={{
        'align-items': 'center',
        'background-color': 'color-mix(in srgb, var(--a0) 16%, var(--b0))',
        border: '1px solid color-mix(in srgb, var(--a0) 30%, transparent)',
        'border-radius': '9px',
        color: 'var(--a0)',
        display: 'inline-grid',
        flex: 'none',
        height: '30px',
        'place-items': 'center',
        width: '30px',
      }}
      aria-hidden="true"
    >
      <PrGlyph size={15} color="var(--a0)" />
    </span>
  );
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: '24px',
        width: '100%',
      }}
    >
      <div style={{ display: 'grid', gap: '0', width: 'min(380px, 100%)' }}>
        {/* Older banner, tucked behind */}
        <div
          aria-hidden="true"
          style={{
            ...banner,
            opacity: 0.5,
            transform: 'scale(0.94)',
            'transform-origin': 'center bottom',
          }}
        >
          {appBadge}
          <div style={{ display: 'grid', gap: '1px', 'min-width': 0 }}>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '13px',
                'font-weight': 600,
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
              }}
            >
              gbirman requested your review
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '12px',
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
              }}
            >
              fix(split): spotlight classes #4113
            </span>
          </div>
          <span
            style={{
              color: 'var(--c4)',
              flex: 'none',
              'font-family': appFont,
              'font-size': '11.5px',
              'margin-left': 'auto',
            }}
          >
            11:52
          </span>
        </div>
        {/* Fresh banner in front */}
        <div
          style={{
            ...banner,
            'margin-top': '-14px',
            position: 'relative',
            'z-index': 1,
          }}
        >
          {appBadge}
          <div style={{ display: 'grid', gap: '1px', 'min-width': 0 }}>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '13px',
                'font-weight': 600,
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
              }}
            >
              Julia approved fix(auth) #4109
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '12px',
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
              }}
            >
              All 14 checks passed — ready to merge
            </span>
          </div>
          <span
            style={{
              color: 'var(--c4)',
              flex: 'none',
              'font-family': appFont,
              'font-size': '11.5px',
              'margin-left': 'auto',
            }}
          >
            now
          </span>
        </div>
        {/* Unread state carried into the inbox */}
        <div
          style={{
            'align-items': 'center',
            display: 'flex',
            gap: '8px',
            'justify-content': 'center',
            'margin-top': '14px',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              'background-color': 'var(--a0)',
              'border-radius': '999px',
              flex: 'none',
              height: '6px',
              width: '6px',
            }}
          />
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '12px',
            }}
          >
            Stays unread until you act on it
          </span>
        </div>
      </div>
    </div>
  );
}

const cells: UiCell[] = [
  {
    title: 'PRs in your inbox',
    body: 'Pull requests and review requests land in the same fast list as your email and chat.',
    Graphic: MiniInbox,
    fade: true,
  },
  {
    title: '@mention anywhere',
    body: '@mention a PR in a message, doc, or task and it becomes a live link with status and checks.',
    Graphic: MentionCard,
  },
  {
    title: 'Link PRs to tasks',
    body: 'Link a task to its pull request; status and checks stay in step, and merging closes the task.',
    Graphic: TaskLinkMock,
  },
  {
    title: 'Notifications that work',
    body: 'Review requests and @mentions push reliably and hold their unread state — nothing gets buried.',
    Graphic: PushNotificationsMock,
  },
];

// Bottom fade for the inbox list cell only — "the list keeps going". Cards
// that end in a sentence are shown whole.
const GRAPHIC_FADE =
  'linear-gradient(to bottom, #000 0%, #000 72%, transparent 100%)';

export function GithubUiGrid() {
  const mobile = () => viewportWidth() < 700;
  const stacked = () => viewportWidth() < 860;
  const cols = () => (stacked() ? 1 : 2);

  return (
    <section
      aria-label="GitHub in every view"
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
        class="github-ui-grid"
        style={{
          border: '1px solid color-mix(in srgb, var(--b4) 16%, transparent)',
          'border-radius': mobile() ? '16px' : '20px',
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': stacked()
            ? '1fr'
            : 'repeat(2, minmax(0, 1fr))',
          'max-width': '1080px',
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <For each={cells}>
          {(cell, index) => (
            <div
              style={{
                'border-left':
                  index() % cols() !== 0
                    ? '1px solid color-mix(in srgb, var(--b4) 14%, transparent)'
                    : 'none',
                'border-top':
                  index() >= cols()
                    ? '1px solid color-mix(in srgb, var(--b4) 14%, transparent)'
                    : 'none',
                'box-sizing': 'border-box',
                display: 'grid',
                'grid-template-rows': '1fr auto',
              }}
            >
              <div
                style={{
                  'align-items': 'center',
                  display: 'grid',
                  'justify-items': 'center',
                  'min-height': mobile() ? '0' : '300px',
                  overflow: 'hidden',
                  padding: cell.fade
                    ? mobile()
                      ? '24px 18px 0'
                      : '32px 24px 0'
                    : mobile()
                      ? '24px 18px 26px'
                      : '32px 24px 34px',
                  position: 'relative',
                  width: '100%',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    background:
                      'radial-gradient(58% 54% at 50% 42%, color-mix(in srgb, var(--ambient-ink) 8%, transparent) 0%, transparent 72%)',
                    inset: '0',
                    'pointer-events': 'none',
                    position: 'absolute',
                  }}
                />
                <div
                  style={{
                    display: 'grid',
                    'justify-items': 'center',
                    ...(cell.fade
                      ? {
                          '-webkit-mask-image': GRAPHIC_FADE,
                          'mask-image': GRAPHIC_FADE,
                        }
                      : {}),
                    position: 'relative',
                    width: '100%',
                  }}
                >
                  <cell.Graphic />
                </div>
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: mobile() ? '8px' : '10px',
                  padding: mobile() ? '18px 22px 30px' : '22px 34px 36px',
                }}
              >
                <h3
                  style={{
                    color: 'var(--c2)',
                    'font-family': 'body',
                    'font-size': mobile() ? '14px' : '15px',
                    'font-weight': '700',
                    'letter-spacing': '0.07em',
                    'line-height': 1.2,
                    margin: 0,
                    'text-transform': 'uppercase',
                  }}
                >
                  {cell.title}
                </h3>
                <p
                  style={{
                    color: 'var(--c4)',
                    'font-family': 'body',
                    'font-size': mobile() ? '15px' : '16px',
                    'font-weight': '400',
                    'line-height': 1.5,
                    margin: 0,
                    'max-width': '420px',
                  }}
                >
                  {cell.body}
                </p>
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
