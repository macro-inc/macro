import Cloud from '@phosphor/cloud.svg';
import CloudWarning from '@phosphor/cloud-warning.svg';
import { Tooltip } from '@ui/components/Tooltip';
import { For, Show } from 'solid-js';
import { DemoCursor } from '../DemoCursor';
import { HomepageConversation } from '../HomepageConversation';
import { HomepageMention } from '../HomepageMention';
import { ProductDemo } from '../product/ProductPage';
import { DocumentFrame } from './DocumentFrame';
import {
  controlPoint,
  createAnchor,
  createSceneClock,
  typed,
} from './documentScene';

export { DocumentMentionsDemo } from './DocumentMentionsDemo';
export { DocumentSharingDemo } from './DocumentSharingDemo';

/** A collaborator's insertion point inside the editable text. */
function Caret(props: { who: 'claude' | 'jacob' | 'julia' }) {
  return <span class="doc-caret" data-caret={props.who} />;
}

const OLD_INTRO =
  'We’re introducing the team workspace on Thursday. It brings email, messages, tasks, and docs into one place, so a team can stop switching between five apps to get work done. The invite flow and the announcement still need a final check before we publish.';
const NEW_INTRO =
  'Thursday we launch the team workspace: email, chat, tasks, and docs in one place.';
const CHECK_HEADING = 'Before we publish';
const CHECKLIST = [
  'Teo: verify the invite flow.',
  'Julia: final read of the announcement.',
  'Jacob: confirm the launch checks.',
];
const ANNOUNCEMENT = 'Julia sends it at 9.';
const JACOB_ADDS = ' Dana’s team gets a heads-up the night before.';

// Claude selects the intro, retypes it, then writes the checklist line by
// line. Jacob keeps writing further down the whole time.
const AGENT = {
  select: 250,
  replace: 750,
  intro: 2050,
  heading: [2200, 2500],
  items: [
    [2600, 3200],
    [3250, 3900],
    [3950, 4550],
  ],
  jacob: [600, 3000],
  end: 4700,
} as const;

/** Claude edits the open document with its own cursor while Jacob types. */
export function DocumentAgentDemo() {
  let root!: HTMLDivElement;
  let overlay: HTMLDivElement | undefined;
  const clock = createSceneClock({
    root: () => root,
    end: AGENT.end,
    lead: 700,
  });
  const t = clock.t;
  const claudeAt = () => {
    if (t() < AGENT.select) return 'start';
    if (t() < AGENT.replace) return 'selected';
    if (t() < AGENT.heading[0]) return 'intro';
    if (t() < AGENT.items[0][0]) return 'heading';
    const item = AGENT.items.reduce(
      (current, [from], index) => (t() >= from ? index : current),
      0
    );
    return `item-${item}`;
  };
  const frame = () => overlay?.parentElement ?? undefined;
  const claude = createAnchor({
    frame,
    track: t,
    target: () => ({ selector: '[data-caret="claude"]' }),
  });
  const jacob = createAnchor({
    frame,
    track: t,
    target: () => ({ selector: '[data-caret="jacob"]' }),
  });
  return (
    <div
      ref={root}
      class="doc-story doc-story-page-fade"
      data-live={clock.live()}
    >
      <div class="product-demo-request">
        <HomepageConversation
          messages={[
            {
              person: 'julia',
              text: (
                <>
                  <span class="homepage-person-mention">@Claude</span>, make the
                  intro in{' '}
                  <HomepageMention
                    kind="md"
                    label="Q3 launch plan"
                    description="Thursday’s launch: the intro, owners, and the announcement plan."
                    href="#document-agents"
                  />{' '}
                  shorter and add a checklist with Teo, Julia, and Jacob’s next
                  steps.
                </>
              ),
            },
          ]}
        />
      </div>
      <ProductDemo
        label="Claude edits the launch plan while Jacob keeps writing"
        onInteract={clock.takeOver}
        height={540}
        mobileHeight={640}
      >
        <DocumentFrame
          title="Q3 launch plan"
          tags={['Launch', 'Product']}
          overlay={
            <div ref={overlay} class="doc-story-overlay" aria-hidden="true">
              <Show when={clock.live() && claude()}>
                {(point) => (
                  <DemoCursor
                    label="Claude"
                    class="doc-story-cursor"
                    style={{
                      transform: `translate(${point().x}px, ${point().y}px)`,
                    }}
                  />
                )}
              </Show>
              <Show when={clock.live() && jacob()}>
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
          <h2>Thursday’s launch</h2>
          <p>
            <Show
              when={t() < AGENT.replace}
              fallback={
                <>
                  {typed(NEW_INTRO, t(), AGENT.replace, AGENT.intro)}
                  <Show when={claudeAt() === 'intro'}>
                    <Caret who="claude" />
                  </Show>
                </>
              }
            >
              <Show when={claudeAt() === 'start'}>
                <Caret who="claude" />
              </Show>
              <span
                class={
                  claudeAt() === 'selected' ? 'doc-story-selected' : undefined
                }
              >
                {OLD_INTRO}
              </span>
              <Show when={claudeAt() === 'selected'}>
                <Caret who="claude" />
              </Show>
            </Show>
          </p>
          <Show when={t() >= AGENT.heading[0]}>
            <h2>
              {typed(CHECK_HEADING, t(), AGENT.heading[0], AGENT.heading[1])}
              <Show when={claudeAt() === 'heading'}>
                <Caret who="claude" />
              </Show>
            </h2>
          </Show>
          <Show when={t() >= AGENT.items[0][0]}>
            <ul class="md-list md-check">
              <For each={CHECKLIST}>
                {(item, index) => (
                  <Show when={t() >= AGENT.items[index()][0]}>
                    <li>
                      {typed(
                        item,
                        t(),
                        AGENT.items[index()][0],
                        AGENT.items[index()][1]
                      )}
                      <Show when={claudeAt() === `item-${index()}`}>
                        <Caret who="claude" />
                      </Show>
                    </li>
                  </Show>
                )}
              </For>
            </ul>
          </Show>
          <h2>Announcement</h2>
          <p>
            {ANNOUNCEMENT}
            {typed(JACOB_ADDS, t(), AGENT.jacob[0], AGENT.jacob[1])}
            <Caret who="jacob" />
          </p>
          <h2>Owners</h2>
          <p>
            Julia owns the announcement and the customer email. Teo owns the
            deploy and release checks. Jacob owns customer conversations.
          </p>
          <h2>After launch</h2>
          <p>
            Check activation on Friday and send Dana’s team the rollout plan.
          </p>
        </DocumentFrame>
      </ProductDemo>
    </div>
  );
}

const JULIA_EDIT = 'Send it Thursday at 9. ';
const ANNOUNCEMENT_LINE = 'Lead with the shared inbox.';
const JACOB_OFFLINE = ' Pricing doesn’t change for existing teams.';

// Offline while Jacob writes, reconnecting, then synced with Julia's edit to
// the same paragraph merged in front of his.
const OFFLINE = {
  hover: 1100,
  type: [1500, 3200],
  connecting: 3500,
  synced: 4400,
  end: 4600,
} as const;

/** The real offline indicator while Jacob writes; Julia's edit merges in. */
export function DocumentOfflineDemo() {
  let root!: HTMLDivElement;
  let overlay: HTMLDivElement | undefined;
  const clock = createSceneClock({
    root: () => root,
    end: OFFLINE.end,
    lead: 500,
  });
  const t = clock.t;
  const status = () =>
    t() < OFFLINE.connecting
      ? 'offline'
      : t() < OFFLINE.synced
        ? 'connecting'
        : undefined;
  const hovering = () => clock.live() && t() < OFFLINE.hover;
  const synced = () => t() >= OFFLINE.synced;
  const gliding = () => t() >= OFFLINE.hover && t() < OFFLINE.type[0];
  const frame = () => overlay?.parentElement ?? undefined;
  const jacob = createAnchor({
    frame,
    track: t,
    target: () =>
      hovering()
        ? { selector: '[data-sync-status]', place: controlPoint }
        : { selector: '[data-caret="jacob"]' },
  });
  const julia = createAnchor({
    frame,
    track: t,
    target: () => (synced() ? { selector: '[data-caret="julia"]' } : undefined),
  });
  return (
    <div
      ref={root}
      class="doc-story doc-story-page-fade"
      data-live={clock.live()}
    >
      <ProductDemo
        label="Jacob writes offline, then his edits merge with Julia’s"
        onInteract={clock.takeOver}
        height={470}
        mobileHeight={560}
      >
        <DocumentFrame
          title="Q3 launch plan"
          tags={['Launch', 'Product']}
          status={
            <Show when={status()}>
              {(current) => (
                <span class="doc-sync">
                  <Tooltip
                    as="span"
                    label={
                      current() === 'offline'
                        ? "You're offline. Changes will sync when you reconnect."
                        : 'Reconnecting…'
                    }
                  >
                    <span
                      role="status"
                      data-sync-status
                      class="doc-sync-status"
                      data-status={current()}
                      aria-label={
                        current() === 'offline' ? 'Offline' : 'Reconnecting'
                      }
                    >
                      <Show when={current() === 'offline'} fallback={<Cloud />}>
                        <CloudWarning />
                      </Show>
                    </span>
                  </Tooltip>
                  <Show when={hovering() && current() === 'offline'}>
                    <span class="doc-tooltip" aria-hidden="true">
                      You're offline. Changes will sync when you reconnect.
                    </span>
                  </Show>
                </span>
              )}
            </Show>
          }
          overlay={
            <div ref={overlay} class="doc-story-overlay" aria-hidden="true">
              <Show when={clock.live() && jacob()}>
                {(point) => (
                  <DemoCursor
                    label="Jacob"
                    class={`doc-story-cursor${gliding() ? ' doc-story-glide' : ''}`}
                    style={{
                      transform: `translate(${point().x}px, ${point().y}px)`,
                    }}
                  />
                )}
              </Show>
              <Show when={clock.live() && julia()}>
                {(point) => (
                  <DemoCursor
                    label="Julia"
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
          <h2>Launch checklist</h2>
          <ul class="md-list md-check">
            <li class="checked md-strike text-ink-extra-muted">
              Finalize the product story
            </li>
            <li>Send the customer email</li>
            <li>Publish the changelog</li>
          </ul>
          <h2>Announcement</h2>
          <p>
            <Show when={synced()}>
              <span class="doc-story-merged">{JULIA_EDIT}</span>
              <Caret who="julia" />
            </Show>
            {ANNOUNCEMENT_LINE}
            {typed(JACOB_OFFLINE, t(), OFFLINE.type[0], OFFLINE.type[1])}
            <Caret who="jacob" />
          </p>
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
