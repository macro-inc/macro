import Hash from '@phosphor/hash.svg';
import Phone from '@phosphor/phone.svg';
import Sparkle from '@phosphor/sparkle.svg';
import UserPlus from '@phosphor/user-plus.svg';
import { Button } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import { homepagePeople } from '../../core/homepage-demo-people';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { DemoMentionText } from '../DemoMention';
import { ViewShell } from '../DemoWorkspaceChrome';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { ProductDemo } from '../product/ProductPage';
import { Segments } from '../workspace/frozen/DetailPanel';
import { MessageRow } from '../workspace/frozen/MessageRow';
import {
  arrivalGroups,
  createHomeInbox,
  DoneToast,
  HomeDetail,
  HomeRail,
  HomeSidebar,
  heroGroups,
  markDoneOnE,
  reviewRequestRow,
} from './ReviewHome';
import { PrMention, PrPreviewCard } from './ReviewPrMention';
import { PullRequestView } from './ReviewPullRequest';
import { invitePr, type PrStatus } from './review-fixtures';
import '../workspace/dummy-workspace.css';
import './review-stories.css';

type Point = { x: number; y: number };

/**
 * Keeps an overlay on a target inside `frame`, re-measured whenever the
 * target selector changes or the frame resizes (the TaskCreationFlow model).
 */
function trackTarget(options: {
  frame: () => HTMLElement;
  selector: Accessor<string | undefined>;
  measure: (target: DOMRect, frame: DOMRect) => Point;
}) {
  const [point, setPoint] = createSignal<Point>();
  onMount(() => {
    const position = () => {
      const selector = options.selector();
      const target = selector
        ? options.frame().querySelector<HTMLElement>(selector)
        : null;
      const bounds = target?.getBoundingClientRect();
      // A target hidden by the narrow layout has no box to point at.
      if (!bounds || (bounds.width === 0 && bounds.height === 0)) {
        setPoint(undefined);
        return;
      }
      setPoint(
        options.measure(bounds, options.frame().getBoundingClientRect())
      );
    };
    createEffect(() => {
      options.selector();
      const timer = requestAnimationFrame(position);
      onCleanup(() => cancelAnimationFrame(timer));
    });
    const resize = new ResizeObserver(position);
    resize.observe(options.frame());
    options.frame().addEventListener('scroll', position, true);
    onCleanup(() => {
      resize.disconnect();
      options.frame().removeEventListener('scroll', position, true);
    });
  });
  return point;
}

const pointAt = (target: DOMRect, frame: DOMRect): Point => ({
  x: target.left - frame.left + Math.min(target.width / 2, 72),
  y: target.top - frame.top + target.height / 2,
});

/** Hero: Home with a review request open, every row clickable. */
export function GithubHomeHero() {
  const inbox = createHomeInbox({ groups: heroGroups, initial: 'pr-482' });
  return (
    <ProductDemo label="Explore pull requests in Home">
      <div
        class="review-home"
        data-pane={inbox.pane()}
        onKeyDown={markDoneOnE(inbox)}
      >
        <HomeRail />
        <HomeSidebar inbox={inbox} />
        <div class="dummy-main review-home-main">
          <HomeDetail inbox={inbox} />
        </div>
        <DoneToast inbox={inbox} />
      </div>
    </ProductDemo>
  );
}

/**
 * A review request arrives at the top of Home. Jacob opens it, reads the PR,
 * and marks it done (E), which removes it and opens the next item.
 * Phases: 0 Home, 1 request arrives, 2 point at it, 3 open, 4 done.
 */
export function ReviewInboxDemo() {
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  const inbox = createHomeInbox({
    groups: arrivalGroups,
    initial: 'channel-engineers',
    pending: ['pr-482'],
  });
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const arrive = () => inbox.reveal(reviewRequestRow.id);
  const openRequest = () => {
    arrive();
    inbox.open(reviewRequestRow);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 4,
    reset: () => {},
    // A still frame is most useful with the pull request open.
    reduced: openRequest,
    delay: (step) => [0, 900, 1200, 800, 2600][step] ?? 1400,
    advance: (step) => {
      if (step === 1) arrive();
      if (step === 3) openRequest();
      if (step === 4) {
        inbox.markDone(reviewRequestRow.id);
        setAutomatic(false);
      }
      setPhase(step);
    },
  });
  const pause = () => {
    setAutomatic(false);
    arrive();
    playback.pause();
  };
  const pointer = trackTarget({
    frame: () => frame,
    selector: () =>
      automatic()
        ? [
            undefined,
            '[data-home-row="channel-engineers"]',
            '[data-home-row="pr-482"]',
            '[data-home-row="pr-482"]',
          ][phase()]
        : undefined,
    measure: pointAt,
  });
  return (
    <div ref={root} class="review-flow">
      <div ref={frame} class="review-flow-frame" onFocusIn={pause}>
        <ProductDemo
          label="A review request arrives in Home and opens the pull request"
          onInteract={pause}
          height={520}
          mobileHeight={500}
        >
          <div
            class="review-home review-home-zoomed"
            data-pane={inbox.pane()}
            onKeyDown={markDoneOnE(inbox)}
          >
            <HomeSidebar
              inbox={inbox}
              arriving={phase() >= 1 ? reviewRequestRow.id : undefined}
            />
            <div class="dummy-main review-home-main">
              <HomeDetail inbox={inbox} />
            </div>
            <DoneToast inbox={inbox} />
          </div>
        </ProductDemo>
        <Show when={pointer()}>
          {(p) => (
            <DemoCursor
              label="Jacob"
              class="review-flow-pointer"
              clicking={phase() === 3}
              style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

const CHANNEL_TABS = ['Messages', 'Attachments', 'Calls', 'Participants'];

/**
 * A pull request link in a channel renders as a mention; hovering it shows
 * the preview card, and the mention follows the PR when it merges.
 * Phases: 0 channel, 1 cursor in, 2 hover the link, 3 card, 4 merged.
 */
export function PrLinkDemo() {
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const [status, setStatus] = createSignal<PrStatus>('open');
  const [hovered, setHovered] = createSignal(false);
  const [opened, setOpened] = createSignal(false);
  const [tab, setTab] = createSignal('Messages');
  const [reacted, setReacted] = createSignal<string[]>([]);
  const [sent, setSent] = createSignal<WorkspaceComment[]>([]);
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 4,
    reset: () => {},
    reduced: () => {
      setHovered(true);
      setStatus('merged');
    },
    delay: (step) => [0, 700, 900, 600, 2200][step] ?? 1400,
    advance: (step) => {
      setPhase(step);
      if (step === 3) setHovered(true);
      if (step === 4) setStatus('merged');
    },
  });
  const pause = () => {
    setAutomatic(false);
    playback.pause();
  };
  // Hover moves between the link and its card without closing it.
  const hover = (next: boolean, event: MouseEvent | FocusEvent) => {
    pause();
    const related = event.relatedTarget as Node | null;
    if (!next && related && frame.contains(related)) {
      const element = related instanceof Element ? related : null;
      if (element?.closest('[data-pr-mention], .review-pr-card')) return;
    }
    setHovered(next);
  };
  const pointer = trackTarget({
    frame: () => frame,
    selector: () =>
      automatic() && phase() >= 1
        ? phase() === 1
          ? '[data-message="staging"] p'
          : '[data-pr-mention]'
        : undefined,
    measure: pointAt,
  });
  const cardOpen = () => hovered() && !opened() && tab() === 'Messages';
  const card = trackTarget({
    frame: () => frame,
    selector: () => (cardOpen() ? '[data-pr-mention]' : undefined),
    measure: (target, bounds) => ({
      x: Math.max(
        8,
        Math.min(target.left - bounds.left, bounds.width - CARD_WIDTH - 8)
      ),
      y: target.bottom - bounds.top + 8,
    }),
  });
  const react = (id: string) =>
    setReacted((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    );
  const message = (
    id: string,
    person: WorkspaceComment['person'],
    time: string,
    body = ''
  ) => ({
    id,
    person,
    time,
    body,
    reactions: reacted().includes(id) ? ['jacob' as const] : undefined,
  });
  return (
    <div ref={root} class="review-flow">
      <div ref={frame} class="review-flow-frame" onFocusIn={pause}>
        <ProductDemo
          label="Hover a pull request link in a channel to see its status"
          onInteract={pause}
          height={470}
          mobileHeight={560}
        >
          <Show
            when={!opened()}
            fallback={
              <PullRequestView
                pr={invitePr}
                status={status()}
                crumb={{ label: '#launch', onClick: () => setOpened(false) }}
              />
            }
          >
            <ViewShell.TopBar>
              <Hash class="size-4" />
              <span class="text-sm font-medium">launch</span>
              <Segments
                label="Conversation view"
                items={CHANNEL_TABS}
                value={tab()}
                onChange={setTab}
              />
              <div class="ml-auto flex items-center gap-1">
                <Button size="sm" variant="plain" class="review-channel-invite">
                  <UserPlus class="size-3" />
                  Invite
                </Button>
                <Button size="sm" variant="plain">
                  <Phone class="size-3" />
                  Call
                </Button>
                <Button size="sm" variant="plain">
                  <Sparkle class="size-3" />
                  Ask Macro
                </Button>
              </div>
            </ViewShell.TopBar>
            <div
              class="dummy-scroll sample-chat-log review-channel-log"
              role="log"
              aria-label="Channel launch"
            >
              <Switch
                fallback={
                  <p class="py-12 text-center text-sm text-ink-muted">
                    {tab() === 'Calls'
                      ? 'No calls in this channel'
                      : 'No documents in this channel yet.'}
                  </p>
                }
              >
                <Match when={tab() === 'Participants'}>
                  <For each={['jacob', 'julia', 'teo', 'gabriel'] as const}>
                    {(person) => (
                      <div class="flex items-center gap-3 py-3">
                        <img
                          class="size-8 rounded-full"
                          alt=""
                          src={homepagePeople[person].photo}
                        />
                        {homepagePeople[person].name}
                      </div>
                    )}
                  </For>
                </Match>
                <Match when={tab() === 'Messages'}>
                  <div class="sample-date-divider">
                    <span>Today</span>
                  </div>
                  <div class="sample-channel-thread" data-message="staging">
                    <MessageRow
                      message={message(
                        'staging',
                        'gabriel',
                        '9:58 AM',
                        'staging still drops new people into their personal workspace after they accept an invite'
                      )}
                      onReact={() => react('staging')}
                    />
                  </div>
                  <div class="sample-channel-thread" data-message="fix">
                    <MessageRow
                      message={message('fix', 'teo', '10:14 AM')}
                      onReact={() => react('fix')}
                    >
                      <p class="review-message-body">
                        fix is up:{' '}
                        <PrMention
                          pr={invitePr}
                          status={status()}
                          hovered={hovered() || (automatic() && phase() >= 2)}
                          onHover={hover}
                          onOpen={() => {
                            pause();
                            setHovered(false);
                            setOpened(true);
                          }}
                        />
                        <DemoMentionText text=" @[Jacob](demo-mention:jacob) can you review before Thursday?" />
                      </p>
                    </MessageRow>
                  </div>
                  <div class="sample-channel-thread" data-message="announce">
                    <MessageRow
                      message={message(
                        'announce',
                        'julia',
                        '10:16 AM',
                        'if it lands today I’ll send the announcement tomorrow morning'
                      )}
                      onReact={() => react('announce')}
                    />
                  </div>
                  <For each={sent()}>
                    {(item) => (
                      <div class="sample-channel-thread">
                        <MessageRow message={item} />
                      </div>
                    )}
                  </For>
                </Match>
              </Switch>
            </div>
            <Show when={tab() === 'Messages'}>
              <div class="dummy-composer sample-chat-composer">
                <ChannelComposer
                  richMentions
                  label="Message #launch"
                  placeholder="Type @ to share with #launch"
                  onSend={(body) =>
                    setSent((items) => [
                      ...items,
                      {
                        id: `sent-${items.length}`,
                        person: 'jacob',
                        time: '10:20 AM',
                        body,
                      },
                    ])
                  }
                />
              </div>
            </Show>
          </Show>
        </ProductDemo>
        <Show when={cardOpen()}>
          <PrPreviewCard
            pr={invitePr}
            status={status()}
            class="review-flow-card"
            style={{
              transform: `translate(${card()?.x ?? 0}px, ${card()?.y ?? 0}px)`,
              visibility: card() ? undefined : 'hidden',
            }}
            onHover={hover}
          />
        </Show>
        <Show when={pointer()}>
          {(p) => (
            <DemoCursor
              label="Jacob"
              class="review-flow-pointer"
              style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

const CARD_WIDTH = 320;
