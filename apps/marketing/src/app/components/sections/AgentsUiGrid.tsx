import { For, type JSX } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';

// Fonts to match the inline graphics in RouteAgents.tsx
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const monoFont =
  "'SF Mono', ui-monospace, 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace";

// ---------------------------------------------------------------------------
// Bento cell graphics (grayscale, orange only as single accent)
// ---------------------------------------------------------------------------

// Team-level memory — a live feed of what teammates shipped and said, the
// shared context every agent chat reads from.
function TeamMemoryPanel() {
  const compact = () => viewportWidth() < 700;
  const entries: {
    initials: string;
    who: string;
    did: string;
    ref: string;
    refKind: 'pr' | 'doc' | 'call';
    time: string;
  }[] = [
    {
      initials: 'R',
      who: 'Rahul',
      did: 'fixed the deploy flake',
      ref: 'PR #482',
      refKind: 'pr',
      time: '2h',
    },
    {
      initials: 'JW',
      who: 'Julia',
      did: 'drafting launch copy',
      ref: 'Launch plan',
      refKind: 'doc',
      time: '4h',
    },
    {
      initials: 'SC',
      who: 'Sarah',
      did: 'approved 200 seats',
      ref: 'Pilot call',
      refKind: 'call',
      time: 'Mon',
    },
  ];
  const refGlyph = (kind: 'pr' | 'doc' | 'call') => {
    if (kind === 'pr')
      return (
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', flex: 'none' }}
        >
          <circle
            cx="7"
            cy="5"
            r="2.4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          />
          <circle
            cx="7"
            cy="19"
            r="2.4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          />
          <circle
            cx="17"
            cy="8"
            r="2.4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          />
          <path
            d="M7 7.4v9.2 M17 10.4c0 3.4-2.6 4.2-5 4.6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      );
    if (kind === 'doc')
      return (
        <svg
          width="11"
          height="11"
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
            stroke="currentColor"
            stroke-width="1.8"
          />
          <path
            d="M7 10h10 M7 14h6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      );
    return (
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{ display: 'block', flex: 'none' }}
      >
        <path
          d="M6.6 3.8c.5-.5 1.3-.5 1.8 0l1.9 1.9c.5.5.5 1.3 0 1.8l-1 1a13.4 13.4 0 0 0 6.2 6.2l1-1c.5-.5 1.3-.5 1.8 0l1.9 1.9c.5.5.5 1.3 0 1.8l-1.5 1.5c-.7.7-1.8 1-2.7.6-6-2.3-10.8-7.1-13.1-13.1-.4-1-.1-2 .6-2.7z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linejoin="round"
        />
      </svg>
    );
  };
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: compact() ? '20px 16px' : '24px 20px',
        width: '100%',
      }}
    >
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(380px, 100%)',
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
          <span style={{ color: 'var(--a0)', display: 'inline-flex' }}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              aria-hidden="true"
              style={{ display: 'block' }}
            >
              <path
                d="M12 5c.4 4.6 2.4 6.6 7 7-4.6.4-6.6 2.4-7 7-.4-4.6-2.4-6.6-7-7 4.6-.4 6.6-2.4 7-7z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13px',
              'font-weight': '600',
            }}
          >
            Team memory
          </span>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '11.5px',
              'margin-left': 'auto',
            }}
          >
            read by every agent
          </span>
        </div>
        <For each={entries}>
          {(entry, i) => (
            <div
              style={{
                'align-items': 'center',
                'border-bottom':
                  i() === 2
                    ? '0'
                    : '1px solid color-mix(in srgb, var(--c4) 8%, transparent)',
                display: 'flex',
                gap: '10px',
                padding: '11px 14px',
              }}
            >
              <span
                style={{
                  'align-items': 'center',
                  'background-color': 'var(--b3)',
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '999px',
                  'box-sizing': 'border-box',
                  color: 'var(--c1)',
                  display: 'inline-grid',
                  flex: 'none',
                  'font-family': appFont,
                  'font-size': '9px',
                  'font-weight': '600',
                  height: '24px',
                  'place-items': 'center',
                  width: '24px',
                }}
                aria-hidden="true"
              >
                {entry.initials}
              </span>
              <span
                style={{
                  color: 'var(--c2)',
                  'font-family': appFont,
                  'font-size': '12.5px',
                  'line-height': 1.45,
                  'min-width': 0,
                }}
              >
                <span style={{ color: 'var(--c1)', 'font-weight': '600' }}>
                  {entry.who}
                </span>{' '}
                {entry.did}
              </span>
              <span
                style={{
                  'align-items': 'center',
                  'background-color':
                    'color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '5px',
                  color: 'var(--c2)',
                  display: 'inline-flex',
                  flex: 'none',
                  'font-family': appFont,
                  'font-size': '11px',
                  gap: '5px',
                  'margin-left': 'auto',
                  padding: '3px 7px',
                  'white-space': 'nowrap',
                }}
              >
                {refGlyph(entry.refKind)} {entry.ref}
              </span>
              <span
                style={{
                  color: 'var(--c4)',
                  flex: 'none',
                  'font-family': appFont,
                  'font-size': '11px',
                }}
              >
                {entry.time}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

// Scheduled results, delivered — agent runs arrive in the inbox like mail.
function AgentInboxPanel() {
  const compact = () => viewportWidth() < 700;
  const rows: {
    title: string;
    preview: string;
    time: string;
    unread?: boolean;
  }[] = [
    {
      title: 'Daily inbox brief',
      preview: '7 signal · 3 waiting on you',
      time: '8:00 AM',
      unread: true,
    },
    {
      title: 'Weekly CRM recap',
      preview: '2 deals need a nudge this week',
      time: 'Mon',
    },
    {
      title: 'Release notes draft',
      preview: 'Ready for your review',
      time: 'Jun 27',
    },
  ];
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: compact() ? '20px 16px' : '24px 20px',
        width: '100%',
      }}
    >
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          'border-radius': '12px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(400px, 100%)',
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
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{ color: 'var(--c2)', display: 'block', flex: 'none' }}
          >
            <path
              d="M3 12h5l2 3h4l2-3h5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
            <path
              d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
            />
          </svg>
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13px',
              'font-weight': '600',
            }}
          >
            Inbox
          </span>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '11.5px',
              'margin-left': 'auto',
            }}
          >
            3 from agents
          </span>
        </div>
        <For each={rows}>
          {(row, i) => (
            <div
              style={{
                'align-items': 'center',
                'border-bottom':
                  i() === 2
                    ? '0'
                    : '1px solid color-mix(in srgb, var(--c4) 8%, transparent)',
                display: 'flex',
                gap: '10px',
                padding: '11px 14px',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  'background-color': row.unread ? 'var(--a0)' : 'transparent',
                  'border-radius': '999px',
                  flex: 'none',
                  height: '6px',
                  width: '6px',
                }}
              />
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
                aria-hidden="true"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  style={{ display: 'block' }}
                >
                  <path
                    d="M12 5c.4 4.6 2.4 6.6 7 7-4.6.4-6.6 2.4-7 7-.4-4.6-2.4-6.6-7-7 4.6-.4 6.6-2.4 7-7z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <div style={{ display: 'grid', gap: '1px', 'min-width': 0 }}>
                <span
                  style={{
                    color: row.unread ? 'var(--c1)' : 'var(--c2)',
                    'font-family': appFont,
                    'font-size': '13px',
                    'font-weight': row.unread ? '600' : '500',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'white-space': 'nowrap',
                  }}
                >
                  {row.title}
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
                  {row.preview}
                </span>
              </div>
              <span
                style={{
                  color: 'var(--c4)',
                  flex: 'none',
                  'font-family': appFont,
                  'font-size': '11px',
                  'margin-left': 'auto',
                  'white-space': 'nowrap',
                }}
              >
                {row.time}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

// Permissions — three permission rows, one highlighted with orange lock.
function PermissionsPanel() {
  const compact = () => viewportWidth() < 700;
  const rows = [
    {
      icon: (
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', flex: 'none' }}
        >
          <rect
            x="5"
            y="10.5"
            width="14"
            height="9.5"
            rx="2.4"
            fill="none"
            stroke="var(--c4)"
            stroke-width="1.7"
          />
          <path
            d="M8 10.5V8a4 4 0 0 1 8 0v2.5"
            fill="none"
            stroke="var(--c4)"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
      ),
      title: 'Sees only what you can see',
      body: 'Inherits your exact permissions, everywhere.',
    },
    {
      icon: (
        <span
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
            'font-size': '9px',
            'font-weight': '600',
            height: '22px',
            'place-items': 'center',
            width: '22px',
          }}
          aria-hidden="true"
        >
          JB
        </span>
      ),
      title: 'Acts as you',
      body: 'Everything attributed to you, never a bot.',
    },
    {
      icon: (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ display: 'block', flex: 'none' }}
        >
          <circle
            cx="12"
            cy="12"
            r="8.5"
            fill="none"
            stroke="color-mix(in srgb, var(--c4) 60%, transparent)"
            stroke-width="1.7"
          />
          <path
            d="M5 12l4.5 4.5L19 7"
            fill="none"
            stroke="color-mix(in srgb, var(--c4) 60%, transparent)"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      ),
      title: 'You stay in control',
      body: "Draft, don't send — review before it goes out.",
    },
  ];

  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '10px',
        'justify-items': 'center',
        padding: compact() ? '20px 16px' : '24px 20px',
        width: '100%',
      }}
    >
      <div style={{ display: 'grid', gap: '8px', width: 'min(380px, 100%)' }}>
        <For each={rows}>
          {(r) => (
            <div
              style={{
                'align-items': 'center',
                'background-color': '#0a0a0a',
                border:
                  '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                'border-radius': '12px',
                'box-sizing': 'border-box',
                display: 'flex',
                gap: '12px',
                padding: '12px 14px',
              }}
            >
              <span
                style={{
                  'align-items': 'center',
                  'background-color':
                    'color-mix(in srgb, var(--c4) 9%, transparent)',
                  'border-radius': '10px',
                  display: 'inline-grid',
                  flex: 'none',
                  height: '36px',
                  'place-items': 'center',
                  width: '36px',
                }}
              >
                {r.icon}
              </span>
              <div style={{ display: 'grid', gap: '2px', 'min-width': 0 }}>
                <span
                  style={{
                    color: 'var(--c1)',
                    'font-family': appFont,
                    'font-size': '13.5px',
                    'font-weight': '600',
                  }}
                >
                  {r.title}
                </span>
                <span
                  style={{
                    color: 'var(--c4)',
                    'font-family': appFont,
                    'font-size': '12px',
                    'line-height': 1.4,
                  }}
                >
                  {r.body}
                </span>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

// MCP / Platform — terminal connect card + tool tags. Simple card, no spotlight needed.
function McpPanel() {
  const compact = () => viewportWidth() < 700;
  const MCP_ENDPOINT = 'https://mcp-server.macro.com/mcp';
  const connectors = ['Notion', 'Slack', 'Linear', 'GitHub', 'Drive'];
  const agentTools = [
    'Search',
    'Read',
    'Create doc',
    'Send email',
    'Update task',
  ];

  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '12px',
        'justify-items': 'center',
        padding: compact() ? '20px 16px' : '24px 20px',
        width: '100%',
      }}
    >
      <div style={{ display: 'grid', gap: '10px', width: 'min(380px, 100%)' }}>
        {/* Connect your tools */}
        <div
          style={{
            'background-color': '#0a0a0a',
            border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            'border-radius': '12px',
            'box-sizing': 'border-box',
            display: 'grid',
            gap: '10px',
            padding: '14px 16px',
          }}
        >
          <div style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              aria-hidden="true"
              style={{ display: 'block', flex: 'none', color: 'var(--c2)' }}
            >
              <path
                d="M9 2v4 M15 2v4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
              />
              <rect
                x="6"
                y="6"
                width="12"
                height="6"
                rx="2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
              />
              <path
                d="M12 12v4a4 4 0 0 0 4 4h1"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '13px',
                'font-weight': '600',
              }}
            >
              Connect your tools via MCP
            </span>
          </div>
          <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '6px' }}>
            <For each={connectors}>
              {(c) => (
                <span
                  style={{
                    'align-items': 'center',
                    'background-color': '#080808',
                    border:
                      '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                    'border-radius': '8px',
                    color: 'var(--c2)',
                    display: 'inline-flex',
                    'font-family': appFont,
                    'font-size': '12px',
                    gap: '6px',
                    padding: '5px 10px',
                  }}
                >
                  <span
                    style={{
                      'background-color':
                        'color-mix(in srgb, var(--c4) 35%, transparent)',
                      'border-radius': '3px',
                      height: '7px',
                      width: '7px',
                    }}
                  />
                  {c}
                </span>
              )}
            </For>
            <span
              style={{
                'align-items': 'center',
                border:
                  '1px dashed color-mix(in srgb, var(--c4) 25%, transparent)',
                'border-radius': '8px',
                color: 'var(--c4)',
                display: 'inline-flex',
                'font-family': appFont,
                'font-size': '12px',
                padding: '5px 10px',
              }}
            >
              + Custom
            </span>
          </div>
        </div>

        {/* From your coding agent */}
        <div
          style={{
            'background-color': '#0a0a0a',
            border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            'border-radius': '12px',
            'box-sizing': 'border-box',
            display: 'grid',
            gap: '8px',
            padding: '14px 16px',
          }}
        >
          <div style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}>
            <span style={{ color: 'var(--a0)', display: 'inline-flex' }}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                aria-hidden="true"
                style={{ display: 'block' }}
              >
                <path
                  d="M12 2c.5 5.4 2.6 7.5 8 8-5.4.5-7.5 2.6-8 8-.5-5.4-2.6-7.5-8-8 5.4-.5 7.5-2.6 8-8z"
                  fill="currentColor"
                />
              </svg>
            </span>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '13px',
                'font-weight': '600',
              }}
            >
              Your workspace, from your agent
            </span>
          </div>
          <div
            style={{
              'background-color': '#080808',
              border:
                '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
              'border-radius': '8px',
              padding: '9px 11px',
            }}
          >
            <div
              style={{
                color: 'var(--c4)',
                'font-family': monoFont,
                'font-size': '11px',
                'line-height': 1.55,
                'overflow-wrap': 'anywhere',
              }}
            >
              <span
                style={{
                  color: 'color-mix(in srgb, var(--c4) 60%, transparent)',
                }}
              >
                $
              </span>{' '}
              claude mcp add --transport http \<br />
              <span style={{ 'padding-left': '14px', display: 'inline-block' }}>
                <span style={{ color: 'var(--c2)' }}>macro</span> {MCP_ENDPOINT}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '5px' }}>
            <For each={agentTools}>
              {(t) => (
                <span
                  style={{
                    'background-color': '#080808',
                    border:
                      '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                    'border-radius': '6px',
                    color: 'var(--c2)',
                    'font-family': monoFont,
                    'font-size': '10.5px',
                    padding: '3px 7px',
                  }}
                >
                  {t}
                </span>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}

type UiCell = {
  title: string;
  body: string;
  Graphic: () => JSX.Element;
};

const cells: UiCell[] = [
  {
    title: 'Team-level memory',
    body: 'Macro knows what everyone shipped and said — ask before you duplicate work.',
    Graphic: TeamMemoryPanel,
  },
  {
    title: 'Your exact permissions',
    body: 'Inherits your access, acts as you, and never sends without your approval.',
    Graphic: PermissionsPanel,
  },
  {
    title: 'Open platform via MCP',
    body: 'Connect any tool in, or give your coding agent the same reach into Macro.',
    Graphic: McpPanel,
  },
  {
    title: 'Lands in your inbox',
    body: 'Scheduled runs deliver like any other message — daily briefs, weekly recaps, ready when you are.',
    Graphic: AgentInboxPanel,
  },
];

const GRAPHIC_FADE =
  'linear-gradient(to bottom, #000 0%, #000 76%, transparent 100%)';

export function AgentsUiGrid() {
  const mobile = () => viewportWidth() < 700;
  const stacked = () => viewportWidth() < 860;
  const cols = () => (stacked() ? 1 : 2);

  return (
    <section
      aria-label="Agents in action"
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
          border: '1px solid color-mix(in srgb, var(--b4) 16%, transparent)',
          'border-radius': mobile() ? '16px' : '20px',
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': stacked()
            ? '1fr'
            : 'repeat(2, minmax(0, 1fr))',
          'max-width': '100%',
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
                  padding: mobile() ? '16px 0 0' : '20px 0 0',
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
                    '-webkit-mask-image': GRAPHIC_FADE,
                    'mask-image': GRAPHIC_FADE,
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
                  padding: mobile() ? '2px 22px 30px' : '6px 34px 36px',
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
