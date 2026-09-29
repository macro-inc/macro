/*
 * /migrate is the switching guide. The focus is how to move: what maps to what,
 * the steps for each tool people come from, and what to connect rather than
 * migrate. Where a section touches on why Macro is different, it stays short
 * and links out to the versus posts, the feature pages, and the docs.
 *
 * Copy tracks docs.macro.com/switch-to-macro; the switch graphics there are
 * rebuilt against this site's theme variables in SwitchGraphic.tsx.
 */
import { A } from '@solidjs/router';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { isServer } from 'solid-js/web';
import markDesyncPlaceholder from '../../assets/mark-desync-placeholder.jpg';
import markAvatar from '../../assets/people/mark.jpeg';
import { MacroMarkIcon } from '../components/graphics/MacroMarkIcon';
import { ModuleGraphic } from '../components/graphics/ModuleGraphic';
import { MODULE_LOGOS } from '../components/graphics/moduleLogos';
import { SetupGraphic } from '../components/graphics/SetupGraphic';
import {
  type SwitchBrand,
  SwitchBrandIcon,
} from '../components/graphics/SwitchGraphic';
import { ComparisonTable } from '../components/sections/ComparisonTable';
import { HomeHeroBackdrop } from '../components/sections/HomeAppPreview';
import { HomeSectionRule } from '../components/sections/HomeSectionRule';
import { SectionHomeQuote } from '../components/sections/SectionHomeQuote';
import { SectionMigrateComparisons } from '../components/sections/SectionMigrateComparisons';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { buildCalLinkWithAttribution } from '../utils/utilAnalytic';
import { APP_BASE_URL } from '../utils/utilBaseUrl';
import { viewportWidth } from '../utils/utilBreakpoint';
import { ctaHref, ctaLabel, handleCtaClick } from '../utils/utilCta';
import { setPageSeo } from '../utils/utilSeo';

const mobile = () => viewportWidth() < 700;
// The comparison panels need ample room for their 170px fiducial rail. Below
// this point, use the compact flow rather than progressively squeezing it.
const comparisonMobile = () => viewportWidth() < 1200;

const isLocalhost =
  !isServer && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const desyncVideoUrl = isLocalhost
  ? '/video/desync.mp4'
  : new URL('/video/desync.mp4', APP_BASE_URL).toString();

const DEMO_CALL_HREF = buildCalLinkWithAttribution(
  'https://cal.com/team/macro/macro-demo-call'
);

const DOCS = 'https://docs.macro.com';
const DOCS_SWITCH = `${DOCS}/switch-to-macro`;

// The five brand marks, in the order the hero scene's slots carry them.
const MODULE_ROW = [
  MODULE_LOGOS.Linear,
  MODULE_LOGOS.Google,
  MODULE_LOGOS.GitHub,
  MODULE_LOGOS.Notion,
  MODULE_LOGOS.Slack,
];

const SWITCH_LABELS: Record<SwitchBrand, string> = {
  superhuman: 'Superhuman',
  notion: 'Notion',
  slack: 'Slack',
  linear: 'Linear',
  clickup: 'ClickUp',
};

// ---------------------------------------------------------------------------
// Shared styles and small pieces
// ---------------------------------------------------------------------------

const sectionShell = (): JSX.CSSProperties => ({
  'box-sizing': 'border-box',
  display: 'grid',
  'justify-items': 'center',
  'padding-block': mobile() ? '72px' : '116px',
  'padding-inline': mobile() ? '18px' : '24px',
  width: '100%',
});

const columnStyle = (): JSX.CSSProperties => ({
  'box-sizing': 'border-box',
  display: 'grid',
  gap: mobile() ? '32px' : '44px',
  'max-width': '820px',
  'min-width': '0',
  width: '100%',
});

const bodyStyle = (): JSX.CSSProperties => ({
  color: 'var(--c4)',
  'font-family': 'cyberreader, body',
  'font-size': mobile() ? '16.5px' : '18px',
  'line-height': 1.75,
  margin: '0',
  'text-wrap': 'pretty',
});

const comparisonBodyStyle = (): JSX.CSSProperties => ({
  ...bodyStyle(),
  'font-size': mobile() ? '15px' : '16px',
  'line-height': 1.7,
});

const pillStyle = (): JSX.CSSProperties => ({
  'align-items': 'center',
  'background-color': 'var(--b1)',
  border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
  'border-radius': '999px',
  color: 'var(--c2)',
  cursor: 'default',
  display: 'inline-flex',
  'font-family': 'rajdhani, body',
  'font-size': mobile() ? '13px' : '14px',
  'font-weight': '700',
  gap: '7px',
  'letter-spacing': '0.05em',
  padding: '8px 15px',
  'text-decoration': 'none',
  'text-transform': 'uppercase',
});

function ConnectGoogleButton(props: { buttonName: string; large?: boolean }) {
  return (
    <a
      href={ctaHref()}
      class="migrate-cta-button"
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
        'font-weight': '750',
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
      {ctaLabel('Quick import via MCP')}
    </a>
  );
}

function BookCallButton(props: { large?: boolean }) {
  return (
    <a
      href={DEMO_CALL_HREF}
      target="_blank"
      rel="noreferrer"
      class="migrate-cta-button"
      style={{
        'align-items': 'center',
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--c4) 32%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        cursor: 'default',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': mobile() ? '15px' : props.large ? '18px' : '16px',
        'font-weight': '700',
        height: mobile() ? '40px' : props.large ? '46px' : '40px',
        'justify-content': 'center',
        'letter-spacing': '0.045em',
        'line-height': 1,
        padding: mobile() ? '0 20px' : props.large ? '0 26px' : '0 20px',
        'text-decoration': 'none',
        'text-transform': 'uppercase',
        transition: 'transform 160ms ease',
        'white-space': 'nowrap',
        width: mobile() ? '100%' : 'max-content',
      }}
    >
      Talk to us
    </a>
  );
}

/** Inline link styled like the surrounding body copy. */
function InlineLink(props: {
  href: string;
  external?: boolean;
  children: JSX.Element;
}) {
  const style: JSX.CSSProperties = {
    color: 'var(--a0)',
    'text-decoration': 'none',
  };
  return (
    <Show
      when={props.external}
      fallback={
        <A href={props.href} class="migrate-link" style={style}>
          {props.children}
        </A>
      }
    >
      <a
        href={props.href}
        target="_blank"
        rel="noreferrer"
        class="migrate-link"
        style={style}
      >
        {props.children}
      </a>
    </Show>
  );
}

/** A keyboard key, mirroring the <kbd> shortcuts in the docs. */
function Key(props: { children: JSX.Element }) {
  return (
    <kbd
      style={{
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
        'border-radius': '5px',
        color: 'var(--c2)',
        'font-family': 'rajdhani, body',
        'font-size': '0.85em',
        'font-weight': '700',
        padding: '1px 6px',
      }}
    >
      {props.children}
    </kbd>
  );
}

/** The agent prompt people paste to run an import. */
function PromptBlock(props: { children: string }) {
  return (
    <pre
      style={{
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--c4) 12%, transparent)',
        'border-radius': '8px',
        'box-sizing': 'border-box',
        color: 'var(--c2)',
        'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
        'font-size': mobile() ? '13px' : '14px',
        'line-height': 1.6,
        margin: 0,
        'overflow-x': 'auto',
        padding: mobile() ? '14px 16px' : '18px 20px',
        'white-space': 'pre-wrap',
        width: '100%',
      }}
    >
      {props.children}
    </pre>
  );
}

function Steps(props: { items: (() => JSX.Element)[] }) {
  return (
    <ol
      style={{
        display: 'grid',
        gap: mobile() ? '10px' : '12px',
        margin: 0,
        'padding-left': '22px',
      }}
    >
      <For each={props.items}>
        {(item) => (
          <li style={{ ...comparisonBodyStyle(), 'padding-left': '4px' }}>
            {item()}
          </li>
        )}
      </For>
    </ol>
  );
}

function SettingsPath(props: { children: JSX.Element }) {
  return (
    <strong style={{ color: 'var(--c2)', 'font-weight': '600' }}>
      {props.children}
    </strong>
  );
}

function SectionHeading(props: {
  eyebrow?: string;
  title: string;
  children?: JSX.Element;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: mobile() ? '16px' : '20px',
        'justify-items': 'center',
        'max-width': '680px',
        'text-align': 'center',
      }}
    >
      <Show when={props.eyebrow}>
        <span
          style={{
            color: 'var(--a0)',
            'font-family': 'rajdhani, body',
            'font-size': mobile() ? '12px' : '15px',
            'letter-spacing': '0.08em',
            'text-transform': 'uppercase',
          }}
        >
          {props.eyebrow}
        </span>
      </Show>
      <h2
        style={{
          color: 'var(--c1)',
          'font-family': 'display',
          'font-size': mobile() ? '30px' : '42px',
          'font-weight': '410',
          'letter-spacing': '-0.015em',
          'line-height': 1.1,
          margin: 0,
          'text-wrap': 'balance',
        }}
      >
        {props.title}
      </h2>
      <Show when={props.children}>
        <p
          style={{
            ...bodyStyle(),
            'max-width': '620px',
            'text-wrap': 'balance',
          }}
        >
          {props.children}
        </p>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison-table marks and cells
// ---------------------------------------------------------------------------

type Cell = boolean | 'partial' | string;

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
  return (
    <div
      style={{
        'align-items': 'center',
        display: 'flex',
        'justify-content': 'center',
        'min-height': '22px',
        'text-align': 'center',
      }}
    >
      <Show
        when={typeof props.value === 'string'}
        fallback={
          <Show when={props.value === true} fallback={<CrossMark />}>
            <CheckMark />
          </Show>
        }
      >
        <span
          style={{
            color: props.macro ? 'var(--a0)' : 'var(--c2)',
            'font-family': "'cyberreader', body",
            'font-size': mobile() ? '10px' : '11px',
            'font-weight': '400',
            'letter-spacing': '0.02em',
            'line-height': 1.25,
          }}
        >
          {props.value as string}
        </span>
      </Show>
    </div>
  );
}

const compareHeaderStyle = (macro: boolean): JSX.CSSProperties => ({
  'align-items': 'center',
  'background-color': 'transparent',
  color: macro ? 'var(--a0)' : 'var(--c2)',
  display: 'flex',
  'font-family': "'cyberreader', body",
  'font-size': mobile() ? '9px' : '11px',
  'font-weight': '400',
  'justify-content': 'center',
  'letter-spacing': '0.04em',
  'line-height': 1.1,
  padding: mobile() ? '10px 6px' : '12px 12px',
  'text-align': 'center',
  'text-transform': macro ? 'uppercase' : 'none',
});

const compareRowBg = (rowIndex: number) =>
  rowIndex % 2 === 1
    ? 'color-mix(in srgb, var(--c4) 4%, var(--b0))'
    : 'var(--b0)';

function CompareHeaderLabel(props: { label: string; macro: boolean }) {
  return (
    <span
      style={{
        'align-items': 'center',
        display: 'inline-flex',
        'flex-direction': 'column',
        gap: mobile() ? '5px' : '7px',
      }}
    >
      <Show when={props.macro}>
        <MacroMarkIcon
          style={{
            color: 'var(--a0)',
            display: 'block',
            fill: 'currentColor',
            flex: 'none',
            height: mobile() ? '13px' : '15px',
            overflow: 'visible',
            stroke: 'none',
          }}
        />
      </Show>
      <span>{props.label}</span>
    </span>
  );
}

type ComparisonRow = { feature: string; macro: Cell; them: Cell };

/** The per-tool table, Macro first. Rows mirror the docs switching guide. */
function SwitchTable(props: {
  brand: SwitchBrand;
  competitor: string;
  rows: ComparisonRow[];
}) {
  return (
    <ComparisonTable
      columns={[
        { label: 'Macro', macro: true },
        {
          label: props.competitor,
          icon: (
            <SwitchBrandIcon brand={props.brand} size={mobile() ? 13 : 15} />
          ),
        },
      ]}
      rows={props.rows.map((row) => ({
        feature: row.feature,
        cells: [row.macro, row.them],
      }))}
      mobileCellWidth={72}
      mobileMinWidth={400}
      sortRows={false}
      valueWrap="normal"
    />
  );
}

// ---------------------------------------------------------------------------
// Per-tool migration sections
// ---------------------------------------------------------------------------

/*
 * Copy is held as thunks rather than JSX values. These sections live at module
 * scope, and module-scope JSX is evaluated at import time before any Route
 * context exists. That makes <A> throw during prerendering.
 */
type ToolSection = {
  brand: SwitchBrand;
  title: string;
  /** What changes, and why it's an upgrade. Kept to two paragraphs. */
  body: (() => JSX.Element)[];
  rows: ComparisonRow[];
  steps: (() => JSX.Element)[];
  /** Trailing note after the steps, usually "you can keep it connected". */
  note?: () => JSX.Element;
  links: { label: string; href: string }[];
  docsAnchor: string;
};

const TOOL_SECTIONS: ToolSection[] = [
  {
    brand: 'superhuman',
    title: 'Macro vs. Superhuman',
    body: [
      () => (
        <>
          Macro Mail keeps Superhuman's keyboard-first speed, but adds
          Outlook-style multitasking and Gmail's simplicity.
        </>
      ),
      () => (
        <>
          Macro Mail brings your email into its own database, so search and AI
          context are not bottlenecked by Gmail's API or MCP. Signal vs. Noise
          helps you triage, and you can easily link an email thread to your team
          without resorting to screenshots or copy/paste. AI agents can perform
          actions like drafting, triaging, and sending, so you spend less time
          in your inbox.
        </>
      ),
    ],
    rows: [
      { feature: 'Built on Gmail (no migration)', macro: true, them: true },
      { feature: 'j / k / e triage shortcuts', macro: true, them: true },
      {
        feature: 'Multiple accounts in one unified inbox',
        macro: true,
        them: false,
      },
      { feature: 'AI triage / split inbox', macro: true, them: true },
      {
        feature: 'Shared email comments and @mentions',
        macro: true,
        them: true,
      },
      {
        feature: 'Email, tasks, and chat in one inbox',
        macro: true,
        them: false,
      },
      {
        feature: 'Agents that draft, triage, and send',
        macro: true,
        them: 'partial',
      },
    ],
    steps: [
      () => (
        <>
          Connect your Gmail or Google Workspace account during signup or later
          in <SettingsPath>Settings</SettingsPath>.
        </>
      ),
      () => (
        <>
          Your mail, labels, and history appear automatically because Macro
          syncs with Gmail.
        </>
      ),
    ],
    note: () => (
      <>
        Both apps use Gmail, so there is nothing to migrate or undo. Use them
        side by side for as long as you need.
      </>
    ),
    links: [
      { label: 'Macro vs Superhuman', href: '/posts/superhuman-alternative' },
      { label: 'Macro Mail', href: '/email' },
    ],
    docsAnchor: '#from-superhuman',
  },
  {
    brand: 'notion',
    title: 'Macro vs. Notion',
    body: [
      () => (
        <>
          Macro pairs Notion-style @mentions with markdown-first docs, but it
          treats tasks, CRM, email, and channels as dedicated modules rather
          than pages and databases you have to configure.
        </>
      ),
      () => (
        <>
          Macro Docs use a CRDT representation, so people and agents can edit
          live or offline without conflicts or data loss. When you reconnect,
          changes sync to the database and to your peers automatically. Macro
          Docs are fast, stable, and designed for live collaboration with
          teammates and agents.
        </>
      ),
    ],
    rows: [
      { feature: 'Markdown-first documents', macro: true, them: 'partial' },
      { feature: 'Offline-capable editing', macro: true, them: 'partial' },
      { feature: 'Tasks', macro: true, them: 'partial' },
      { feature: 'CRM', macro: true, them: 'partial' },
      { feature: 'Email client', macro: true, them: true },
      { feature: 'Team chat / channels', macro: true, them: false },
      {
        feature: 'Agent actions across docs, tasks, email, chat, and calls',
        macro: true,
        them: 'partial',
      },
    ],
    steps: [
      () => (
        <>
          Go to <SettingsPath>Settings → Connectors</SettingsPath> and connect
          Notion.
        </>
      ),
      () => (
        <>
          Open an agent chat (<Key>c</Key> then <Key>a</Key>) and ask it to
          import:
          <div style={{ 'margin-top': '12px' }}>
            <PromptBlock>
              {
                'Import my Notion docs from the "Engineering" workspace as Macro docs.\nKeep the folder structure and skip anything archived.'
              }
            </PromptBlock>
          </div>
        </>
      ),
      () => (
        <>
          For each Notion database, choose the closest fit: tasks, CRM records,
          or a doc with properties. Then ask the agent to import it and populate
          the corresponding Macro entities.
        </>
      ),
    ],
    note: () => (
      <>
        Keep Notion connected so agents can search old content. Move only what
        your team still uses.
      </>
    ),
    links: [
      { label: 'Macro vs Notion', href: '/posts/notion-alternative' },
      { label: 'Macro Docs', href: '/documents' },
    ],
    docsAnchor: '#from-notion',
  },
  {
    brand: 'slack',
    title: 'Macro vs. Slack',
    body: [
      () => (
        <>
          Macro gives channels an inbox, sorted into Signal and Noise. You can
          respond to messages based on urgency, or leave them for later, instead
          of relying on read and unread.
        </>
      ),
      () => (
        <>
          Macro Chat is integrated with the rest of your workspace. @mention a
          doc, task, or email and it is shared with the channel automatically.
          Create a task from a message with one click. Smart filtering, inline
          threads, and a shared inbox make communication with your team more
          focused, and less noisy.
        </>
      ),
    ],
    rows: [
      { feature: 'Channels, threads, emoji', macro: true, them: true },
      {
        feature: 'Inline thread replies (forum-style reading)',
        macro: true,
        them: false,
      },
      { feature: 'One inbox shared with your email', macro: true, them: false },
      {
        feature: '@mention a doc or task to share it automatically',
        macro: true,
        them: false,
      },
      { feature: 'Video calls / huddles', macro: true, them: true },
    ],
    steps: [
      () => (
        <>
          Create a channel per team or project (<Key>c</Key> then <Key>m</Key>).
        </>
      ),
      () => (
        <>
          Add people by email. They don't need a Macro account yet to be
          included.
        </>
      ),
      () => <>Use @mentions to share docs and tasks as you discuss them.</>,
    ],
    note: () => (
      <>
        Connect Slack under <SettingsPath>Settings → Connectors</SettingsPath>{' '}
        so agents can search it. You can keep Slack for external channels while
        your team moves internal work to Macro.
      </>
    ),
    links: [
      { label: 'Macro vs Slack', href: '/posts/slack-alternative' },
      { label: 'Macro Chat', href: '/channels' },
    ],
    docsAnchor: '#from-slack',
  },
  {
    brand: 'linear',
    title: 'Macro vs. Linear',
    body: [
      () => (
        <>
          Macro Tasks are inspired by Linear. They keep the status, priority,
          assignee, keyboard shortcuts, and GitHub workflow you know, while
          staying simple to create, assign, prioritize, and close out.
        </>
      ),
      () => (
        <>
          Create a task from an email or channel message and it links to its
          source bi-directionally. For programming work, tasks also stay linked
          to GitHub pull requests and update automatically. Agents create tasks,
          de-duplicate them, update them, and close them out as work progresses.
        </>
      ),
    ],
    rows: [
      {
        feature: 'Status, priority, assignee, keyboard-first',
        macro: true,
        them: true,
      },
      {
        feature: 'GitHub: branch, PR, and merge move the task',
        macro: true,
        them: true,
      },
      {
        feature: 'Tasks in the same app as email, channels, and docs',
        macro: true,
        them: false,
      },
      {
        feature: 'Turn an email or channel message into a task in one click',
        macro: true,
        them: 'partial',
      },
      {
        feature: 'Non-engineers see engineering work',
        macro: true,
        them: true,
      },
    ],
    steps: [
      () => (
        <>
          Connect Linear under{' '}
          <SettingsPath>Settings → Connectors</SettingsPath>. The MCP connector
          lets Macro agents read your Linear workspace while you move work over.
        </>
      ),
      () => (
        <>
          Open an agent chat (<Key>c</Key> then <Key>a</Key>) and ask it to
          populate Macro Tasks from your open Linear issues:
          <div style={{ 'margin-top': '12px' }}>
            <PromptBlock>
              {
                'Import my open Linear issues as Macro tasks.\nPreserve the title, status, priority, assignee, due date, and linked GitHub work.\nSkip completed and canceled issues.'
              }
            </PromptBlock>
          </div>
        </>
      ),
    ],
    note: () => (
      <>
        Keep Linear connected over MCP during the rollout so agents can still
        search the issue history your team has not moved.
      </>
    ),
    links: [
      { label: 'Macro vs Linear', href: '/posts/linear-alternative' },
      { label: 'Macro Tasks', href: '/tasks' },
    ],
    docsAnchor: '#from-linear',
  },
  {
    brand: 'clickup',
    title: 'Macro vs. ClickUp',
    body: [
      () => (
        <>
          Macro is open source under the AGPLv3, so your team can inspect,
          extend, fork, and self-host the workspace. Macro gives you a dedicated
          CRM alongside agents, tasks, docs, channels, and email.
        </>
      ),
      () => (
        <>
          Macro treats email as a core workspace experience, with every account
          in one inbox alongside tasks and channels. Macro Docs also support
          collaborative offline editing, so the work keeps moving when your
          connection drops.
        </>
      ),
    ],
    rows: [
      { feature: 'Open source and self-hostable', macro: true, them: false },
      { feature: 'Tasks, docs, chat', macro: true, them: true },
      {
        feature: 'Email client with all accounts in one unified inbox',
        macro: true,
        them: false,
      },
      {
        feature: 'Offline document editing with automatic sync',
        macro: true,
        them: false,
      },
      { feature: 'Dedicated CRM module', macro: true, them: 'partial' },
      {
        feature: 'GitHub branch, PR, and merge move the task',
        macro: true,
        them: 'partial',
      },
      {
        feature:
          'Agents with context from email, chat, docs, tasks, calls, and CRM',
        macro: true,
        them: 'partial',
      },
    ],
    steps: [
      () => (
        <>
          Recreate your active lists as Macro tasks. Most teams skip closed
          work.
        </>
      ),
      () => (
        <>
          For history or a gradual cutover, connect ClickUp under{' '}
          <SettingsPath>Settings → Connectors</SettingsPath> and ask an agent to
          bring the open tasks across.
        </>
      ),
      () => (
        <>
          An agent can also recreate your ClickUp Docs as Macro documents:
          <div style={{ 'margin-top': '12px' }}>
            <PromptBlock>
              {
                'Import my ClickUp Docs from the "Engineering" space as Macro docs.\nKeep the folder structure and skip anything archived.'
              }
            </PromptBlock>
          </div>
        </>
      ),
    ],
    links: [
      { label: 'Macro vs ClickUp', href: '/posts/clickup-alternative' },
      { label: 'Macro Tasks', href: '/tasks' },
    ],
    docsAnchor: '#from-clickup',
  },
];

function ToolLinks(props: { section: ToolSection }) {
  return (
    <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '10px' }}>
      <For each={props.section.links}>
        {(link) => (
          <A href={link.href} class="migrate-pill" style={pillStyle()}>
            {link.label} <span aria-hidden="true">→</span>
          </A>
        )}
      </For>
      <a
        href={`${DOCS_SWITCH}${props.section.docsAnchor}`}
        target="_blank"
        rel="noreferrer"
        class="migrate-pill"
        style={pillStyle()}
      >
        Migration steps <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}

function ComparisonBrandLockup(props: { brand: SwitchBrand }) {
  return (
    <div
      aria-label={`Macro versus ${SWITCH_LABELS[props.brand]}`}
      role="img"
      style={{
        'align-items': 'center',
        color: 'var(--c2)',
        display: 'flex',
        'flex-shrink': '0',
        gap: comparisonMobile() ? '7px' : '10px',
      }}
    >
      <MacroMarkIcon
        aria-hidden="true"
        style={{
          color: 'var(--a0)',
          display: 'block',
          fill: 'currentColor',
          height: comparisonMobile() ? '20px' : '26px',
          overflow: 'visible',
          stroke: 'none',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          color: 'color-mix(in srgb, var(--c4) 42%, transparent)',
          'font-family': 'display',
          'font-size': comparisonMobile() ? '32px' : '42px',
          'font-weight': '300',
          'line-height': 0.65,
          transform: 'translateY(-5px) scaleY(1.5)',
        }}
      >
        /
      </span>
      <SwitchBrandIcon
        brand={props.brand}
        size={comparisonMobile() ? 21 : 28}
      />
    </div>
  );
}

function ComparisonGutterFiducials() {
  const stroke = '1px solid color-mix(in srgb, var(--c4) 42%, transparent)';

  return (
    <div
      aria-hidden="true"
      style={{
        display: comparisonMobile() ? 'none' : 'block',
        height: '76px',
        left: '-170px',
        'pointer-events': 'none',
        position: 'absolute',
        top: '-16px',
        width: '142px',
      }}
    >
      <span
        style={{
          'border-left': stroke,
          'border-top': stroke,
          height: '11px',
          left: 0,
          position: 'absolute',
          top: 0,
          width: '11px',
        }}
      />
      <span
        style={{
          'border-right': stroke,
          'border-top': stroke,
          height: '11px',
          position: 'absolute',
          right: 0,
          top: 0,
          width: '11px',
        }}
      />
      <span
        style={{
          'border-bottom': stroke,
          'border-left': stroke,
          bottom: 0,
          height: '11px',
          left: 0,
          position: 'absolute',
          width: '11px',
        }}
      />
      <span
        style={{
          'border-bottom': stroke,
          'border-right': stroke,
          bottom: 0,
          height: '11px',
          position: 'absolute',
          right: 0,
          width: '11px',
        }}
      />
    </div>
  );
}

function ComparisonGutterLabel(props: { index: string; label: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        color: 'color-mix(in srgb, var(--c4) 68%, transparent)',
        display: comparisonMobile() ? 'none' : 'flex',
        'font-family': 'rajdhani, body',
        'font-size': '10px',
        'font-weight': '700',
        gap: '6px',
        'justify-content': 'flex-start',
        left: '-170px',
        'letter-spacing': '0.1em',
        'line-height': 1,
        'pointer-events': 'none',
        position: 'absolute',
        'text-align': 'left',
        top: '3px',
        'white-space': 'nowrap',
        width: '142px',
      }}
    >
      <span
        style={{ background: 'currentColor', height: '1px', width: '12px' }}
      />
      <span>{props.index}</span>
      <span>{props.label}</span>
    </span>
  );
}

function ToolSectionBlock(props: { section: ToolSection }) {
  return (
    <div
      aria-label={props.section.title}
      style={{
        ...columnStyle(),
        margin: '0 auto',
        padding: comparisonMobile() ? '28px 20px 32px' : '44px 52px 52px',
      }}
    >
      <div style={{ position: 'relative', 'text-align': 'left' }}>
        <ComparisonGutterFiducials />
        <div
          style={{
            'align-items': 'center',
            display: comparisonMobile() ? 'block' : 'flex',
            height: comparisonMobile() ? 'auto' : '76px',
            'justify-content': 'center',
            'margin-bottom': comparisonMobile() ? '16px' : 0,
            position: comparisonMobile() ? 'static' : 'absolute',
            left: '-170px',
            top: '-16px',
            width: comparisonMobile() ? 'auto' : '142px',
          }}
        >
          <ComparisonBrandLockup brand={props.section.brand} />
        </div>
        <div
          style={{
            display: 'grid',
            gap: comparisonMobile() ? '20px' : '24px',
            'text-align': 'left',
          }}
        >
          <h3
            style={{
              color: 'var(--c1)',
              'font-family': 'display',
              'font-size': comparisonMobile() ? '26px' : '32px',
              'font-weight': '420',
              'letter-spacing': '-0.015em',
              'line-height': 1.12,
              margin: 0,
            }}
          >
            {props.section.title}
          </h3>
          <div
            style={{
              display: 'grid',
              gap: comparisonMobile() ? '10px' : '12px',
            }}
          >
            <For each={props.section.body}>
              {(paragraph) => (
                <p style={comparisonBodyStyle()}>{paragraph()}</p>
              )}
            </For>
          </div>
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <ComparisonGutterLabel index="01" label="COMPARE" />
        <SwitchTable
          brand={props.section.brand}
          competitor={SWITCH_LABELS[props.section.brand]}
          rows={props.section.rows}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gap: comparisonMobile() ? '18px' : '22px',
          position: 'relative',
        }}
      >
        <ComparisonGutterLabel index="02" label="SWITCH" />
        <h4
          style={{
            color: 'var(--a0)',
            'font-family': 'rajdhani, body',
            'font-size': comparisonMobile() ? '13px' : '15px',
            'font-weight': '700',
            'letter-spacing': '0.1em',
            margin: 0,
            'text-transform': 'uppercase',
          }}
        >
          To switch
        </h4>
        <div
          style={{ display: 'grid', gap: comparisonMobile() ? '10px' : '12px' }}
        >
          <Steps items={props.section.steps} />
          <Show when={props.section.note}>
            {(note) => <p style={comparisonBodyStyle()}>{note()()}</p>}
          </Show>
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <ComparisonGutterLabel index="03" label="MORE INFO" />
        <ToolLinks section={props.section} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Macro vs. the world
// ---------------------------------------------------------------------------

const WORLD_COLUMNS = [
  'Macro',
  'Superhuman',
  'Notion',
  'Slack',
  'Linear',
  'ClickUp',
];

type WorldRow = {
  feature: string;
  href: string;
  external?: boolean;
  cells: [Cell, Cell, Cell, Cell, Cell, Cell];
};

const WORLD_ROWS: WorldRow[] = [
  {
    feature: 'Email',
    href: '/email',
    cells: [true, true, false, false, false, false],
  },
  {
    feature: 'Channels',
    href: '/channels',
    cells: [true, false, false, true, false, true],
  },
  {
    feature: 'Tasks',
    href: '/tasks',
    cells: [true, false, 'Via databases', false, true, true],
  },
  {
    feature: 'Docs',
    href: '/documents',
    cells: [true, false, true, false, false, true],
  },
  {
    feature: 'CRM',
    href: '/crm',
    cells: [true, false, 'Via databases', false, false, 'Via setup'],
  },
  {
    feature: 'File storage',
    href: `${DOCS}/product/folders`,
    external: true,
    cells: [true, false, 'Attachments', 'Attachments', false, 'Attachments'],
  },
  {
    feature: 'Calls',
    href: '/calls',
    cells: [true, false, false, 'Huddles', false, false],
  },
  {
    feature: 'Agents',
    href: '/agents',
    cells: [true, false, true, false, true, true],
  },
  {
    feature: 'Unified inbox',
    href: `${DOCS}/product/inbox`,
    external: true,
    cells: [true, false, false, false, false, false],
  },
  {
    feature: 'Unified search',
    href: `${DOCS}/product/search`,
    external: true,
    cells: [true, false, false, false, false, false],
  },
  {
    feature: 'Unified memory',
    href: `${DOCS}/product/unified-memory`,
    external: true,
    cells: [true, false, false, false, false, false],
  },
];

function WorldTable() {
  const gridTemplate = () =>
    mobile()
      ? 'minmax(120px, 1.2fr) repeat(6, minmax(58px, 1fr))'
      : 'minmax(0, 1.8fr) repeat(6, minmax(0, 1fr))';

  return (
    <div
      class="migrate-world-table-scroll"
      style={{
        '-webkit-overflow-scrolling': 'touch',
        'max-width': '100%',
        'min-width': '0',
        'overflow-x': 'auto',
        width: '100%',
      }}
    >
      <div
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          'font-family': "'cyberreader', body",
          'grid-template-columns': gridTemplate(),
          'min-width': mobile() ? '640px' : '760px',
          overflow: 'hidden',
        }}
      >
        {/* Empty top-left cell with the notched frame used on /email. */}
        <div
          style={{
            'background-color': 'transparent',
            'border-bottom': '1px solid var(--b2)',
          }}
        />
        <For each={WORLD_COLUMNS}>
          {(col, index) => (
            <div
              style={{
                ...compareHeaderStyle(index() === 0),
                'border-top': '1px solid var(--b2)',
                'border-bottom': '1px solid var(--b2)',
                'border-left': '1px solid var(--b2)',
                'border-right':
                  index() === WORLD_COLUMNS.length - 1
                    ? '1px solid var(--b2)'
                    : '0',
                padding: mobile() ? '10px 4px' : '12px 8px',
              }}
            >
              <CompareHeaderLabel label={col} macro={index() === 0} />
            </div>
          )}
        </For>

        <For each={WORLD_ROWS}>
          {(row, rowIndex) => (
            <>
              <div
                style={{
                  'align-items': 'center',
                  'background-color': compareRowBg(rowIndex()),
                  'border-bottom': '1px solid var(--b2)',
                  'border-left': '1px solid var(--b2)',
                  color: 'var(--c2)',
                  display: 'flex',
                  'font-size': mobile() ? '10px' : '12px',
                  left: mobile() ? '0' : 'auto',
                  'line-height': 1.25,
                  padding: mobile() ? '9px 10px' : '10px 20px',
                  position: mobile() ? 'sticky' : 'static',
                  'z-index': mobile() ? 1 : 'auto',
                }}
              >
                <InlineLink href={row.href} external={row.external}>
                  {row.feature}
                </InlineLink>
              </div>
              <For each={row.cells}>
                {(cell, cellIndex) => (
                  <div
                    style={{
                      'align-items': 'center',
                      'background-color': compareRowBg(rowIndex()),
                      'border-bottom': '1px solid var(--b2)',
                      'border-left': '1px solid var(--b2)',
                      'border-right':
                        cellIndex() === row.cells.length - 1
                          ? '1px solid var(--b2)'
                          : '0',
                      display: 'flex',
                      'justify-content': 'center',
                      padding: mobile() ? '9px 4px' : '10px 8px',
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
// Desync case study — wide video + Mark quote as figcaption
// ---------------------------------------------------------------------------

function DesyncCaseStudy() {
  let videoRef!: HTMLVideoElement;
  const [playing, setPlaying] = createSignal(false);

  function handlePlay() {
    videoRef
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }

  return (
    <section
      aria-label="Desync case study"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        'padding-block': mobile() ? '36px 48px' : '72px',
        'padding-inline': mobile() ? '18px' : '24px',
        position: 'relative',
        width: '100%',
        'z-index': 0,
      }}
    >
      {/* Background matching the Case studies section on the /tasks page */}
      <div
        aria-hidden="true"
        style={{
          'background-color': 'var(--b0)',
          'background-image':
            'linear-gradient(to bottom, color-mix(in srgb, var(--c1) 16%, transparent) 0, transparent 1px), ' +
            'radial-gradient(70% 22% at 50% 0%, color-mix(in srgb, var(--ambient-ink) 7%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 1.6%, transparent) 60%, transparent 100%)',
          bottom: 0,
          left: '50%',
          'margin-left': '-50%',
          'pointer-events': 'none',
          position: 'absolute',
          top: 0,
          width: '100%',
          'z-index': -1,
        }}
      />

      <div
        style={{
          display: 'grid',
          'justify-items': 'center',
          position: 'relative',
          width: '100%',
          'z-index': 1,
        }}
      >
        <div
          class="migrate-case-video"
          style={{ cursor: playing() ? 'default' : 'pointer' }}
          onClick={() => {
            if (!playing()) handlePlay();
          }}
        >
          <video
            ref={videoRef}
            controls={playing()}
            onEnded={() => setPlaying(false)}
            onError={() => setPlaying(false)}
            playsinline
            poster={markDesyncPlaceholder}
            preload="metadata"
            src={desyncVideoUrl}
            style={{ 'object-fit': playing() ? 'contain' : 'cover' }}
          />
          <Show when={!playing()}>
            <img
              src={markDesyncPlaceholder}
              loading="lazy"
              alt=""
              aria-hidden="true"
              class="migrate-case-poster"
            />
            <div class="migrate-case-scrim" aria-hidden="true" />
            <div class="migrate-case-heading">
              <h2 class="migrate-case-title">Case study</h2>
              <p class="migrate-case-subtitle">A startup switches to Macro</p>
            </div>
            <aside
              class="migrate-case-quote"
              aria-label="Quote from Mark Evgenev"
            >
              <div class="migrate-case-quote-author">
                <img src={markAvatar} alt="" aria-hidden="true" />
                <span>
                  <strong>Mark Evgenev</strong>
                  <small>Founder/CEO, Desync</small>
                </span>
              </div>
              <blockquote>
                &ldquo;Macro did not help us get organized. Macro is why we are
                organized.&rdquo;
              </blockquote>
            </aside>
            <div class="migrate-case-play" aria-hidden="true">
              <svg
                width={mobile() ? '42' : '48'}
                height={mobile() ? '42' : '48'}
                viewBox="0 0 48 48"
              >
                <circle
                  cx="24"
                  cy="24"
                  r="21"
                  fill="none"
                  stroke="var(--c1)"
                  stroke-width="2"
                />
                <path d="M20.5 16.5 L20.5 31.5 L32.5 24 Z" fill="var(--c1)" />
              </svg>
              <span>Watch case study</span>
              <span class="migrate-case-play-rule" />
            </div>
          </Show>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const RouteMigrate: Component = () => {
  setPageSeo({
    title: 'Switch your startup to Macro | Migration guide',
    description:
      'Move your team to Macro from Superhuman, Notion, Slack, Linear, or ClickUp. Learn what to import, what to connect, and how to switch.',
    path: '/migrate',
  });
  const comparisonTabs = TOOL_SECTIONS.map((section) => ({
    id: section.brand,
    icon: <SwitchBrandIcon brand={section.brand} size={15} />,
    label: SWITCH_LABELS[section.brand],
    content: <ToolSectionBlock section={section} />,
  }));

  return (
    <div
      lang="en"
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '0',
        'grid-template-columns': 'minmax(0, 1fr)',
        'padding-bottom': mobile() ? '48px' : '64px',
        width: '100%',
      }}
    >
      <style>{`
        @media (hover) {
          .migrate-cta-button:hover { transform: scale(1.02); }
          .migrate-link:hover { text-decoration: underline; }
          .migrate-pill:hover { background-color: color-mix(in srgb, var(--a0) 12%, var(--b1)); color: var(--a0); }
        }
        .migrate-hero-graphic, .migrate-module-graphic { display: block; height: auto; width: 100%; }
        .migrate-world-table-scroll,
        .comparison-table-scroll {
          scrollbar-color: var(--a0) transparent;
          scrollbar-width: thin;
        }
        .migrate-world-table-scroll::-webkit-scrollbar,
        .comparison-table-scroll::-webkit-scrollbar {
          height: 4px;
        }
        .migrate-world-table-scroll::-webkit-scrollbar-track,
        .comparison-table-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .migrate-world-table-scroll::-webkit-scrollbar-thumb,
        .comparison-table-scroll::-webkit-scrollbar-thumb {
          background: var(--a0);
          border-radius: 999px;
        }

        /* Greys throughout this page's plate chrome are mixed from --c4 (ink), not
           taken off the --b* scale: that scale is not ordered by lightness in
           every theme — under Macro, --b3 sits at 0.10 against a 0.14 background,
           i.e. darker than the surface it's drawn on, which reads as black. Mixing
           ink toward transparent always lands between the text and the
           background, whichever way the theme runs. */

        /* The wash band spans the graphic card and the testimonials and ends with
           them, so the case study video below sits on plain background — that
           hard stop is the divide between the two.

           It rides as a background *image*, which paints behind every child, so
           there's no stacking or pointer-events juggling over a scene that has to
           stay clickable. Strongest at the bottom edge, carrying up through the
           testimonials to light them, and all but gone about a quarter of the way
           up the card.

           The stops are percentages of this band, so they depend on the two
           blocks' proportion. Measured at desktop width: band 1222px, card 956px,
           so the testimonials are the bottom ~22% and a quarter of the way up the
           card lands at ~41%. Hence 22% is still clearly lit — that is the card's
           lower edge — and 41% is where it goes very faint. Retune if either
           block's height changes much; they are easy to get wrong by eye,
           since a stop that is a little low reads as the wash not reaching the
           card at all. */
        .migrate-washband {
          display: grid;
          justify-items: center;
          position: relative;
          width: 100%;
        }
        /* Keep the wash within the centered page column. */
        .migrate-washband::before {
          background-image: linear-gradient(
            to top,
            color-mix(in srgb, var(--c4) 3.5%, transparent) 0%,
            color-mix(in srgb, var(--c4) 2.8%, transparent) 12%,
            color-mix(in srgb, var(--c4) 1.8%, transparent) 22%,
            color-mix(in srgb, var(--c4) 0.4%, transparent) 41%,
            transparent 58%
          );
          content: '';
          inset-block: 0;
          left: 50%;
          pointer-events: none;
          position: absolute;
          transform: translateX(-50%);
          width: 100%;
          z-index: 0;
        }
        /* The wash is a positioned sibling, so it would otherwise paint over the
           in-flow card and quotes. Lift them above it rather than pushing it to
           a negative z-index, which would drop it behind the section backdrop. */
        .migrate-washband > * {
          position: relative;
          z-index: 1;
        }

        /* An unframed illustration lets the migration scene float over the wash
           and gives it more room than the former technical-card treatment. */
        .migrate-graphic-card {
          box-sizing: border-box;
          margin-bottom: 56px;
          max-width: 840px;
          padding-top: 38px;
          position: relative;
          width: 100%;
        }

        /* Keep the illustration close to the 760px intro copy column. */
        .migrate-figure {
          max-width: 840px;
          position: relative;
          width: 100%;
        }
        .migrate-hero-graphic {
          /* Transforms don't affect layout; matching the upward lift here makes
             the CTA overlap the illustration at its visual midpoint. */
          margin-bottom: -60px;
          transform: translate(46px, -60px);
        }

        @media (max-width: 700px) {
          .migrate-graphic-card { margin-bottom: 28px; padding-top: 32px; }
          .migrate-hero-graphic { transform: translateY(-60px); }
        }
        /* Desync case study — same breakout pattern as .mvn-video on the
           versus posts, but wider so it reads as a hero media beat. */
        .migrate-case-title {
          color: var(--c1);
          font-family: display, serif;
          font-size: 32px;
          font-weight: 400;
          letter-spacing: -0.025em;
          line-height: 1.1;
          margin: 0 0 6px;
          text-align: left;
          text-wrap: balance;
        }
        .migrate-case-subtitle {
          color: var(--c4);
          font-family: cyberreader, body;
          font-size: 16px;
          line-height: 1.45;
          margin: 0 0 20px;
          text-align: left;
        }
        .migrate-case-video {
          aspect-ratio: 16 / 9;
          background: var(--b1);
          border: 1px solid color-mix(in srgb, var(--c1) 12%, transparent);
          border-radius: 18px;
          box-shadow: 0 28px 64px -22px rgb(0 0 0 / 0.66), 0 8px 24px -12px rgb(0 0 0 / 0.5);
          margin: 0 0 18px;
          max-width: 1120px;
          overflow: hidden;
          position: relative;
          width: 100%;
        }
        @media (max-width: 699px) {
          .migrate-case-video {
            border-radius: 14px;
          }
        }
        .migrate-case-video video {
          background: var(--b1);
          border: 0;
          display: block;
          height: calc(100% + 2px);
          left: -1px;
          object-fit: cover;
          position: absolute;
          top: -1px;
          width: calc(100% + 2px);
        }
        .migrate-case-poster {
          display: block;
          filter: brightness(0.9);
          height: calc(100% + 2px);
          left: -1px;
          object-fit: cover;
          object-position: center center;
          pointer-events: none;
          position: absolute;
          top: -1px;
          width: calc(100% + 2px);
        }
        .migrate-case-scrim {
          background: linear-gradient(0deg, oklch(from var(--b0) l c h / 0.78), oklch(from var(--b0) l c h / 0.12) 52%, transparent 78%);
          inset: 0;
          pointer-events: none;
          position: absolute;
          z-index: 1;
        }
        .migrate-case-heading {
          left: 28px;
          pointer-events: none;
          position: absolute;
          top: 28px;
          z-index: 2;
        }
        .migrate-case-quote {
          backdrop-filter: blur(22px) saturate(150%);
          -webkit-backdrop-filter: blur(22px) saturate(150%);
          background:
            linear-gradient(
              135deg,
              color-mix(in srgb, var(--c1) 16%, transparent) 0%,
              color-mix(in srgb, var(--b0) 66%, transparent) 42%,
              color-mix(in srgb, var(--c1) 5%, transparent) 100%
            );
          border: 1px solid color-mix(in srgb, var(--c1) 20%, transparent);
          border-radius: 12px;
          box-shadow:
            0 18px 42px rgb(0 0 0 / 0.3);
          box-sizing: border-box;
          display: grid;
          gap: 14px;
          margin: 0;
          max-width: 340px;
          padding: 16px;
          pointer-events: none;
          position: absolute;
          right: 28px;
          top: 28px;
          overflow: hidden;
          z-index: 2;
        }
        .migrate-case-quote::before {
          background: radial-gradient(ellipse at center, color-mix(in srgb, var(--ambient-ink) 24%, transparent), transparent 68%);
          content: '';
          height: 90px;
          left: -40px;
          opacity: 0.8;
          pointer-events: none;
          position: absolute;
          top: -48px;
          transform: rotate(-12deg);
          width: 230px;
        }
        .migrate-case-quote > * {
          position: relative;
          z-index: 1;
        }
        .migrate-case-quote blockquote {
          color: var(--c1);
          font-family: cyberreader, body;
          font-size: 15px;
          font-weight: 420;
          letter-spacing: -0.012em;
          line-height: 1.4;
          margin: 0;
        }
        .migrate-case-quote-author {
          align-items: center;
          display: flex;
          gap: 10px;
        }
        .migrate-case-quote-author img {
          border-radius: 50%;
          height: 38px;
          object-fit: cover;
          width: 38px;
        }
        .migrate-case-quote-author span {
          display: grid;
          gap: 2px;
        }
        .migrate-case-quote-author strong {
          color: var(--c1);
          font-family: body, sans-serif;
          font-size: 14px;
          line-height: 1.15;
        }
        .migrate-case-quote-author small {
          color: var(--c4);
          font-family: body, sans-serif;
          font-size: 11px;
          line-height: 1.2;
        }
        .migrate-case-play {
          align-items: center;
          bottom: 28px;
          display: grid;
          gap: 14px;
          grid-template-columns: min-content min-content 1fr;
          left: 28px;
          pointer-events: none;
          position: absolute;
          right: 28px;
          z-index: 2;
        }
        .migrate-case-play span:not(.migrate-case-play-rule) {
          color: var(--c1);
          font-family: rajdhani, body;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.1em;
          line-height: 1;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .migrate-case-play-rule {
          background-color: var(--c1);
          height: 1px;
          margin-top: 1px;
          opacity: 0.8;
          width: 100%;
        }
        @media (max-width: 699px) {
          .migrate-case-video { aspect-ratio: 4 / 3; }
          .migrate-case-heading { left: 18px; top: 18px; }
          .migrate-case-title { font-size: 24px; }
          .migrate-case-subtitle { font-size: 14px; margin-bottom: 16px; }
          .migrate-case-quote { display: none; }
          .migrate-case-quote blockquote { font-size: 13px; line-height: 1.35; }
          .migrate-case-quote-author { gap: 8px; }
          .migrate-case-quote-author img { height: 32px; width: 32px; }
          .migrate-case-quote-author strong { font-size: 13px; }
          .migrate-case-quote-author small { display: none; }
          .migrate-case-play { bottom: 18px; gap: 12px; left: 18px; right: 18px; }
          .migrate-case-play span:not(.migrate-case-play-rule) { font-size: 13px; }
        }
      `}</style>

      {/* Hero */}
      <div
        style={{
          display: 'flow-root',
          'min-width': '0',
          position: 'relative',
          width: '100%',
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
            width: '100%',
            // Above the connector scene below, which is pulled up far enough to
            // overlap this section's lower edge. The scene is itself clickable
            // (and holds the import link), so without this it wins the hit test
            // in the overlap and swallows clicks meant for the CTAs.
            'z-index': 2,
          }}
        >
          <div
            style={{
              'box-sizing': 'border-box',
              display: 'grid',
              gap: mobile() ? '24px' : '28px',
              'justify-items': mobile() ? 'start' : 'center',
              'max-width': mobile() ? '100%' : '760px',
              'text-align': mobile() ? 'left' : 'center',
              width: '100%',
            }}
          >
            <h1
              style={{
                'font-family': 'display',
                'font-size': mobile() ? 'clamp(42px, 11.5vw, 58px)' : '52.36px',
                'font-weight': '380',
                'letter-spacing': '-0.012em',
                'line-height': 1.12,
                margin: '0',
              }}
            >
              Switch your startup to Macro
            </h1>
            <p
              style={{
                color: 'var(--c4)',
                'font-family': 'cyberreader, body',
                'font-size': mobile() ? '15px' : '18px',
                'font-weight': '400',
                'line-height': 1.55,
                margin: '0',
                'max-width': mobile() ? '36ch' : '760px',
                'text-wrap': 'pretty',
              }}
            >
              Move your team from Slack, Notion, Superhuman, Linear, or
              {'\u00A0'}ClickUp.
              <br />
              Keep the tools that still work and bring the rest into Macro.
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
              <ConnectGoogleButton buttonName="migrate_hero_connect_google" />
              <BookCallButton />
            </div>
          </div>
        </section>

        {/* The connector scene shows incoming tools linked to Macro.
            Click it to replay the slide. */}
        <div
          style={{
            'box-sizing': 'border-box',
            display: 'grid',
            'justify-items': 'center',
            'padding-block': mobile() ? '20px 0' : '28px 0',
            'padding-inline': mobile() ? '12px' : '24px',
            position: 'relative',
            width: '100%',
            'z-index': 1,
          }}
        >
          {/* The wash sits behind the card and the testimonials, and stops with
              them — the case study below gets none, which is what draws the line
              between the two. */}
          <div class="migrate-washband">
            <div class="migrate-graphic-card">
              <div class="migrate-figure">
                <SetupGraphic
                  class="migrate-hero-graphic"
                  importButton={{
                    href: ctaHref(),
                    onClick: (event) =>
                      handleCtaClick(event, 'migrate_hero_import'),
                    horizontalOffsetPx: mobile() ? 0 : -46,
                    verticalOffset: mobile() ? 180 : 0,
                  }}
                />
              </div>
            </div>
            <SectionHomeQuote variant="migrate" />
          </div>
          <DesyncCaseStudy />
        </div>
      </div>

      <SectionMigrateComparisons tabs={comparisonTabs} />

      <HomeSectionRule />

      {/* Keep other tools connected instead of migrating them. */}
      <section
        aria-label="Migrate incrementally or all at once"
        style={sectionShell()}
      >
        <div style={{ ...columnStyle(), 'justify-items': 'center' }}>
          <SectionHeading title="Migrate incrementally or all at once" />
          <div
            style={{
              display: 'grid',
              gap: mobile() ? '12px' : '24px',
              'grid-template-columns': mobile()
                ? 'repeat(3, minmax(0, 1fr))'
                : 'repeat(5, minmax(0, 1fr))',
              'justify-items': 'center',
              'max-width': '760px',
              width: '100%',
            }}
          >
            <For each={MODULE_ROW}>
              {(logo) => (
                <ModuleGraphic
                  logo={logo}
                  state="linked"
                  class="migrate-module-graphic"
                />
              )}
            </For>
          </div>
          <p
            style={{
              ...bodyStyle(),
              'max-width': '720px',
              'text-align': 'center',
              'text-wrap': 'balance',
            }}
          >
            Connect the tools you want to keep through MCP, then move the rest
            into Macro on your own timeline. Agents can search across both while
            your team makes the switch.
          </p>
        </div>
      </section>

      <HomeSectionRule />

      {/* The full side-by-side picture */}
      <section
        aria-label="Macro compared to the rest of the toolset"
        style={sectionShell()}
      >
        <div
          style={{
            display: 'grid',
            gap: mobile() ? '40px' : '56px',
            'justify-items': 'center',
            'max-width': '980px',
            'min-width': '0',
            width: '100%',
          }}
        >
          <SectionHeading
            eyebrow="The comparison"
            title="See what Macro replaces"
          >
            Compare Macro with the tools your team uses today.
          </SectionHeading>
          <WorldTable />
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
              <CheckMark /> Built in
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
                  'text-align': 'center',
                  'text-transform': 'uppercase',
                  width: '100%',
                }}
              >
                Scroll table sideways →
              </span>
            </Show>
          </div>
        </div>
      </section>

      <HomeSectionRule />

      {/* Final CTA */}
      <div
        style={{
          'padding-block': mobile() ? '80px' : '116px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <section
          aria-label="Get started"
          style={{
            'align-items': mobile() ? 'start' : 'center',
            display: 'grid',
            gap: mobile() ? '30px' : '38px',
            'justify-items': mobile() ? 'start' : 'center',
            'text-align': mobile() ? 'left' : 'center',
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: mobile() ? '16px' : '20px',
              'justify-items': mobile() ? 'start' : 'center',
              'max-width': '585px',
            }}
          >
            <h2
              style={{
                'font-family': 'display',
                'font-size': mobile() ? '36px' : '48px',
                'font-weight': '420',
                'letter-spacing': '-0.015em',
                'line-height': 1.08,
                margin: '0',
              }}
            >
              Want help switching?
            </h2>
            <p
              style={{
                color: 'var(--c4)',
                'font-family': 'cyberreader, body',
                'font-size': mobile() ? '17px' : '19px',
                'line-height': 1.55,
                margin: '0',
              }}
            >
              Connect Google in 30 seconds, or book a call and we will help your
              team move.
            </p>
          </div>
          <div
            style={{
              'align-items': 'center',
              display: 'flex',
              'flex-direction': mobile() ? 'column' : 'row',
              gap: mobile() ? '12px' : '14px',
              width: mobile() ? '100%' : 'auto',
            }}
          >
            <ConnectGoogleButton
              buttonName="migrate_final_connect_google"
              large
            />
            <BookCallButton large />
          </div>
        </section>
      </div>

      {/* Divider + footer */}
      <div
        style={{
          'padding-bottom': mobile() ? '40px' : '48px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <SectionMoreFeatures currentPath="/migrate" footerOnly />
      </div>
    </div>
  );
};
