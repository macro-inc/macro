import HashStraight from '@phosphor/hash-straight.svg';
import ListChecks from '@phosphor/list-checks.svg';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { homepagePeople } from '../../core/homepage-demo-people';
import { DemoCursor } from '../DemoCursor';
import { ProductDemo } from '../product/ProductPage';
import { TagDot } from '../workspace/frozen/DemoTags';
import { PanelSection } from '../workspace/frozen/DetailPanel';
import { DocMention, type DocMentionItem, people } from './DocMention';
import { type DocMentionGroup, DocMentionMenu } from './DocMentionMenu';
import { DocumentFrame } from './DocumentFrame';
import {
  createAnchor,
  createSceneClock,
  type Point,
  typed,
} from './documentScene';

const ITEMS = {
  invite: {
    kind: 'task',
    label: 'Fix the team invite handoff',
    status: 'In Progress',
  },
  deploy: {
    kind: 'task',
    label: 'Fix the deploy pipeline',
    status: 'In Progress',
  },
  announcement: {
    kind: 'task',
    label: 'Write the launch announcement',
    status: 'In Review',
  },
  checklist: {
    kind: 'task',
    label: 'Prepare the launch checklist',
    status: 'Not Started',
  },
  rollout: { kind: 'document', label: 'Team rollout plan' },
  meadow: { kind: 'company', label: 'The Meadow' },
  email: { kind: 'email', label: 'Team invites for The Meadow' },
  launch: { kind: 'channel', label: 'launch' },
  today: { kind: 'date', label: 'Today' },
} satisfies Record<string, DocMentionItem>;

/** A bare @ offers every bucket; the editor's menu shows the first few. */
const EVERYTHING: DocMentionGroup[] = [
  {
    label: 'People & Groups',
    total: 14,
    rows: [people.julia, people.teo, people.gabriel],
  },
  {
    label: 'Documents, Agents, & Tasks',
    total: 62,
    rows: [ITEMS.rollout, ITEMS.invite, ITEMS.announcement],
  },
  { label: 'Channels', total: 9, rows: [ITEMS.launch] },
  { label: 'Companies', total: 23, rows: [ITEMS.meadow] },
  { label: 'Emails', total: 410, rows: [ITEMS.email] },
  { label: 'Dates', rows: [ITEMS.today] },
];

type Segment =
  | { text: string }
  | {
      query: string;
      item: DocMentionItem;
      groups: DocMentionGroup[];
      /** Rows the selection visits before Enter, e.g. arrowing to a channel. */
      picks: number[];
      browse?: boolean;
    };

const LINE: Segment[] = [
  { text: 'Teo is fixing ' },
  {
    query: 'fix',
    item: ITEMS.invite,
    browse: true,
    picks: [0],
    groups: [
      {
        label: 'Documents, Agents, & Tasks',
        rows: [ITEMS.invite, ITEMS.deploy],
      },
    ],
  },
  { text: ' for ' },
  {
    query: 'mea',
    item: ITEMS.meadow,
    picks: [0],
    groups: [
      { label: 'Companies', rows: [ITEMS.meadow] },
      { label: 'Emails', rows: [ITEMS.email] },
    ],
  },
  { text: '. Dana asked about it in ' },
  {
    query: 'invites',
    item: ITEMS.email,
    picks: [0],
    groups: [{ label: 'Emails', rows: [ITEMS.email] }],
  },
  { text: ', so post in ' },
  {
    query: 'launch',
    item: ITEMS.launch,
    picks: [0, 1, 2],
    groups: [
      {
        label: 'Documents, Agents, & Tasks',
        rows: [ITEMS.announcement, ITEMS.checklist],
      },
      { label: 'Channels', rows: [ITEMS.launch] },
    ],
  },
  { text: ' when it ships.' },
];

// Typing speeds: prose, the @query, the pause on a result, an arrow key.
const CHAR = 22;
const QUERY_CHAR = 70;
const HOLD = 480;
const BROWSE = 750;
const ARROW = 260;

type Timed =
  | { text: string; from: number; to: number }
  | (Extract<Segment, { query: string }> & {
      open: number;
      queryFrom: number;
      queryTo: number;
      pick: number;
    });

const timeline = (() => {
  let at = 0;
  return LINE.map((segment): Timed => {
    if ('text' in segment) {
      const from = at;
      at += segment.text.length * CHAR;
      return { text: segment.text, from, to: at };
    }
    const open = at + QUERY_CHAR;
    const queryFrom = open + (segment.browse ? BROWSE : 0);
    const queryTo = queryFrom + segment.query.length * QUERY_CHAR;
    at = queryTo + HOLD + (segment.picks.length - 1) * ARROW;
    return { ...segment, open, queryFrom, queryTo, pick: at };
  });
})();
const last = timeline[timeline.length - 1];
const END = ('text' in last ? last.to : last.pick) + 500;
const start = (segment: Timed) =>
  'text' in segment ? segment.from : segment.open - QUERY_CHAR;

/** Typing @ in a doc opens the mention menu over every kind of workspace item. */
export function DocumentMentionsDemo() {
  let root!: HTMLDivElement;
  let overlay: HTMLDivElement | undefined;
  const clock = createSceneClock({ root: () => root, end: END, lead: 600 });
  const t = clock.t;
  const [wide, setWide] = createSignal(false);
  const active = () =>
    timeline.reduce(
      (current, segment, index) => (t() >= start(segment) ? index : current),
      0
    );
  const menu = () => {
    const segment = timeline[active()];
    if (!clock.live() || 'text' in segment || t() < segment.open) return;
    if (t() >= segment.pick) return;
    if (segment.browse && t() < segment.queryFrom)
      return { groups: EVERYTHING, selected: 0 };
    const step = Math.floor((t() - segment.queryTo - HOLD / 2) / ARROW) + 1;
    const visit = Math.max(0, Math.min(segment.picks.length - 1, step));
    return { groups: segment.groups, selected: segment.picks[visit] };
  };
  const frame = () => overlay?.parentElement ?? undefined;
  const caret = createAnchor({
    frame,
    track: t,
    target: () => ({ selector: '[data-caret="jacob"]' }),
  });
  const query = createAnchor({
    frame,
    track: t,
    target: () =>
      menu()
        ? {
            selector: '[data-mention-query]',
            place: (rect): Point => ({ x: rect.left, y: rect.bottom + 6 }),
          }
        : undefined,
  });
  const menuLeft = (x: number) => {
    const width = overlay?.clientWidth ?? 0;
    return Math.max(8, Math.min(x, width - Math.min(384, width - 16) - 8));
  };
  onMount(() => {
    const element = frame();
    if (!element) return;
    const resize = new ResizeObserver(() =>
      setWide(element.clientWidth >= 700)
    );
    resize.observe(element);
    onCleanup(() => resize.disconnect());
  });
  // Wide windows keep References open beside the doc. Narrow ones open the
  // panel over it once the paragraph is written.
  const panelOpen = () =>
    wide() || (clock.done() && !clock.reduced()) ? true : undefined;
  const covered = () => !wide() && panelOpen() === true;
  return (
    <div
      ref={root}
      class="doc-story doc-story-page-fade doc-story-split"
      data-live={clock.live()}
    >
      <ProductDemo
        label="Mention a task, a company, an email, and a channel in a doc"
        onInteract={clock.takeOver}
        height={560}
        mobileHeight={620}
      >
        <DocumentFrame
          title="Q3 launch plan"
          tags={['Launch', 'Product']}
          panelOpen={panelOpen()}
          panel={<ReferencesPanel />}
          overlay={
            <div ref={overlay} class="doc-story-overlay" aria-hidden="true">
              <Show when={menu()}>
                {(open) => (
                  <Show when={query()}>
                    {(point) => (
                      <DocMentionMenu
                        groups={open().groups}
                        selected={open().selected}
                        style={{
                          left: `${menuLeft(point().x)}px`,
                          top: `${point().y}px`,
                        }}
                      />
                    )}
                  </Show>
                )}
              </Show>
              <Show when={clock.live() && !covered() && caret()}>
                {(point) => (
                  <DemoCursor
                    label="Jacob"
                    class="doc-story-cursor"
                    style={{
                      transform: `translate(${point().x}px, ${point().y}px)`,
                    }}
                  />
                )}
              </Show>
            </div>
          }
        >
          <h2>Before Thursday</h2>
          <p>
            <For each={timeline}>
              {(segment, index) => (
                <>
                  {'text' in segment ? (
                    typed(segment.text, t(), segment.from, segment.to)
                  ) : (
                    <Show
                      when={t() >= segment.pick}
                      fallback={
                        <Show when={t() >= start(segment)}>
                          <span class="doc-mention-query" data-mention-query>
                            @
                            {typed(
                              segment.query,
                              t(),
                              segment.queryFrom,
                              segment.queryTo
                            )}
                          </span>
                        </Show>
                      }
                    >
                      <DocMention item={segment.item} />
                    </Show>
                  )}
                  <Show when={index() === active()}>
                    <span class="doc-caret" data-caret="jacob" />
                  </Show>
                </>
              )}
            </For>
          </p>
          <p>
            Launch is Thursday at 9.{' '}
            <DocMention item={{ kind: 'person', label: 'Julia' }} /> sends the
            announcement once the invite fix ships.
          </p>
          <h2>Launch checklist</h2>
          <ul class="md-list md-check">
            <li class="checked md-strike text-ink-extra-muted">
              Finalize the product story
            </li>
            <li>Send the customer email</li>
            <li>Publish the changelog</li>
          </ul>
          <h2>Owners</h2>
          <p>
            Julia owns the announcement and the customer email. Teo owns the
            deploy and release checks.
          </p>
        </DocumentFrame>
      </ProductDemo>
    </div>
  );
}

/** MarkdownSidePanelSections: Tags, Properties, and References (N). */
function ReferencesPanel() {
  return (
    <>
      <PanelSection title="Tags" open>
        <div class="doc-panel-tags">
          <For each={['Launch', 'Product']}>
            {(tag) => (
              <span class="sample-file-tag">
                <TagDot label={tag} />
                {tag}
              </span>
            )}
          </For>
        </div>
      </PanelSection>
      <PanelSection title="References (2)" open>
        <div class="doc-ref-row">
          <div class="doc-ref-head">
            <img src={homepagePeople.julia.photo} alt="" />
            <b>Julia</b>
            <span class="doc-ref-in">in</span>
            <span class="doc-ref-source">
              <HashStraight />
              <span>launch</span>
            </span>
            <span class="doc-ref-time">· 2 hours ago</span>
          </div>
          <div class="doc-ref-body">
            Plan for Thursday is in{' '}
            <DocMention item={{ kind: 'document', label: 'Q3 launch plan' }} />.
            Comments welcome before noon.
          </div>
        </div>
        <div class="doc-ref-row">
          <div class="doc-ref-head">
            <img src={homepagePeople.teo.photo} alt="" />
            <b>Teo</b>
            <span class="doc-ref-in">in</span>
            <span class="doc-ref-source">
              <ListChecks class="text-task" />
              <span>Fix the team invite handoff</span>
            </span>
            <span class="doc-ref-time">· 3 hours ago</span>
          </div>
        </div>
      </PanelSection>
    </>
  );
}
