import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import IconCall from '../../assets/icons/icon-call.svg';
import IconChannels from '../../assets/icons/icon-channels.svg';
import IconCompany from '../../assets/icons/icon-company.svg';
import IconEmail from '../../assets/icons/icon-email.svg';
import IconFolder from '../../assets/icons/icon-folder.svg';
import IconTasks from '../../assets/icons/icon-tasks.svg';
import { AgentThreadWindow } from '../components/graphics/AgentThreadWindow';
import { AgentsFeatureGrid } from '../components/sections/AgentsFeatureGrid';
import { AgentsUiGrid } from '../components/sections/AgentsUiGrid';
import { HeroEyebrow } from '../components/sections/HeroEyebrow';
import {
  HomeAppPreview,
  HomeHeroBackdrop,
} from '../components/sections/HomeAppPreview';
import { HomeSectionRule } from '../components/sections/HomeSectionRule';
import {
  type LoopsFeatureBlock,
  LoopsFeatureSection,
  loopsFeatureHoverStyles,
} from '../components/sections/LoopsFeatureSection';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { viewportWidth } from '../utils/utilBreakpoint';
import { CtaIcon, ctaHref, ctaLabel, handleCtaClick } from '../utils/utilCta';
import { setPageSeo } from '../utils/utilSeo';

const mobile = () => viewportWidth() < 700;

const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const DOC_BLUE = 'var(--a4)';
const TASK_GREEN = 'var(--a2)';
const CALL_TEAL = 'var(--a3)';

// ---------------------------------------------------------------------------
// CTAs
// ---------------------------------------------------------------------------

function ConnectGoogleButton(props: { buttonName: string; large?: boolean }) {
  return (
    <a
      href={ctaHref()}
      class="agents-cta-button"
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
        height: mobile() ? '40px' : props.large ? '46px' : '40px',
        'justify-content': 'center',
        'letter-spacing': '0.045em',
        'line-height': 1,
        overflow: 'hidden',
        padding: mobile() ? '0 20px' : props.large ? '0 28px' : '0 22px',
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

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

function SparkGlyph(props: { size?: number; color?: string }) {
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
        d="M12 2c.5 5.4 2.6 7.5 8 8-5.4.5-7.5 2.6-8 8-.5-5.4-2.6-7.5-8-8 5.4-.5 7.5-2.6 8-8z"
        fill={props.color ?? 'currentColor'}
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
  const c = props.color ?? TASK_GREEN;
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

function ClockGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 15;
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
        stroke={props.color ?? 'var(--c4)'}
        stroke-width="1.7"
      />
      <path
        d="M12 7.5V12l3 2"
        fill="none"
        stroke={props.color ?? 'var(--c4)'}
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function CheckCircle(props: { size?: number; color?: string }) {
  const s = props.size ?? 16;
  const c = props.color ?? 'var(--a2)';
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': c,
        'border-radius': '999px',
        color: 'var(--b0)',
        display: 'inline-flex',
        flex: 'none',
        height: `${s}px`,
        'justify-content': 'center',
        width: `${s}px`,
      }}
    >
      <svg
        width={Math.round(s * 0.6)}
        height={Math.round(s * 0.6)}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          d="M5 12l4.5 4.5L19 7"
          fill="none"
          stroke="currentColor"
          stroke-width="2.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline @mention pills
// ---------------------------------------------------------------------------

type MentionKind =
  | 'company'
  | 'contact'
  | 'person'
  | 'doc'
  | 'task'
  | 'channel'
  | 'call'
  | 'agent';

const mentionIconWrap: JSX.CSSProperties = {
  display: 'inline-flex',
  'margin-right': '4px',
  'vertical-align': 'middle',
};

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

function MentionPill(props: {
  kind: MentionKind;
  label: string;
  initials?: string;
}) {
  const isPerson = props.kind === 'person' || props.kind === 'contact';
  const isChannel = props.kind === 'channel';
  const isTask = props.kind === 'task';
  const isAgent = props.kind === 'agent';
  return (
    <span
      style={{
        color: isAgent ? 'var(--a0)' : 'var(--c1)',
        'font-family': appFont,
        'font-weight': isAgent ? '600' : '500',
        margin: '0 1px',
        'white-space': 'nowrap',
      }}
    >
      <Show when={isAgent}>
        <span style={{ ...mentionIconWrap, color: 'var(--a0)' }}>
          <SparkGlyph size={12} />
        </span>
      </Show>
      <Show when={isPerson}>
        <span style={mentionIconWrap}>
          <Avatar initials={props.initials ?? ''} size={16} color="var(--b3)" />
        </span>
      </Show>
      <Show when={props.kind === 'doc'}>
        <span style={mentionIconWrap}>
          <DocFileGlyph size={13} />
        </span>
      </Show>
      <Show when={isTask}>
        <span style={mentionIconWrap}>
          <TaskListGlyph size={13} />
        </span>
      </Show>
      <Show when={props.kind === 'call'}>
        <span style={mentionIconWrap}>
          <PhoneGlyph size={13} color={CALL_TEAL} />
        </span>
      </Show>
      <Show when={isChannel}>
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
          'text-decoration-line': isAgent ? 'none' : 'underline',
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

function ToolRow(props: {
  icon: JSX.Element;
  verb: string;
  subject?: string;
  meta?: string;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        'align-items': 'center',
        color: props.muted ? 'var(--c4)' : 'var(--c2)',
        display: 'flex',
        'font-family': appFont,
        'font-size': mobile() ? '12.5px' : '13.5px',
        gap: '10px',
        opacity: props.muted ? 0.6 : 1,
        padding: '9px 13px',
      }}
    >
      <span
        style={{ color: 'var(--c4)', display: 'inline-flex', flex: 'none' }}
      >
        {props.icon}
      </span>
      <span
        style={{
          'min-width': 0,
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }}
      >
        {props.verb}
        <Show when={props.subject}>
          {' '}
          <span style={{ color: 'var(--c1)', 'font-weight': '600' }}>
            {props.subject}
          </span>
        </Show>
      </span>
      <Show when={props.meta}>
        <span
          style={{
            'align-items': 'center',
            color: 'var(--c4)',
            display: 'inline-flex',
            flex: 'none',
            gap: '6px',
            'margin-left': 'auto',
          }}
        >
          <span style={{ 'white-space': 'nowrap' }}>{props.meta}</span>
        </span>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spotlight graphics (3 full-width sections)
// ---------------------------------------------------------------------------

// ---- 1. Full-workspace context ----

const contextSources: {
  kind: 'email' | 'channel' | 'task' | 'doc' | 'call' | 'company';
  label: string;
  meta: string;
}[] = [
  { kind: 'email', label: 'Email', meta: '18 threads' },
  { kind: 'channel', label: 'Messages', meta: '4 channels' },
  { kind: 'task', label: 'Tasks', meta: '12 items' },
  { kind: 'doc', label: 'Docs', meta: '7 docs' },
  { kind: 'call', label: 'Calls', meta: '3 transcripts' },
  { kind: 'company', label: 'CRM', meta: '2 records' },
];

const CONTEXT_SOURCE_ICONS: Record<
  (typeof contextSources)[number]['kind'],
  Component<{ style?: JSX.CSSProperties }>
> = {
  email: IconEmail,
  channel: IconChannels,
  task: IconTasks,
  doc: IconFolder,
  call: IconCall,
  company: IconCompany,
};

function sourceIcon(kind: (typeof contextSources)[number]['kind'], size = 16) {
  const Icon = CONTEXT_SOURCE_ICONS[kind];
  return (
    <Icon
      aria-hidden="true"
      style={{
        color: 'var(--c2)',
        display: 'block',
        flex: 'none',
        height: `${size}px`,
        overflow: 'visible',
        width: `${size}px`,
      }}
    />
  );
}

function UnifiedContextGraphic() {
  const compact = () => mobile();
  const divider = '1px solid color-mix(in srgb, var(--c4) 10%, transparent)';
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        width: '100%',
      }}
    >
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '14px',
          'box-shadow': 'var(--shadow-panel-md)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          width: 'min(560px, 100%)',
        }}
      >
        {/* One prompt */}
        <div
          style={{
            'align-items': 'center',
            'border-bottom': divider,
            display: 'flex',
            gap: '10px',
            padding: compact() ? '14px' : '15px 18px',
          }}
        >
          <span
            style={{ color: 'var(--a0)', display: 'inline-flex', flex: 'none' }}
          >
            <SparkGlyph size={16} color="var(--a0)" />
          </span>
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '14px' : '15px',
              'font-weight': '500',
            }}
          >
            Catch me up on the mobile sync regression — what&apos;s the real
            status?
          </span>
        </div>

        {/* Everything it read, in one pass */}
        <div
          style={{
            'border-bottom': divider,
            display: 'grid',
            gap: '10px',
            padding: compact() ? '14px' : '14px 18px',
          }}
        >
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '11px',
              'font-weight': '600',
              'letter-spacing': '0.03em',
              'text-transform': 'uppercase',
            }}
          >
            Read in one pass
          </span>
          <div
            style={{
              display: 'grid',
              gap: '8px',
              'grid-template-columns': compact()
                ? 'repeat(2, 1fr)'
                : 'repeat(3, 1fr)',
            }}
          >
            <For each={contextSources}>
              {(s) => (
                <div
                  style={{
                    'align-items': 'center',
                    'background-color': 'var(--b0)',
                    border: divider,
                    'border-radius': '9px',
                    display: 'flex',
                    gap: '9px',
                    padding: '9px 10px',
                  }}
                >
                  <span
                    style={{
                      'align-items': 'center',
                      'background-color':
                        'color-mix(in srgb, var(--c4) 9%, transparent)',
                      'border-radius': '7px',
                      display: 'inline-grid',
                      flex: 'none',
                      height: '26px',
                      'place-items': 'center',
                      width: '26px',
                    }}
                  >
                    {sourceIcon(s.kind, 15)}
                  </span>
                  <div style={{ display: 'grid', gap: '1px', 'min-width': 0 }}>
                    <span
                      style={{
                        color: 'var(--c1)',
                        'font-family': appFont,
                        'font-size': '12.5px',
                        'font-weight': '600',
                      }}
                    >
                      {s.label}
                    </span>
                    <span
                      style={{
                        color: 'var(--c4)',
                        'font-family': appFont,
                        'font-size': '11px',
                      }}
                    >
                      {s.meta}
                    </span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* One answer */}
        <div style={{ padding: compact() ? '14px' : '16px 18px' }}>
          <p
            style={{
              color: 'var(--c2)',
              'font-family': appFont,
              'font-size': compact() ? '13.5px' : '14.5px',
              'line-height': 1.6,
              margin: 0,
            }}
          >
            Not shipped. Writes vanish when the app is backgrounded mid-sync —
            but only on the new queue path. The real signal came from the{' '}
            <span
              style={{
                color: 'var(--c1)',
                'font-weight': '600',
                'text-decoration-line': 'underline',
                'text-decoration-color':
                  'color-mix(in srgb, var(--c4) 45%, transparent)',
                'text-underline-offset': '2px',
              }}
            >
              go / no-go call
            </span>
            , not the status doc.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- 2. Takes real actions ----

const createdTasks: {
  title: string;
  assignee: string;
  initials: string;
  due: string;
}[] = [
  {
    title: 'Finalize staging deploy runbook',
    assignee: 'Marcus',
    initials: 'ML',
    due: 'Thu',
  },
  {
    title: 'Send security sign-off to Sarah',
    assignee: 'Priya',
    initials: 'PN',
    due: 'Wed',
  },
  {
    title: 'Draft launch announcement',
    assignee: 'You',
    initials: 'JB',
    due: 'Fri',
  },
];

function ActionsGraphic() {
  const compact = () => mobile();
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: compact() ? '28px 16px' : '40px 24px',
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
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            padding: compact() ? '14px' : '15px 17px',
          }}
        >
          <p
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': compact() ? '14px' : '14.5px',
              'line-height': 1.5,
              margin: 0,
            }}
          >
            <MentionPill kind="agent" label="Macro" /> turn the{' '}
            <MentionPill kind="call" label="Atlas go / no-go" /> into tasks and
            assign them.
          </p>
        </div>
        <div
          style={{
            'border-bottom':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
          }}
        >
          <ToolRow
            icon={<PhoneGlyph size={15} color={CALL_TEAL} />}
            verb="Read call"
            subject="Atlas go / no-go"
            meta="38 min"
          />
          <ToolRow
            icon={<TaskListGlyph size={15} />}
            verb="Create task"
            meta="×3"
          />
        </div>
        <div
          style={{
            display: 'grid',
            gap: '0',
            padding: compact() ? '8px' : '10px 12px',
          }}
        >
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '11px',
              'font-weight': '600',
              'letter-spacing': '0.03em',
              padding: '6px 6px',
              'text-transform': 'uppercase',
            }}
          >
            Created 3 tasks
          </span>
          <For each={createdTasks}>
            {(t) => (
              <div
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  gap: '10px',
                  padding: '9px 6px',
                }}
              >
                <CheckCircle size={18} />
                <span
                  style={{
                    color: 'var(--c1)',
                    flex: 1,
                    'font-family': appFont,
                    'font-size': compact() ? '13px' : '13.5px',
                    'min-width': 0,
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'white-space': 'nowrap',
                  }}
                >
                  {t.title}
                </span>
                <span
                  style={{
                    'align-items': 'center',
                    display: 'inline-flex',
                    flex: 'none',
                    gap: '6px',
                  }}
                >
                  <Avatar initials={t.initials} size={20} color="var(--b3)" />
                  <span
                    style={{
                      color: 'var(--c4)',
                      'font-family': appFont,
                      'font-size': '11.5px',
                    }}
                  >
                    {t.due}
                  </span>
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// ---- 3. Runs on a schedule ----

const weekDays = [
  { label: 'Sun', on: false },
  { label: 'Mon', on: true },
  { label: 'Tue', on: true },
  { label: 'Wed', on: true },
  { label: 'Thu', on: true },
  { label: 'Fri', on: true },
  { label: 'Sat', on: false },
];

function AutomationGraphic() {
  const compact = () => mobile();
  const fieldStyle: JSX.CSSProperties = {
    'background-color': 'var(--b0)',
    border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
    'border-radius': '9px',
    'box-sizing': 'border-box',
    color: 'var(--c2)',
    'font-family': appFont,
    'font-size': '13px',
    padding: '10px 12px',
    width: '100%',
  };
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        width: '100%',
        'max-width': '560px',
      }}
    >
      <div
        style={{
          'background-color': '#0a0a0a',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': '14px',
          'box-shadow': 'var(--shadow-elevated)',
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
            padding: compact() ? '13px 14px' : '14px 18px',
          }}
        >
          <span style={{ color: 'var(--a4)', display: 'inline-flex' }}>
            <ClockGlyph size={16} color="var(--a4)" />
          </span>
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '14.5px',
              'font-weight': '600',
            }}
          >
            Daily inbox brief
          </span>
          <span
            style={{
              'align-items': 'center',
              display: 'inline-flex',
              gap: '7px',
              'margin-left': 'auto',
            }}
          >
            <span
              style={{
                'background-color': 'var(--b3)',
                'border-radius': '6px',
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '11.5px',
                'font-weight': '600',
                padding: '4px 9px',
              }}
            >
              Run Now
            </span>
            <Show when={!compact()}>
              <span
                style={{
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                  'border-radius': '6px',
                  color: 'var(--c2)',
                  'font-family': appFont,
                  'font-size': '11.5px',
                  'font-weight': '600',
                  padding: '4px 9px',
                }}
              >
                Pause
              </span>
            </Show>
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '16px',
            padding: compact() ? '14px' : '16px 18px',
          }}
        >
          <div style={{ display: 'grid', gap: '7px' }}>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '12.5px',
                'font-weight': '600',
              }}
            >
              Instructions
            </span>
            <div style={fieldStyle}>
              Summarize my Signal inbox. Group into: needs a reply today, FYI,
              and waiting on others. Keep it under ten bullets.
            </div>
          </div>

          <div style={{ display: 'grid', gap: '9px' }}>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '12.5px',
                'font-weight': '600',
              }}
            >
              Schedule
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '12px',
                'margin-top': '-3px',
              }}
            >
              Weekdays at 8:00 AM (America/New_York)
            </span>
            <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '6px' }}>
              <For each={weekDays}>
                {(d) => (
                  <span
                    style={{
                      'align-items': 'center',
                      'background-color': d.on
                        ? 'color-mix(in srgb, var(--c1) 12%, transparent)'
                        : 'var(--b0)',
                      border: d.on
                        ? '1px solid color-mix(in srgb, var(--c4) 24%, transparent)'
                        : '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
                      'border-radius': '7px',
                      color: d.on ? 'var(--c1)' : 'var(--c4)',
                      display: 'inline-flex',
                      'font-family': appFont,
                      'font-size': '12px',
                      'font-weight': '600',
                      'justify-content': 'center',
                      'min-width': '40px',
                      padding: '6px 4px',
                    }}
                  >
                    {d.label}
                  </span>
                )}
              </For>
            </div>
          </div>
        </div>

        <div
          style={{
            'align-items': 'center',
            'background-color': 'color-mix(in srgb, var(--b1) 50%, var(--b0))',
            'border-top':
              '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
            display: 'flex',
            gap: '10px',
            padding: compact() ? '12px 14px' : '13px 18px',
          }}
        >
          <span style={{ color: 'var(--c4)', display: 'inline-flex' }}>
            <MailGlyph size={16} />
          </span>
          <span
            style={{
              color: 'var(--c2)',
              'font-family': appFont,
              'font-size': compact() ? '12.5px' : '13px',
            }}
          >
            Lands in your inbox every weekday at 8:00 AM
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spotlight block definitions
// ---------------------------------------------------------------------------

// Each spotlight graphic is lifted in front of a dimmed agent-thread window so
// the section reads as depth, not a floating card (matches the other pages).
function AgentSpotlight(props: {
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
        <div
          aria-hidden="true"
          style={{
            filter: 'saturate(0.85)',
            '-webkit-mask-image':
              'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
            'mask-image':
              'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
            'max-width': '1040px',
            opacity: '0.3',
            'pointer-events': 'none',
            width: '100%',
          }}
        >
          <AgentThreadWindow />
        </div>
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

const ContextSpotlight = () => (
  <AgentSpotlight liftMaxWidth="600px">
    <UnifiedContextGraphic />
  </AgentSpotlight>
);
const ActionsSpotlight = () => (
  <AgentSpotlight liftMaxWidth="560px">
    <ActionsGraphic />
  </AgentSpotlight>
);
const ScheduleSpotlight = () => (
  <AgentSpotlight liftMaxWidth="560px">
    <AutomationGraphic />
  </AgentSpotlight>
);

const contextBlock: LoopsFeatureBlock = {
  label: 'Agents',
  headline: (
    <>
      Full-workspace
      <br />
      context, one prompt.
    </>
  ),
  description:
    'Your email, messages, tasks, docs, calls, and CRM — read in a single pass, and distilled into one clear answer.',
  href: 'https://docs.macro.com/product/agents',
  heroShot: ContextSpotlight,
  heroBare: true,
};

const actionsBlock: LoopsFeatureBlock = {
  label: 'Agents',
  headline: (
    <>
      Takes real actions,
      <br />
      not just answers.
    </>
  ),
  description:
    'Ask an agent to turn a call into tasks, draft an email, or update a record — it does it.',
  href: 'https://docs.macro.com/product/agents',
  heroShot: ActionsSpotlight,
  heroBare: true,
};

const scheduleBlock: LoopsFeatureBlock = {
  label: 'Agents',
  headline: (
    <>
      Runs on a schedule,
      <br />
      lands in your inbox.
    </>
  ),
  description:
    'Set recurring automations — daily briefs, weekly recaps — and find results waiting for you.',
  href: 'https://docs.macro.com/product/agents',
  heroShot: ScheduleSpotlight,
  heroBare: true,
};

// ---------------------------------------------------------------------------
// Comparison table (Macro vs ChatGPT vs Glean vs Notion AI)
// ---------------------------------------------------------------------------

type Cell = boolean | 'partial' | string;

const comparisonColumns = ['Macro', 'ChatGPT', 'Glean', 'Notion AI'];

const comparisonRows: { feature: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  {
    feature: 'Reads your real work: email, calls, docs, tasks & chat',
    cells: [true, false, 'partial', 'partial'],
  },
  {
    feature: 'One prompt, unified context (no per-tool searching)',
    cells: [true, false, 'partial', false],
  },
  {
    feature: 'Takes action: send email, create tasks & docs',
    cells: [true, 'partial', false, 'partial'],
  },
  {
    feature: 'Recurring automations into your inbox',
    cells: [true, 'partial', false, false],
  },
  {
    feature: 'Inherits your exact permissions',
    cells: [true, 'partial', true, 'partial'],
  },
  {
    feature: 'Fast in-conversation agent (@Macro)',
    cells: [true, false, false, false],
  },
  {
    feature: 'Connect any tool via MCP',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: 'Use your workspace from your own coding agent',
    cells: [true, false, false, false],
  },
  { feature: 'Open source (AGPLv3)', cells: [true, false, false, false] },
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
          'min-width': mobile() ? '540px' : 'auto',
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

function ComparisonSection() {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <section
      aria-label="How Macro Agents compare"
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
        <span
          style={{
            color: 'var(--a0)',
            'font-family': 'rajdhani, body',
            'font-size': mobile() ? '12px' : '16px',
            'letter-spacing': '0.08em',
            'text-transform': 'uppercase',
          }}
        >
          The comparison
        </span>
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
          Context and a clever model.
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-size': mobile() ? '16px' : '19px',
            'line-height': 1.45,
            margin: 0,
            'max-width': '560px',
          }}
        >
          A chatbot makes you paste in context. Macro already has it — and acts
          on it.
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
// Final CTA
// ---------------------------------------------------------------------------

function AgentsFinalCta() {
  return (
    <section
      aria-label="Get started with Agents"
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
          Put your agent to work.
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
          Connect in 30 seconds and put an agent to work across your email,
          calls, docs, and tasks.
        </p>
      </div>
      <ConnectGoogleButton buttonName="agents_final_connect_google" large />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const RouteAgents: Component = () => {
  setPageSeo({
    title: 'Macro Agents — AI With Your Whole Workspace as Context',
    description:
      'Agents in Macro are AI with access to everything in your workspace: email, messages, tasks, docs, and calls, with your exact permissions. They answer, take action, run on a schedule, and connect to your tools via MCP.',
    path: '/agents',
  });

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
          .agents-cta-button:hover { transform: scale(1.02); }
        }
        ${loopsFeatureHoverStyles()}
      `}</style>

      {/* Hero */}
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
            <HeroEyebrow label="Macro Agents" mobile={mobile} />
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
              An agent for your company.
            </h1>
            <p
              style={{
                color: 'var(--c4)',
                'font-family': 'body',
                'font-size': mobile() ? '16.5px' : '23px',
                'font-weight': '400',
                'line-height': 1.5,
                margin: '0',
                'max-width': mobile() ? '34ch' : '600px',
              }}
            >
              AI that works from everything you have — email, messages, tasks,
              docs, and calls — with your exact permissions.
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
              <ConnectGoogleButton buttonName="agents_hero_connect_google" />
            </div>
          </div>
        </section>

        <HomeAppPreview
          mobile={mobile}
          defaultSection="agents"
          showStrip={false}
          fadeBottom
          keepSidebarCollapsed
        />
      </div>

      <HomeSectionRule />

      {/* Feature grid — 4 iso pillars */}
      <AgentsFeatureGrid />

      <HomeSectionRule />

      {/* Spotlight 1 — Full-workspace context */}
      <div
        style={{
          'padding-block': mobile() ? '56px' : '80px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <LoopsFeatureSection
          block={contextBlock}
          textLayout="split"
          spotlight
          spotlightGlow={0}
        />
      </div>

      <HomeSectionRule />

      {/* Spotlight 2 — Takes real actions */}
      <div
        style={{
          'padding-block': mobile() ? '56px' : '80px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <LoopsFeatureSection
          block={actionsBlock}
          textLayout="split"
          spotlight
          spotlightGlow={0}
        />
      </div>

      <HomeSectionRule />

      {/* Spotlight 3 — Runs on a schedule */}
      <div
        style={{
          'padding-block': mobile() ? '56px' : '80px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <LoopsFeatureSection
          block={scheduleBlock}
          textLayout="split"
          spotlight
          spotlightGlow={0}
        />
      </div>

      <HomeSectionRule />

      {/* 2×2 bento — concrete UI mocks */}
      <AgentsUiGrid />

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
        <AgentsFinalCta />
      </div>

      {/* Divider + footer */}
      <div
        style={{
          'padding-bottom': mobile() ? '40px' : '48px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <SectionMoreFeatures currentPath="/agents" footerOnly />
      </div>
    </div>
  );
};
