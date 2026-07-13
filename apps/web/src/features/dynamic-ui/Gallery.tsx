import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import { ErrorBoundary, For, Suspense } from 'solid-js';
import type { View, Widget } from './schema';
import { Widget as WidgetNS } from './widget';

/**
 * Debug gallery for the dynamic-ui widget library.
 *
 * Mounted under the LOCAL_ONLY debug registry as `dynamic-ui`
 * (navigate to `/component/dynamic-ui` in dev). Shows every widget in isolation
 * plus a few composed views — the same data shape the eventual `compose_view` AI
 * tool will emit. No AI involved: everything below is hand-written fixtures.
 *
 * The `card`/`list`/`timeline` entity refs below are REAL ids from dev-assets
 * (the macro-db-dev RDS the running app talks to), owned by eric.hayes@macro.com,
 * so they resolve to real previews via ItemPreview. Swap them for other ids as
 * needed.
 */

// --- real entity refs from dev-assets (macro-db-dev RDS), owned by
// macro|eric.hayes@macro.com — the account logged into the running app — so they
// resolve to real previews via ItemPreview.
const DOC_SHOWCASE = '019e943b-ffbd-7a2b-b81d-7fe694f493b2'; // "Mentions and Citations Showcase"
const DOC_STABILIZE = '019e8f7d-2105-7d37-b4fd-8a5e35caff90'; // "Stabilize the tool render component during chat streaming"
const TASK_GROUP_TOOLS = '019e8f7f-283a-7d61-99c3-7f94033ec73e'; // "Group tool calls like claude code"
const TASK_LINK_MSG = '019e84b9-b21a-724a-80c8-8e26374779f7'; // "should be able to link to specific message"
const TASK_GEN_BUTTON = '019e839e-1d90-7731-92a8-bed4f25116ee'; // "add generate task button to messages"
const TASK_REVIEW_PR = '019e8f72-7699-7a45-aa3c-c7d5c2a8e7f4'; // "review guys pr"
const CH_MACRO = '0194671b-3624-747a-840e-69d944fe411a'; // "macro" channel

const SAMPLE_ENTITIES = [
  { id: TASK_GROUP_TOOLS, type: 'document' as const },
  { id: TASK_LINK_MSG, type: 'document' as const },
  { id: TASK_GEN_BUTTON, type: 'document' as const },
  { id: DOC_SHOWCASE, type: 'document' as const },
  { id: CH_MACRO, type: 'channel' as const },
];

// --- individual widget catalog: ONE section per widget ----------------------
const CATALOG: Array<{ label: string; widget: Widget }> = [
  {
    label: 'md',
    widget: {
      type: 'md',
      markdown:
        '## Weekly summary\n\nYou shipped **4 PRs** and closed *6 tickets*. See the [tracker](https://macro.com) for the full breakdown.\n\n- Auth race fix\n- Tool render stabilization\n\n> Nice momentum this week.',
    },
  },
  {
    label: 'stat',
    widget: {
      type: 'stat',
      label: 'PRs merged',
      value: 12,
      unit: 'PRs',
      delta: { value: 40, direction: 'up', label: 'vs last week' },
    },
  },
  {
    label: 'timeline',
    widget: {
      type: 'timeline',
      title: "Yesterday's activity",
      events: [
        {
          time: '9:12am',
          title: 'Edited a document',
          description: 'Mentions & Citations Showcase',
          entity: { id: DOC_SHOWCASE, type: 'document' },
        },
        {
          time: '11:40am',
          title: "Reviewed a teammate's PR",
          entity: { id: TASK_REVIEW_PR, type: 'document' },
        },
        {
          time: 'Tomorrow',
          title: 'Sync on the migration',
          entity: { id: CH_MACRO, type: 'channel' },
          future: true,
        },
        {
          time: 'Friday',
          title: 'Ship the dynamic-ui widgets',
          entity: { id: DOC_STABILIZE, type: 'document' },
          future: true,
        },
      ],
    },
  },
  {
    label: 'list',
    widget: {
      type: 'list',
      title: 'Pinned items',
      source: { kind: 'items', entities: SAMPLE_ENTITIES },
    },
  },
  {
    // Both card kinds (a task and an md doc) in one labeled section.
    label: 'card',
    widget: {
      type: 'container',
      direction: 'col',
      gap: 3,
      children: [
        { type: 'card', entity: { id: TASK_REVIEW_PR, type: 'document' } },
        { type: 'card', entity: { id: DOC_SHOWCASE, type: 'document' } },
      ],
    },
  },
  {
    label: 'channelMessage',
    widget: {
      type: 'channelMessage',
      channelId: '019467c2-49d0-7d99-b0b9-d535811a337d',
      messageId: '019eb2e2-c4f5-730e-8aee-70794417ddbd',
    },
  },
  {
    // Container demo: a row laying out two *different* widgets side by side.
    label: 'container',
    widget: {
      type: 'container',
      direction: 'row',
      gap: 3,
      children: [
        {
          type: 'stat',
          label: 'Throughput',
          value: 14,
          unit: '/day',
          delta: { value: 3, direction: 'up', label: 'vs last week' },
        },
        {
          type: 'md',
          markdown:
            '### Notes\n\nLayout is flexbox — child **order** sets position. This row places a stat and notes side by side.',
        },
      ],
    },
  },
];

// --- composed views ----------------------------------------------------------
const COMPOSED: View[] = [
  {
    title: 'What did I get done yesterday?',
    widgets: [
      {
        type: 'container',
        direction: 'row',
        gap: 3,
        children: [
          {
            type: 'stat',
            label: 'PRs merged',
            value: 4,
            delta: { value: 2, direction: 'up', label: 'vs avg' },
          },
          {
            type: 'stat',
            label: 'Tickets closed',
            value: 6,
          },
          {
            type: 'stat',
            label: 'Messages sent',
            value: 28,
          },
        ],
      },
      {
        type: 'timeline',
        title: 'Highlights',
        events: [
          { time: '9:12am', title: 'Shipped auth race fix (PR #482)' },
          { time: '1:30pm', title: 'Closed Sprint 14 carryover tickets' },
          { time: '4:50pm', title: 'Unblocked a teammate on the migration' },
        ],
      },
    ],
  },
  {
    title: 'My current work',
    widgets: [
      {
        type: 'card',
        entity: { id: DOC_STABILIZE, type: 'document' },
      },
      {
        type: 'container',
        direction: 'row',
        gap: 3,
        children: [
          {
            type: 'stat',
            label: 'In review',
            value: 3,
          },
          {
            type: 'stat',
            label: 'Blocked',
            value: 1,
          },
        ],
      },
      {
        type: 'list',
        title: 'Active tasks',
        source: { kind: 'items', entities: SAMPLE_ENTITIES },
      },
    ],
  },
  {
    title: 'Project health snapshot',
    widgets: [
      {
        type: 'md',
        markdown:
          '### Tool render stabilization\n\nA compact project readout that mixes narrative, metrics, trends, and the source document driving the work.',
      },
      {
        type: 'container',
        direction: 'row',
        gap: 3,
        wrap: true,
        children: [
          {
            type: 'stat',
            label: 'Ready checks',
            value: '7/9',
            delta: { value: 3, direction: 'up', label: 'since standup' },
          },
          {
            type: 'stat',
            label: 'Open risks',
            value: 2,
            delta: { value: 1, direction: 'down', label: 'from yesterday' },
          },
          {
            type: 'stat',
            label: 'Confidence',
            value: 82,
            unit: '%',
            delta: { value: 6, direction: 'up', label: 'this week' },
          },
        ],
      },
      {
        type: 'card',
        entity: { id: DOC_STABILIZE, type: 'document' },
      },
    ],
  },
  {
    title: 'Review queue',
    widgets: [
      {
        type: 'container',
        direction: 'row',
        gap: 3,
        children: [
          {
            type: 'stat',
            label: 'In queue',
            value: 6,
            delta: { value: 2, direction: 'down', label: 'since 9a' },
          },
          {
            type: 'md',
            markdown:
              '### Triage notes\n\n- Prioritize items with product impact\n- Pull docs into review comments\n- Leave owners with one clear next action',
          },
        ],
      },
      {
        type: 'list',
        title: 'Items to revisit',
        source: {
          kind: 'items',
          entities: [
            { id: TASK_REVIEW_PR, type: 'document' },
            { id: TASK_GROUP_TOOLS, type: 'document' },
            { id: TASK_LINK_MSG, type: 'document' },
            { id: DOC_SHOWCASE, type: 'document' },
          ],
        },
        limit: 4,
      },
      {
        type: 'timeline',
        title: 'Review windows',
        events: [
          { time: '10:00am', title: 'Scan stale review threads' },
          {
            time: '1:30pm',
            title: 'Pair on linked message follow-up',
            entity: { id: TASK_LINK_MSG, type: 'document' },
          },
          {
            time: '4:00pm',
            title: 'Send final notes to #macro',
            entity: { id: CH_MACRO, type: 'channel' },
            future: true,
          },
        ],
      },
    ],
  },
  {
    title: 'Message follow-up',
    widgets: [
      {
        type: 'channelMessage',
        channelId: '019467c2-49d0-7d99-b0b9-d535811a337d',
        messageId: '019eb2e2-c4f5-730e-8aee-70794417ddbd',
      },
      {
        type: 'container',
        direction: 'row',
        gap: 3,
        children: [
          {
            type: 'stat',
            label: 'Replies needed',
            value: 3,
          },
          {
            type: 'stat',
            label: 'Linked tasks',
            value: 2,
          },
          {
            type: 'stat',
            label: 'ETA',
            value: 'Today',
          },
        ],
      },
      {
        type: 'md',
        markdown:
          '### Draft response checklist\n\n- Confirm the owner\n- Link the relevant task\n- Call out the next checkpoint',
      },
    ],
  },
];

function DemoCell(props: { label: string; children: any }) {
  return (
    <div class="flex flex-col gap-2 rounded-lg border border-edge-muted p-3">
      <span class="text-ink-extra-muted text-xxs font-medium uppercase tracking-wide">
        {props.label}
      </span>
      {/* Isolate each widget: a single widget that throws or suspends shows
			    its own error/loading here instead of blanking the whole gallery. */}
      <div class="w-full">
        <ErrorBoundary
          fallback={(err) => (
            <div class="text-warning text-xxs">render error: {String(err)}</div>
          )}
        >
          <Suspense
            fallback={<div class="text-ink-muted text-xxs">loading…</div>}
          >
            {props.children}
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default function Gallery() {
  return (
    <ErrorBoundary
      fallback={(err) => (
        <div class="size-full overflow-auto bg-surface p-6">
          <pre class="whitespace-pre-wrap rounded border border-edge-muted p-4 text-sm text-warning">
            Gallery crashed: {String(err?.stack ?? err)}
          </pre>
        </div>
      )}
    >
      <Suspense
        fallback={
          <div class="text-ink-muted p-6 text-sm">Loading widgets…</div>
        }
      >
        <GalleryBody />
      </Suspense>
    </ErrorBoundary>
  );
}

function GalleryBody() {
  return (
    <StaticMarkdownContext theme={aiChatTheme}>
      <div class="size-full overflow-auto bg-surface">
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
          <header class="flex flex-col gap-1">
            <h1 class="text-ink text-xl font-semibold">
              Dynamic UI — Widget Gallery
            </h1>
            <p class="text-ink-muted text-sm">
              Every widget rendered from a hand-written schema fixture (no AI).
              The same shapes the <code>compose_view</code> tool will emit.
            </p>
          </header>

          <section class="flex flex-col gap-3">
            <h2 class="text-ink text-base font-semibold">Catalog</h2>
            <div class="flex flex-col gap-3">
              <For each={CATALOG}>
                {(entry) => (
                  <DemoCell label={entry.label}>
                    <WidgetNS.Render node={entry.widget} />
                  </DemoCell>
                )}
              </For>
            </div>
          </section>

          <section class="flex flex-col gap-4">
            <h2 class="text-ink text-base font-semibold">Composed views</h2>
            <For each={COMPOSED}>
              {(view) => (
                <div class="rounded-lg border border-edge-muted p-4">
                  <WidgetNS.Compose view={view} />
                </div>
              )}
            </For>
          </section>
        </div>
      </div>
    </StaticMarkdownContext>
  );
}
