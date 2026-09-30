import type { Component, JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { breakpoint } from '../../utils/utilBreakpoint';

const palette = {
  bg: '#090909',
  panel: '#000000',
  line: '#333333',
  accent: '#FF8F00',
  text: '#EFE3DC',
  body: '#AF9A8E',
  muted: '#857A73',
  muted2: '#645E5E',
};

function CornerFrame() {
  const cornerStyle = {
    position: 'absolute',
    width: '18px',
    height: '18px',
    'pointer-events': 'none',
  } as const;

  const lineStyle = {
    position: 'absolute',
    background: palette.accent,
  } as const;

  return (
    <>
      <div style={{ ...cornerStyle, top: '-12px', left: '-12px' }}>
        <div
          style={{
            ...lineStyle,
            top: '0',
            left: '0',
            width: '18px',
            height: '3px',
          }}
        />
        <div
          style={{
            ...lineStyle,
            top: '0',
            left: '0',
            width: '3px',
            height: '18px',
          }}
        />
      </div>
      <div style={{ ...cornerStyle, top: '-12px', right: '-12px' }}>
        <div
          style={{
            ...lineStyle,
            top: '0',
            right: '0',
            width: '18px',
            height: '3px',
          }}
        />
        <div
          style={{
            ...lineStyle,
            top: '0',
            right: '0',
            width: '3px',
            height: '18px',
          }}
        />
      </div>
      <div style={{ ...cornerStyle, bottom: '-12px', left: '-12px' }}>
        <div
          style={{
            ...lineStyle,
            bottom: '0',
            left: '0',
            width: '18px',
            height: '3px',
          }}
        />
        <div
          style={{
            ...lineStyle,
            bottom: '0',
            left: '0',
            width: '3px',
            height: '18px',
          }}
        />
      </div>
      <div style={{ ...cornerStyle, bottom: '-12px', right: '-12px' }}>
        <div
          style={{
            ...lineStyle,
            bottom: '0',
            right: '0',
            width: '18px',
            height: '3px',
          }}
        />
        <div
          style={{
            ...lineStyle,
            bottom: '0',
            right: '0',
            width: '3px',
            height: '18px',
          }}
        />
      </div>
    </>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 13 13" width="12" height="12" fill="none">
      <path d="M0.5 0.5L12.5 12.5" stroke={palette.muted2} stroke-width="0.7" />
      <path d="M12.5 0.5L0.5 12.5" stroke={palette.muted2} stroke-width="0.7" />
      <path d="M12.5 12.5L0.5 0.5" stroke={palette.muted2} stroke-width="0.7" />
      <path d="M0.5 12.5L12.5 0.5" stroke={palette.muted2} stroke-width="0.7" />
    </svg>
  );
}

function TaskGlyph(props: { size?: number }) {
  const size = props.size ?? 13;
  return (
    <svg viewBox="0 0 17 17" width={size} height={size} fill="none">
      <path
        d="M1.37 2.75V4.12H4.12V6.87H1.37V4.12H0V8.25H5.5V2.75H1.37Z"
        fill={palette.accent}
      />
      <path
        d="M2.76 13.74L0 11L0.98 10.02L2.76 11.8L5.52 9.04L6.49 10.02L2.76 13.74Z"
        fill={palette.accent}
      />
      <path d="M16.5 4.81H7.33V6.19H16.5V4.81Z" fill={palette.accent} />
      <path d="M16.5 10.42H7.33V11.79H16.5V10.42Z" fill={palette.accent} />
    </svg>
  );
}

function PixelBadge(props: { inverted?: boolean }) {
  const bg = props.inverted ? palette.bg : palette.accent;
  const fg = props.inverted ? palette.accent : palette.bg;

  return (
    <svg
      width="35"
      height="35"
      viewBox="0 0 32 32"
      fill="none"
      style={{ 'flex-shrink': '0' }}
    >
      <rect width="32" height="32" fill={bg} />
      <rect x="14.6" y="9.1" width="2.7" height="2.7" fill={fg} />
      <rect x="11.9" y="14.8" width="2.7" height="2.7" fill={fg} />
      <rect x="14.6" y="14.8" width="2.7" height="2.7" fill={fg} />
      <rect x="19.3" y="14.8" width="2.7" height="2.7" fill={fg} />
      <rect x="9.3" y="14.8" width="2.7" height="2.7" fill={fg} />
      <rect x="11.9" y="20.2" width="2.7" height="2.7" fill={fg} />
      <rect x="14.6" y="20.2" width="2.7" height="2.7" fill={fg} />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke={palette.text}
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function StatusGlyph() {
  return (
    <svg viewBox="0 0 8 8" width="7" height="7" fill="none">
      <path
        d="M4.64 1.05C6.1 1.29 7.22 2.56 7.22 4.08C7.22 4.46 7.14 4.82 7.01 5.15L7.92 5.68C8.13 5.19 8.25 4.65 8.25 4.08C8.25 1.99 6.67 0.25 4.64 0V1.05ZM6.49 6.05C5.92 6.74 5.08 7.17 4.12 7.17C2.42 7.17 1.03 5.79 1.03 4.08C1.03 2.56 2.15 1.29 3.61 1.05V0C2.57 0.13 1.61 0.65 0.94 1.46C0.27 2.27 -0.06 3.3 0 4.35C0.07 5.4 0.53 6.38 1.3 7.1C2.06 7.82 3.07 8.21 4.12 8.21C5.46 8.21 6.65 7.57 7.4 6.58L6.49 6.05Z"
        fill={palette.text}
      />
    </svg>
  );
}

function AddBox() {
  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        width: '24px',
        'min-width': '24px',
        height: '24px',
        border: `0.5px solid ${palette.line}`,
        color: palette.muted,
      }}
    >
      <span
        style={{
          'font-family': 'Rajdhani, sans-serif',
          'font-size': '14px',
          'line-height': '1',
        }}
      >
        +
      </span>
    </div>
  );
}

function CloseBox() {
  return (
    <svg viewBox="0 0 10 10" width="10" height="10" fill="none">
      <rect
        x="0.5"
        y="0.5"
        width="9"
        height="9"
        stroke={palette.line}
        stroke-width="0.5"
      />
      <path
        d="M3 3L7 7M7 3L3 7"
        stroke={palette.muted}
        stroke-width="0.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

function Avatar(props: { label: string; size?: number }) {
  const size = props.size ?? 16;

  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        'border-radius': '999px',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        background: palette.accent,
        color: palette.bg,
        'font-family': 'Rajdhani, sans-serif',
        'font-weight': '700',
        'font-size': `${Math.max(9, size * 0.5)}px`,
        'text-transform': 'uppercase',
        'flex-shrink': '0',
      }}
    >
      {props.label}
    </div>
  );
}

function FieldPill(props: { children: JSX.Element }) {
  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '6px',
        padding: '0 8px',
        height: '24px',
        background: palette.panel,
        border: `0.5px solid ${palette.line}`,
      }}
    >
      {props.children}
    </div>
  );
}

function EmailCard() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '620px' }}>
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          gap: '8px',
          height: '100%',
          background: palette.bg,
          'clip-path':
            'polygon(0 0, 100% 0, 100% 100%, 48px 100%, 0 calc(100% - 48px))',
        }}
      >
        <div style={{ border: `2.5px solid ${palette.line}` }}>
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              padding: '20px 36px',
              background: palette.bg,
            }}
          >
            <div
              style={{
                'font-family': 'display',
                'font-size': '22px',
                'letter-spacing': '0.12em',
                color: palette.text,
              }}
            >
              MACRO
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            'flex-direction': 'column',
            'justify-content': 'space-between',
            flex: '1',
            padding: '36px',
            background: palette.bg,
            border: `2.5px solid ${palette.line}`,
          }}
        >
          <div style={{ display: 'grid', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '12px',
                padding: '12px 16px',
                border: `1px solid ${palette.line}`,
              }}
            >
              <span
                style={{
                  width: '140px',
                  'font-family': 'Rajdhani, sans-serif',
                  'font-size': '12px',
                  'font-weight': '600',
                  'letter-spacing': '2.5px',
                  color: palette.accent,
                }}
              >
                ACTION TRIGGER
              </span>
              <span
                style={{
                  flex: '1',
                  'font-family': 'Roboto Slab, serif',
                  'font-size': '18px',
                  'font-weight': '350',
                  color: palette.accent,
                }}
              >
                Welcome Email
              </span>
              <PixelBadge />
            </div>
            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '12px',
                padding: '12px 16px',
                background: palette.accent,
                border: `1.5px solid ${palette.accent}`,
              }}
            >
              <span
                style={{
                  width: '140px',
                  'font-family': 'Rajdhani, sans-serif',
                  'font-size': '12px',
                  'font-weight': '600',
                  'letter-spacing': '2.5px',
                  color: palette.bg,
                }}
              >
                OCT 25, FRIDAY
              </span>
              <span
                style={{
                  flex: '1',
                  'font-family': 'Roboto Slab, serif',
                  'font-size': '18px',
                  'font-weight': '400',
                  color: palette.bg,
                }}
              >
                Event Reminder
              </span>
              <PixelBadge inverted />
            </div>
          </div>

          <div style={{ display: 'grid', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                'align-items': 'flex-start',
                gap: '12px',
                padding: '12px 16px 16px',
                border: `1px solid ${palette.line}`,
                background: palette.panel,
              }}
            >
              <div style={{ width: '140px', display: 'flex', gap: '12px' }}>
                <div style={{ display: 'grid', 'line-height': '1' }}>
                  <span
                    style={{
                      'font-family': 'Rajdhani, sans-serif',
                      'font-size': '13px',
                      'font-weight': '600',
                      'letter-spacing': '2px',
                      color: palette.text,
                    }}
                  >
                    NOV
                  </span>
                  <span
                    style={{
                      'font-family': 'Rajdhani, sans-serif',
                      'font-size': '11px',
                      'font-weight': '600',
                      'letter-spacing': '2px',
                      color: palette.accent,
                    }}
                  >
                    WED
                  </span>
                </div>
                <span
                  style={{
                    'font-family': 'Rajdhani, sans-serif',
                    'font-size': '36px',
                    'font-weight': '300',
                    'line-height': '0.85',
                    color: palette.text,
                  }}
                >
                  21
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: '8px',
                  flex: '1',
                  'padding-top': '4px',
                  'padding-right': '32px',
                }}
              >
                <p
                  style={{
                    'font-family': 'Roboto Slab, serif',
                    'font-size': '18px',
                    'font-weight': '350',
                    'line-height': '1',
                    color: palette.text,
                  }}
                >
                  Follow up emails
                </p>
                <p
                  style={{
                    'font-family': 'Rajdhani, sans-serif',
                    'font-size': '12px',
                    'line-height': '1.4',
                    color: palette.body,
                  }}
                >
                  Check your inbox for messages that need your attention or a
                  quick response.
                </p>
              </div>
              <PixelBadge />
            </div>

            <div
              style={{
                display: 'flex',
                'align-items': 'flex-start',
                gap: '12px',
                padding: '12px 16px 16px',
                border: `1px solid ${palette.line}`,
                background: palette.panel,
                opacity: '0.55',
              }}
            >
              <div style={{ width: '140px', display: 'flex', gap: '12px' }}>
                <div style={{ display: 'grid', 'line-height': '1' }}>
                  <span
                    style={{
                      'font-family': 'Rajdhani, sans-serif',
                      'font-size': '13px',
                      'font-weight': '600',
                      'letter-spacing': '2px',
                      color: palette.text,
                    }}
                  >
                    NOV
                  </span>
                  <span
                    style={{
                      'font-family': 'Rajdhani, sans-serif',
                      'font-size': '11px',
                      'font-weight': '600',
                      'letter-spacing': '2px',
                      color: palette.accent,
                    }}
                  >
                    MON
                  </span>
                </div>
                <span
                  style={{
                    'font-family': 'Rajdhani, sans-serif',
                    'font-size': '36px',
                    'font-weight': '300',
                    'line-height': '0.85',
                    color: palette.text,
                  }}
                >
                  25
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: '8px',
                  flex: '1',
                  'padding-top': '4px',
                  'padding-right': '32px',
                }}
              >
                <p
                  style={{
                    'font-family': 'Roboto Slab, serif',
                    'font-size': '18px',
                    'font-weight': '350',
                    'line-height': '1',
                    color: palette.text,
                  }}
                >
                  Client Meeting
                </p>
                <p
                  style={{
                    'font-family': 'Rajdhani, sans-serif',
                    'font-size': '12px',
                    'line-height': '1.4',
                    color: palette.body,
                  }}
                >
                  Papercrowns meeting at 4:00 PM, Nov 20th. Key updates on the
                  agenda.
                </p>
              </div>
              <PixelBadge />
            </div>
          </div>
        </div>
      </div>
      <svg
        width="50"
        height="50"
        style={{
          position: 'absolute',
          left: '0',
          bottom: '0',
          overflow: 'visible',
        }}
      >
        <line
          x1="-0.5"
          y1="1"
          x2="48.5"
          y2="50"
          stroke={palette.line}
          stroke-width="1.5"
        />
      </svg>
    </div>
  );
}

function CreateTaskCard() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '620px' }}>
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          gap: '8px',
          height: '100%',
          background: palette.bg,
          'clip-path':
            'polygon(0 0, 100% 0, 100% 100%, 48px 100%, 0 calc(100% - 48px))',
        }}
      >
        <div style={{ border: `2.5px solid ${palette.line}` }}>
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '12px',
              padding: '8px 36px',
              background: palette.bg,
            }}
          >
            <CloseGlyph />
            <p
              style={{
                'font-family': 'Rajdhani, sans-serif',
                'font-size': '14px',
                'font-weight': '450',
                'letter-spacing': '0.7px',
                'text-transform': 'uppercase',
                color: palette.muted2,
              }}
            >
              Create Task
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            'flex-direction': 'column',
            'justify-content': 'space-between',
            flex: '1',
            padding: '24px 32px',
            background: palette.bg,
            border: `2.5px solid ${palette.line}`,
          }}
        >
          <div style={{ display: 'grid', gap: '20px' }}>
            <div
              style={{
                position: 'relative',
                display: 'flex',
                'align-items': 'center',
                gap: '12px',
                padding: '12px 16px',
                background: palette.panel,
                border: `0.5px solid ${palette.line}`,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: '0',
                  top: '0',
                  width: '3px',
                  height: '100%',
                  background: palette.accent,
                }}
              />
              <TaskGlyph />
              <span
                style={{
                  'font-family': 'Rajdhani, sans-serif',
                  'font-size': '18px',
                  'font-weight': '500',
                  color: palette.text,
                }}
              >
                Dashboard wireframes review
              </span>
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
              <p
                style={{
                  'font-family': 'Rajdhani, sans-serif',
                  'font-size': '11px',
                  'font-weight': '600',
                  'letter-spacing': '0.5px',
                  'text-transform': 'uppercase',
                  color: palette.muted2,
                }}
              >
                Task description
              </p>
              <p
                style={{
                  'font-family': 'Rajdhani, sans-serif',
                  'font-size': '14px',
                  'font-weight': '400',
                  'line-height': '1.4',
                  color: palette.text,
                }}
              >
                Prepare the initial wireframes for the new dashboard overhaul.
                We need to account for the new data visualization requirements
                discussed last week.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '20px', 'margin-top': '48px' }}>
            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'space-between',
                'padding-bottom': '16px',
                'border-bottom': `0.5px solid ${palette.line}`,
              }}
            >
              <p
                style={{
                  'font-family': 'Rajdhani, sans-serif',
                  'font-size': '11px',
                  'font-weight': '600',
                  'letter-spacing': '0.5px',
                  'text-transform': 'uppercase',
                  color: palette.text,
                }}
              >
                Assignees
              </p>
              <div
                style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}
              >
                <FieldPill>
                  <>
                    <Avatar label="S" />
                    <p
                      style={{
                        'font-family': 'Rajdhani, sans-serif',
                        'font-size': '11px',
                        'font-weight': '400',
                        'line-height': '1',
                        'text-transform': 'lowercase',
                        color: palette.muted2,
                      }}
                    >
                      sarah
                    </p>
                    <CloseBox />
                  </>
                </FieldPill>
                <FieldPill>
                  <>
                    <Avatar label="N" />
                    <p
                      style={{
                        'font-family': 'Rajdhani, sans-serif',
                        'font-size': '11px',
                        'font-weight': '400',
                        'line-height': '1',
                        'text-transform': 'lowercase',
                        color: palette.muted2,
                      }}
                    >
                      nick
                    </p>
                    <CloseBox />
                  </>
                </FieldPill>
                <AddBox />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'space-between',
                'padding-bottom': '16px',
                'border-bottom': `0.5px solid ${palette.line}`,
              }}
            >
              <p
                style={{
                  'font-family': 'Rajdhani, sans-serif',
                  'font-size': '11px',
                  'font-weight': '600',
                  'letter-spacing': '0.5px',
                  'text-transform': 'uppercase',
                  color: palette.text,
                }}
              >
                Due date
              </p>
              <FieldPill>
                <>
                  <CalendarGlyph />
                  <p
                    style={{
                      'font-family': 'Rajdhani, sans-serif',
                      'font-size': '11px',
                      'font-weight': '600',
                      'letter-spacing': '0.5px',
                      'text-transform': 'uppercase',
                      'line-height': '1',
                      color: palette.muted2,
                    }}
                  >
                    OCT 24
                  </p>
                  <CloseBox />
                </>
              </FieldPill>
            </div>

            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'space-between',
                'padding-bottom': '16px',
                'border-bottom': `0.5px solid ${palette.line}`,
              }}
            >
              <p
                style={{
                  'font-family': 'Rajdhani, sans-serif',
                  'font-size': '11px',
                  'font-weight': '600',
                  'letter-spacing': '0.5px',
                  'text-transform': 'uppercase',
                  color: palette.text,
                }}
              >
                Status
              </p>
              <FieldPill>
                <>
                  <StatusGlyph />
                  <p
                    style={{
                      'font-family': 'Rajdhani, sans-serif',
                      'font-size': '11px',
                      'font-weight': '600',
                      'letter-spacing': '0.5px',
                      'text-transform': 'uppercase',
                      'line-height': '1',
                      color: palette.muted2,
                    }}
                  >
                    NOT STARTED
                  </p>
                  <CloseBox />
                </>
              </FieldPill>
            </div>

            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'space-between',
                'padding-bottom': '16px',
                'border-bottom': `0.5px solid ${palette.line}`,
              }}
            >
              <p
                style={{
                  'font-family': 'Rajdhani, sans-serif',
                  'font-size': '11px',
                  'font-weight': '600',
                  'letter-spacing': '0.5px',
                  'text-transform': 'uppercase',
                  color: palette.text,
                }}
              >
                Priority
              </p>
              <AddBox />
            </div>

            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'flex-end',
                gap: '8px',
                'margin-top': '8px',
              }}
            >
              <p
                style={{
                  'font-family': 'Rajdhani, sans-serif',
                  'font-size': '11px',
                  'font-weight': '600',
                  'letter-spacing': '0.5px',
                  'text-transform': 'uppercase',
                  color: palette.muted2,
                }}
              >
                Create Additional Tasks
              </p>
              <div
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '2px',
                  padding: '2px 4px',
                  'border-radius': '999px',
                  background: palette.muted2,
                }}
              >
                <div
                  style={{
                    width: '4px',
                    height: '4px',
                    'border-radius': '999px',
                    background: palette.bg,
                  }}
                />
                <div
                  style={{
                    width: '8px',
                    height: '4px',
                    'border-radius': '999px',
                    background: 'transparent',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <svg
        width="50"
        height="50"
        style={{
          position: 'absolute',
          left: '0',
          bottom: '0',
          overflow: 'visible',
        }}
      >
        <line
          x1="-0.5"
          y1="1"
          x2="48.5"
          y2="50"
          stroke={palette.line}
          stroke-width="1.5"
        />
      </svg>
    </div>
  );
}

function MentionRow(props: {
  name: string;
  action: string;
  date: string;
  message: JSX.Element;
  opacity?: number;
  avatars?: string[];
}) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        'align-items': 'flex-start',
        gap: '12px',
        padding: '6px 16px',
        background: palette.panel,
        'border-top': `0.5px solid ${palette.line}`,
        'border-right': `0.5px solid ${palette.line}`,
        'border-bottom': `0.5px solid ${palette.line}`,
        opacity: `${props.opacity ?? 1}`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '0',
          top: '0',
          width: '3px',
          height: '100%',
          background: palette.accent,
        }}
      />
      <div style={{ 'padding-top': '10px', color: palette.text }}>
        <span
          style={{ 'font-family': 'Rajdhani, sans-serif', 'font-size': '13px' }}
        >
          @
        </span>
      </div>
      <div style={{ display: 'grid', gap: '2px', flex: '1', padding: '4px 0' }}>
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '4px',
            'flex-wrap': 'wrap',
          }}
        >
          <div style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
            <div style={{ display: 'flex', 'margin-right': '2px' }}>
              {(props.avatars ?? [props.name[0]]).map((avatar, index) => (
                <div style={{ 'margin-left': index === 0 ? '0' : '-6px' }}>
                  <Avatar label={avatar} size={18} />
                </div>
              ))}
            </div>
            <span
              style={{
                'font-family': 'Rajdhani, sans-serif',
                'font-size': '12px',
                'font-weight': '400',
                'text-transform': 'lowercase',
                color: palette.text,
              }}
            >
              {props.name}
            </span>
          </div>
          <span
            style={{
              'font-family': 'Rajdhani, sans-serif',
              'font-size': '12px',
              'font-weight': '400',
              'text-transform': 'lowercase',
              color: palette.text,
            }}
          >
            {props.action}
          </span>
          <span
            style={{
              'font-family': 'Rajdhani, sans-serif',
              'font-size': '12px',
              'font-weight': '400',
              'letter-spacing': '0.04em',
              'text-transform': 'uppercase',
              color: palette.muted,
            }}
          >
            - {props.date}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '6px',
            overflow: 'hidden',
            'font-family': 'Rajdhani, sans-serif',
            'font-size': '16px',
            'font-weight': '400',
            color: palette.text,
          }}
        >
          {props.message}
        </div>
      </div>
      <div style={{ 'padding-top': '10px' }}>
        <svg viewBox="0 0 10 10" width="10" height="10" fill="none">
          <rect
            x="0.5"
            y="0.5"
            width="9"
            height="9"
            stroke={palette.line}
            stroke-width="0.5"
          />
        </svg>
      </div>
    </div>
  );
}

function ChannelsCard() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '620px' }}>
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          gap: '8px',
          height: '100%',
          background: palette.bg,
          'clip-path':
            'polygon(0 0, 100% 0, 100% 100%, 48px 100%, 0 calc(100% - 48px))',
        }}
      >
        <div style={{ border: `2.5px solid ${palette.line}` }}>
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '12px',
              padding: '20px 36px',
              background: palette.bg,
            }}
          >
            <p
              style={{
                'font-family': 'Rajdhani, sans-serif',
                'font-size': '14px',
                'font-weight': '450',
                'letter-spacing': '0.7px',
                'text-transform': 'uppercase',
                color: palette.muted2,
              }}
            >
              # Channels
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            'flex-direction': 'column',
            'justify-content': 'space-between',
            flex: '1',
            padding: '36px',
            background: palette.bg,
            border: `2.5px solid ${palette.line}`,
          }}
        >
          <div style={{ display: 'grid', gap: '0' }}>
            <MentionRow
              name="jacob"
              action="mentioned you"
              date="JAN 30"
              message={
                <>
                  <span>Let me know if this is what you had in mind</span>
                  <span
                    style={{
                      display: 'inline-flex',
                      'align-items': 'center',
                      gap: '2px',
                      padding: '2px 4px',
                      background: palette.bg,
                    }}
                  >
                    <span style={{ color: palette.accent }}>@</span>
                    <span
                      style={{
                        'font-weight': '600',
                        'text-transform': 'lowercase',
                        color: palette.accent,
                      }}
                    >
                      matt
                    </span>
                  </span>
                </>
              }
            />
            <MentionRow
              name="nick"
              action="mentioned you"
              date="JAN 27"
              opacity={0.7}
              message={
                <>
                  <span
                    style={{
                      display: 'inline-flex',
                      'align-items': 'center',
                      gap: '2px',
                      padding: '2px 4px',
                      background: palette.bg,
                    }}
                  >
                    <span style={{ color: palette.accent }}>@</span>
                    <span
                      style={{
                        'font-weight': '600',
                        'text-transform': 'lowercase',
                        color: palette.accent,
                      }}
                    >
                      matt
                    </span>
                  </span>
                  <span>I've been ideating on this direction...</span>
                </>
              }
            />
            <MentionRow
              name="ali"
              action="mentioned you"
              date="22 minutes ago"
              opacity={0.4}
              avatars={['N', 'S']}
              message={
                <>
                  <span
                    style={{
                      display: 'inline-flex',
                      'align-items': 'center',
                      gap: '2px',
                      padding: '2px 4px',
                      background: palette.bg,
                    }}
                  >
                    <span style={{ color: palette.accent }}>@</span>
                    <span
                      style={{
                        'font-weight': '600',
                        'text-transform': 'lowercase',
                        color: palette.accent,
                      }}
                    >
                      matt
                    </span>
                  </span>
                  <span>here&apos;s the Figma link: </span>
                  <span
                    style={{
                      'text-decoration': 'underline',
                      color: palette.accent,
                    }}
                  >
                    figma.com/design/K6DBk5j...
                  </span>
                </>
              }
            />
            <MentionRow
              name="sarah"
              action="replied to thread"
              date="JAN 24"
              opacity={0.25}
              message={
                <>
                  <span>Pushed the latest updates to staging</span>
                  <span
                    style={{
                      display: 'inline-flex',
                      'align-items': 'center',
                      gap: '2px',
                      padding: '2px 4px',
                      background: palette.bg,
                    }}
                  >
                    <span style={{ color: palette.accent }}>@</span>
                    <span
                      style={{
                        'font-weight': '600',
                        'text-transform': 'lowercase',
                        color: palette.accent,
                      }}
                    >
                      matt
                    </span>
                  </span>
                </>
              }
            />
          </div>

          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
            <svg
              viewBox="0 0 16 16"
              width="13"
              height="13"
              style={{ transform: 'rotate(-90deg)' }}
              fill="none"
            >
              <path
                d="M10.43 12.75a.5.5 0 0 1 0 .71.5.5 0 0 1-.71 0L4.68 8.42a.5.5 0 0 1 0-.71l5.04-5.04a.5.5 0 0 1 .71.71L5.75 8.06l4.68 4.69Z"
                fill={palette.muted2}
              />
            </svg>
            <p
              style={{
                'font-family': 'Rajdhani, sans-serif',
                'font-size': '11px',
                'font-weight': '600',
                'letter-spacing': '0.5px',
                'text-transform': 'uppercase',
                color: palette.muted2,
              }}
            >
              Show 4 more
            </p>
          </div>
        </div>
      </div>
      <svg
        width="50"
        height="50"
        style={{
          position: 'absolute',
          left: '0',
          bottom: '0',
          overflow: 'visible',
        }}
      >
        <line
          x1="-0.5"
          y1="1"
          x2="48.5"
          y2="50"
          stroke={palette.line}
          stroke-width="1.5"
        />
      </svg>
    </div>
  );
}

type PanelPosition = 'left' | 'center' | 'right';

function CardShell(props: {
  position: PanelPosition;
  active?: boolean;
  onClick?: () => void;
  children: JSX.Element;
}) {
  const mobile = breakpoint();
  const transform = mobile
    ? 'none'
    : props.position === 'left'
      ? 'translateX(-58%) scale(0.78)'
      : props.position === 'right'
        ? 'translateX(58%) scale(0.78)'
        : 'none';

  const opacity = mobile
    ? props.position === 'center'
      ? 1
      : 0
    : props.position === 'center'
      ? 1
      : 0.35;

  return (
    <div
      style={{
        position: 'absolute',
        top: '0',
        left: '50%',
        width: mobile ? 'min(520px, 100%)' : 'min(480px, 52%)',
        transform: `translateX(-50%) ${transform}`,
        opacity: `${opacity}`,
        'z-index': props.position === 'center' ? '2' : '1',
        'pointer-events':
          props.position === 'center' || mobile ? 'auto' : 'auto',
        cursor: props.position === 'center' ? 'default' : 'pointer',
        transition: 'transform 220ms ease, opacity 220ms ease',
      }}
      onClick={() => {
        if (props.position !== 'center' && props.onClick) props.onClick();
      }}
    >
      {props.children}
    </div>
  );
}

function CreateGraphic() {
  const mobile = breakpoint();
  const [active, setActive] = createSignal(1);

  const panelCopy = {
    email: (
      <>
        <span style={{ 'font-weight': '500', color: palette.text }}>Email</span>{' '}
        that feels like iMessage,
        <br />
        with superhuman shortcuts
        <br />
        and useful AI.
      </>
    ),
    task: (
      <>
        <span style={{ 'font-weight': '500', color: palette.text }}>Tasks</span>{' '}
        like Linear with c -&gt; t
        <br />
        instant create, @linked to
        <br />
        your emails, docs and messages.
      </>
    ),
    channels: (
      <>
        <span style={{ 'font-weight': '500', color: palette.text }}>
          Channels
        </span>{' '}
        zero friction -&gt; your
        <br />
        team&apos;s conversations just
        <br />
        got a whole lot smarter.
      </>
    ),
  } as const;

  const panels = [
    { key: 'email', card: <EmailCard /> },
    { key: 'task', card: <CreateTaskCard /> },
    { key: 'channels', card: <ChannelsCard /> },
  ] as const;

  const leftPanel = () =>
    panels[(active() + panels.length - 1) % panels.length];
  const centerPanel = () => panels[active()];
  const rightPanel = () => panels[(active() + 1) % panels.length];

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        'justify-content': 'center',
        'align-items': 'center',
        height: mobile ? '700px' : '760px',
      }}
    >
      {!mobile && (
        <>
          <div
            style={{
              position: 'absolute',
              top: '0',
              left: '50%',
              transform: 'translateX(-50%)',
              'max-width': '320px',
              'font-family': 'Rajdhani, sans-serif',
              'font-size': '12px',
              'line-height': '1.35',
              'text-align': 'center',
              color: palette.body,
            }}
          >
            {panelCopy[leftPanel().key]}
          </div>

          <div
            style={{
              position: 'absolute',
              left: '14%',
              bottom: '0',
              'max-width': '240px',
              'font-family': 'Rajdhani, sans-serif',
              'font-size': '12px',
              'line-height': '1.35',
              'text-align': 'center',
              color: palette.body,
            }}
          >
            {panelCopy[centerPanel().key]}
          </div>

          <div
            style={{
              position: 'absolute',
              right: '14%',
              bottom: '0',
              'max-width': '240px',
              'font-family': 'Rajdhani, sans-serif',
              'font-size': '12px',
              'line-height': '1.35',
              'text-align': 'center',
              color: palette.body,
            }}
          >
            {panelCopy[rightPanel().key]}
          </div>
        </>
      )}

      <CardShell
        position="left"
        onClick={() =>
          setActive((active() + panels.length - 1) % panels.length)
        }
      >
        {leftPanel().card}
      </CardShell>

      <CardShell position="center">
        <div style={{ position: 'relative' }}>
          {centerPanel().card}
          <CornerFrame />
        </div>
      </CardShell>

      <CardShell
        position="right"
        onClick={() => setActive((active() + 1) % panels.length)}
      >
        {rightPanel().card}
      </CardShell>
    </div>
  );
}

export const SectionCreate: Component = () => {
  return <CreateGraphic />;
};
