import type { JSX } from 'solid-js';
import IconChannel from '../../../assets/icons/wide-channel.svg';
import IconChat from '../../../assets/icons/wide-chat.svg';
import IconStar from '../../../assets/icons/wide-star.svg';
import IconTask from '../../../assets/icons/wide-task.svg';
import { viewportWidth } from '../../utils/utilBreakpoint';
import { PreviewWindow } from './PreviewWindow';

// Agents mockup panel — a back-and-forth AI agent conversation: the user asks,
// the agent works the question with snazzy tool calls (searching all email and
// messages, analyzing attachments, reading tasks), reasons over what it found
// with inline channel / person / message mentions, quotes the thread, and
// synthesises. Reuses the shared hero-window frame and Ask-AI input bar.

const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Phosphor glyphs (24px grid) for the tool-call rows and turn actions.
const PATH = {
  search:
    'M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z',
  attach:
    'M209.66,122.34a8,8,0,0,1,0,11.32l-82.05,82a56,56,0,0,1-79.2-79.21L147.67,37.21a40,40,0,0,1,56.58,56.57L105,193a24,24,0,0,1-33.94-33.95l72.71-72.69a8,8,0,0,1,11.32,11.32L82.36,170.31a8,8,0,0,0,11.32,11.32L192.92,82.46a24,24,0,0,0-33.95-33.94L59.32,147.93a40,40,0,0,0,56.57,56.57l82-82A8,8,0,0,1,209.66,122.34Z',
  task: 'M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,48V208a24,24,0,0,1-24,24H48a24,24,0,0,1-24-24V48A24,24,0,0,1,48,24H208A24,24,0,0,1,232,48Zm-16,0a8,8,0,0,0-8-8H48a8,8,0,0,0-8,8V208a8,8,0,0,0,8,8H208a8,8,0,0,0,8-8Z',
  chat: 'M216,48H40A16,16,0,0,0,24,64V224a15.84,15.84,0,0,0,9.25,14.5A16.05,16.05,0,0,0,40,240a15.89,15.89,0,0,0,10.25-3.78c.09-.07.17-.15.25-.22L82.5,208H216a16,16,0,0,0,16-16V64A16,16,0,0,0,216,48Z',
  chevron:
    'M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z',
  text: 'M40,72a8,8,0,0,1,8-8H208a8,8,0,0,1,0,16H48A8,8,0,0,1,40,72Zm8,40H160a8,8,0,0,0,0-16H48a8,8,0,0,0,0,16Zm160,16H48a8,8,0,0,0,0,16H208a8,8,0,0,0,0-16Zm-48,32H48a8,8,0,0,0,0,16H160a8,8,0,0,0,0-16Z',
  copy: 'M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z',
} as const;

function Glyph(props: { d: string; size?: number }) {
  return (
    <svg
      width={props.size ?? 14}
      height={props.size ?? 14}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path d={props.d} />
    </svg>
  );
}

const tools: { icon: keyof typeof PATH; label: string; count: string }[] = [
  {
    icon: 'search',
    label: 'Searched all email & messages',
    count: '612 scanned',
  },
  {
    icon: 'attach',
    label: 'Analyzed 4 attachments',
    count: '2 logs · 1 trace',
  },
  { icon: 'task', label: 'Read tasks in Sync', count: '9 tasks' },
];

export function AgentThreadWindow() {
  const compact = () => viewportWidth() < 700;
  const fs = () => (compact() ? '12.5px' : '13.5px');

  const para: JSX.CSSProperties = {
    color: 'var(--c2)',
    'font-family': appFont,
    'line-height': 1.55,
    margin: '0',
  };
  const name: JSX.CSSProperties = { color: 'var(--c1)', 'font-weight': '600' };
  const strong: JSX.CSSProperties = {
    color: 'var(--c1)',
    'font-weight': '600',
  };

  // Inline channel mention — canonical channel icon + underlined label, matching
  // the app's entity-mention style (bright label, muted icon).
  const channelMention = (label: string) => (
    <span
      style={{
        color: 'var(--c1)',
        'font-family': appFont,
        'font-weight': '500',
        'white-space': 'nowrap',
      }}
    >
      <span
        style={{
          color: 'color-mix(in srgb, var(--c4) 85%, transparent)',
          display: 'inline-flex',
          'margin-right': '4px',
          'vertical-align': 'middle',
        }}
      >
        <IconChannel
          aria-hidden="true"
          style={{ display: 'block', height: '13px', width: '13px' }}
        />
      </span>
      <span
        style={{
          'text-decoration-line': 'underline',
          'text-decoration-color':
            'color-mix(in srgb, var(--c4) 50%, transparent)',
          'text-underline-offset': '2px',
        }}
      >
        {label}
      </span>
    </span>
  );

  // Inline "Message" type tag — canonical chat icon + muted label.
  const messageTag = () => (
    <span
      style={{
        'align-items': 'center',
        color: 'color-mix(in srgb, var(--c4) 72%, transparent)',
        display: 'inline-flex',
        gap: '4px',
        'vertical-align': 'middle',
        'white-space': 'nowrap',
      }}
    >
      <IconChat
        aria-hidden="true"
        style={{ display: 'block', height: '12px', width: '12px' }}
      />
      <span style={{ 'font-size': '0.88em' }}>Message</span>
    </span>
  );

  const toolRow = (icon: keyof typeof PATH, label: string, count: string) => (
    <div
      style={{
        'align-items': 'center',
        'background-color': 'color-mix(in srgb, var(--c1) 3%, transparent)',
        'border-radius': '8px',
        'box-sizing': 'border-box',
        display: 'flex',
        gap: '9px',
        padding: '7px 11px',
      }}
    >
      <span style={{ color: 'var(--a0)', display: 'flex', flex: 'none' }}>
        <Glyph d={PATH[icon]} />
      </span>
      <span
        style={{
          color: 'color-mix(in srgb, var(--c4) 82%, transparent)',
          flex: 1,
          'font-family': appFont,
          'font-size': fs(),
          'min-width': 0,
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: 'color-mix(in srgb, var(--c4) 55%, transparent)',
          flex: 'none',
          'font-family': appFont,
          'font-size': '12px',
          'white-space': 'nowrap',
        }}
      >
        {count}
      </span>
    </div>
  );

  const thought = () => (
    <div
      style={{
        'align-items': 'center',
        color: 'color-mix(in srgb, var(--c4) 58%, transparent)',
        display: 'flex',
        'font-family': appFont,
        'font-size': '12.5px',
        gap: '5px',
      }}
    >
      <Glyph d={PATH.chevron} size={9} />
      Thought
    </div>
  );

  const userBubble = (text: string) => (
    <div
      style={{
        'background-color': 'color-mix(in srgb, var(--b2) 34%, transparent)',
        border: '1px solid color-mix(in srgb, var(--b4) 22%, transparent)',
        'border-radius': '14px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        'font-family': appFont,
        'font-size': fs(),
        'justify-self': 'end',
        'line-height': 1.45,
        'max-width': '84%',
        padding: compact() ? '9px 13px' : '10px 15px',
      }}
    >
      {text}
    </div>
  );

  // Small uppercase status/tag pill.
  const chip = (text: string, accent?: boolean) => (
    <span
      style={{
        'align-items': 'center',
        'background-color': accent
          ? 'color-mix(in srgb, var(--a0) 15%, transparent)'
          : 'color-mix(in srgb, var(--c4) 12%, transparent)',
        'border-radius': '5px',
        color: accent
          ? 'var(--a0)'
          : 'color-mix(in srgb, var(--c2) 90%, transparent)',
        display: 'inline-flex',
        'font-family': appFont,
        'font-size': '10.5px',
        'font-weight': '700',
        'letter-spacing': '0.04em',
        padding: '2px 7px',
        'text-transform': 'uppercase',
        'white-space': 'nowrap',
      }}
    >
      {text}
    </span>
  );

  // A scannable "label · value" fact row (instead of a wall of prose).
  const factRow = (label: string, body: JSX.Element) => (
    <div
      style={{
        'align-items': 'baseline',
        display: 'grid',
        gap: compact() ? '9px' : '12px',
        'grid-template-columns': compact() ? '52px 1fr' : '62px 1fr',
      }}
    >
      <span
        style={{
          color: 'color-mix(in srgb, var(--c4) 68%, transparent)',
          'font-family': appFont,
          'font-size': '10.5px',
          'font-weight': '500',
          'letter-spacing': '0.06em',
          'text-transform': 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: 'var(--c2)',
          'font-family': appFont,
          'font-size': fs(),
          'line-height': 1.5,
        }}
      >
        {body}
      </span>
    </div>
  );

  return (
    <PreviewWindow class="agents-hero-window">
      <div
        style={{
          display: 'grid',
          'grid-template-columns': compact() ? 'minmax(0, 1fr)' : 'auto',
          'grid-template-rows': 'auto 1fr auto',
          'min-width': 0,
        }}
      >
        {/* Toolbar: agent thread title */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom':
              '1px solid color-mix(in srgb, var(--b4) 18%, transparent)',
            'box-sizing': 'border-box',
            display: 'flex',
            gap: '8px',
            height: compact() ? '42px' : '46px',
            overflow: 'hidden',
            padding: compact() ? '0 13px' : '0 16px',
          }}
        >
          <IconStar
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
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '14px' : '15px',
              'font-weight': '500',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
            }}
          >
            Mobile sync regression
          </span>
        </div>

        {/* Conversation */}
        <div
          style={{
            'align-content': 'start',
            'box-sizing': 'border-box',
            display: 'grid',
            gap: '11px',
            'grid-template-columns': compact() ? 'minmax(0, 1fr)' : 'auto',
            margin: '0 auto',
            'max-width': compact() ? '100%' : '620px',
            'min-height': 0,
            overflow: 'hidden',
            padding: compact() ? '12px 13px' : '14px 16px',
            width: '100%',
          }}
        >
          {userBubble(
            'Catch me up on the mobile sync regression — what’s the real status?'
          )}

          {thought()}
          {toolRow(tools[0].icon, tools[0].label, tools[0].count)}
          {toolRow(tools[1].icon, tools[1].label, tools[1].count)}
          {toolRow(tools[2].icon, tools[2].label, tools[2].count)}

          <div style={{ display: 'grid', gap: compact() ? '7px' : '9px' }}>
            {factRow(
              'Origin',
              <>
                Flagged in {channelMention('mobile')} by{' '}
                <span style={name}>Priya</span> {messageTag()} ·{' '}
                <span style={strong}>Tue 9:42am</span>
              </>
            )}
            {factRow(
              'Scope',
              <>Only the new offline-queue path — the old path is fine</>
            )}
            {factRow(
              'Impact',
              <>
                2 enterprise reports escalated to email by{' '}
                <span style={name}>Customer Success</span>
              </>
            )}
          </div>

          <div
            style={{
              'border-left':
                '2px solid color-mix(in srgb, var(--b4) 28%, transparent)',
              display: 'grid',
              gap: '3px',
              'padding-left': '12px',
            }}
          >
            <p
              style={{
                ...para,
                color: 'color-mix(in srgb, var(--c2) 88%, transparent)',
                'font-size': fs(),
                'font-style': 'italic',
              }}
            >
              1. writes vanish if you background the app mid-sync
            </p>
            <p
              style={{
                ...para,
                color: 'color-mix(in srgb, var(--c2) 88%, transparent)',
                'font-size': fs(),
                'font-style': 'italic',
              }}
            >
              2. only on the new queue path — the old path is fine
            </p>
          </div>

          {/* Status callout — the synthesis, surfaced as a tinted result. */}
          <div
            style={{
              'background-color':
                'color-mix(in srgb, var(--a0) 5%, transparent)',
              'border-radius': '8px',
              display: 'grid',
              gap: '7px',
              padding: compact() ? '9px 11px' : '10px 13px',
            }}
          >
            <div
              style={{
                'align-items': 'center',
                display: 'flex',
                'flex-wrap': 'wrap',
                gap: '6px',
              }}
            >
              {chip('Confirmed', true)}
              {chip('resume-from-background')}
            </div>
            <p style={{ ...para, 'font-size': fs() }}>
              Regression from the offline-queue rewrite.{' '}
              <span style={name}>Theo</span> has a trace, but nothing tracks it
              yet.
            </p>
          </div>

          {/* Suggested-task card — a concrete next action, not more prose. */}
          <div
            style={{
              'background-color':
                'color-mix(in srgb, var(--b2) 32%, transparent)',
              border:
                '1px solid color-mix(in srgb, var(--b4) 22%, transparent)',
              'border-radius': '10px',
              display: 'grid',
              gap: '8px',
              padding: compact() ? '10px 11px' : '11px 13px',
            }}
          >
            <div
              style={{
                'align-items': 'center',
                color: 'color-mix(in srgb, var(--c4) 62%, transparent)',
                display: 'flex',
                'font-family': appFont,
                'font-size': '10.5px',
                'font-weight': '700',
                gap: '5px',
                'letter-spacing': '0.06em',
                'text-transform': 'uppercase',
              }}
            >
              <IconStar
                aria-hidden="true"
                style={{
                  color: 'var(--a0)',
                  display: 'block',
                  height: '13px',
                  width: '13px',
                }}
              />
              Suggested task
            </div>
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '9px' }}
            >
              <IconTask
                aria-hidden="true"
                style={{
                  color: 'var(--c4)',
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
                  'font-size': fs(),
                  'font-weight': '600',
                  'min-width': 0,
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                }}
              >
                Queue flush never fires on background-resume
              </span>
            </div>
            <div
              style={{ 'align-items': 'center', display: 'flex', gap: '8px' }}
            >
              {chip('Sync')}
              <span
                style={{
                  'align-items': 'center',
                  color: 'color-mix(in srgb, var(--c4) 78%, transparent)',
                  display: 'inline-flex',
                  'font-family': appFont,
                  'font-size': '11.5px',
                  gap: '5px',
                }}
              >
                <span
                  style={{
                    'align-items': 'center',
                    'background-color': 'var(--b3)',
                    'border-radius': '999px',
                    color: 'var(--c1)',
                    display: 'inline-flex',
                    'font-size': '9px',
                    'font-weight': '700',
                    height: '16px',
                    'justify-content': 'center',
                    width: '16px',
                  }}
                >
                  T
                </span>
                Theo
              </span>
            </div>
          </div>

          <div
            style={{
              color: 'color-mix(in srgb, var(--c4) 45%, transparent)',
              display: 'flex',
              gap: '12px',
            }}
          >
            <Glyph d={PATH.text} size={15} />
            <Glyph d={PATH.copy} size={15} />
          </div>

          {userBubble(
            'Draft the status update and file the resume-flush task to Theo.'
          )}
        </div>
      </div>
    </PreviewWindow>
  );
}
