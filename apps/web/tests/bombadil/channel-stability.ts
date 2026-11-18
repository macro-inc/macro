// Bombadil property: a loaded channel does not resize or move by itself.
// See README.md in this directory for how to run it.
import { always } from '@antithesishq/bombadil';
import type { Range } from '@antithesishq/bombadil/actions';
import {
  type ActionTemplate,
  actions,
  extract,
  registerCustomAction,
  weighted,
} from '@antithesishq/bombadil/browser';
import {
  back,
  clicks,
  forward,
} from '@antithesishq/bombadil/browser/defaults/actions';
import manifest from '../../../../tooling/seed_cli/seed/local_e2e/manifest.json' with {
  type: 'json',
};
// Written by run.sh: the stack's backend origin and a second seeded user's token.
import local from './local.json' with { type: 'json' };

type Violation = {
  kind: 'lost-bottom' | 'anchor-moved' | 'resized';
  at: number;
  channel: string;
  anchor: string | null;
  delta: number;
  scrollTop: number;
};

type ProbeReport = {
  frames: number;
  /** Frames compared with the frame before, outside input grace periods. */
  checked: number;
  count: number;
  violations: Violation[];
};

// Bombadil captures a state only at quiescence, so a jump the app corrects a
// few frames later falls between two captures. The extractor therefore
// installs a probe in the page that samples after every paint and keeps a
// running list of violations; each capture reads that list.
//
// Extractors are serialized into the page, so everything the probe uses is
// defined inside this function.
const probe = extract((state): ProbeReport => {
  const page = state.window as Window & { __channelProbe?: ProbeReport };

  if (!page.__channelProbe) {
    // What explains a change. Input moves the view directly, so it explains
    // motion only briefly; a scroll that keeps moving after it (smooth or
    // momentum scrolling) extends that. Work the app starts in response, such
    // as loading older messages, is not excused: it must keep the reader's
    // place. Typing and window resizes may resize the timeline a little later.
    // Bombadil acts every 60 ms or so, so a longer motion grace would excuse
    // nearly every frame. On a busy machine the scroll a wheel or key causes
    // can land later than that, so the first scroll after such input is the
    // input's own, up to a second later.
    const MOTION_GRACE_MS = 150;
    const INPUT_SCROLL_DELAY_MS = 1000;
    const LAYOUT_GRACE_MS = 800;
    const TOLERANCE_PX = 1;
    const report: ProbeReport = {
      frames: 0,
      checked: 0,
      count: 0,
      violations: [],
    };
    page.__channelProbe = report;

    // Any input explains a height change for a while (typing grows the
    // composer). Only input that scrolls explains motion: the wheel, touch,
    // keys, a drag on a scrollbar, or a scroll-to-bottom button. Any other
    // click (opening a pane) keeps the reading position under check.
    // Nothing has happened yet: a page fresh from load excuses nothing.
    let lastInputAt = Number.NEGATIVE_INFINITY;
    let lastScrollInputAt = Number.NEGATIVE_INFINITY;
    let lastScrollAt = Number.NEGATIVE_INFINITY;
    let lastResizeAt = Number.NEGATIVE_INFINITY;
    let scrollInputPending = false;
    let scrollbarHeld = false;
    const onScrollbar = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return false;
      const scrolls =
        target.scrollHeight > target.clientHeight ||
        target.scrollWidth > target.clientWidth;
      return (
        scrolls &&
        (event.offsetX >= target.clientWidth ||
          event.offsetY >= target.clientHeight)
      );
    };
    const onScrollControl = (event: PointerEvent) =>
      event.target instanceof Element &&
      event.target.closest('[data-scroll-to-bottom]') !== null;
    const onInput = (event: Event) => {
      lastInputAt = performance.now();
      if (event.type === 'beforeinput') return;
      if (event instanceof PointerEvent && event.type === 'pointerdown') {
        scrollbarHeld = onScrollbar(event);
        if (scrollbarHeld || onScrollControl(event)) scrollInputPending = true;
        return;
      }
      scrollInputPending = true;
      lastScrollInputAt = lastInputAt;
    };
    for (const type of [
      'wheel',
      'touchstart',
      'touchmove',
      'keydown',
      'pointerdown',
      'beforeinput',
    ]) {
      page.addEventListener(type, onInput, { capture: true, passive: true });
    }
    for (const type of ['pointerup', 'pointercancel']) {
      page.addEventListener(
        type,
        () => {
          scrollbarHeld = false;
        },
        { capture: true, passive: true }
      );
    }
    page.addEventListener('resize', () => {
      lastResizeAt = performance.now();
    });
    page.addEventListener(
      'scroll',
      () => {
        const now = performance.now();
        const answersInput =
          scrollbarHeld ||
          (scrollInputPending && now - lastInputAt < INPUT_SCROLL_DELAY_MS);
        if (
          answersInput ||
          now - Math.max(lastScrollInputAt, lastScrollAt) < MOTION_GRACE_MS
        ) {
          lastScrollAt = now;
        }
        scrollInputPending = false;
      },
      { capture: true, passive: true }
    );

    type Baseline = {
      scroller: HTMLElement;
      url: string;
      channel: string;
      fromBottom: number;
      anchor: string | null;
      anchorTop: number;
      scrollTop: number;
      height: number;
    };
    let baseline: Baseline | null = null;

    // The painted timeline, or null while no loaded channel timeline shows.
    const readFrame = (): Baseline | null => {
      const scroller = document.querySelector<HTMLElement>(
        'main [data-channel-scroll]'
      );
      const channel =
        location.pathname.match(/\/channels?\/([^/~?]+)/)?.[1] ?? '';
      if (
        !scroller ||
        !channel ||
        scroller.dataset.scrollPhase !== 'ready' ||
        scroller.querySelector('[data-message-id]') === null
      ) {
        return null;
      }

      const rect = scroller.getBoundingClientRect();
      const fromBottom =
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      // The first message in view, even one taller than the viewport.
      const anchorElement = [
        ...scroller.querySelectorAll<HTMLElement>('[data-message-id]'),
      ].find(
        (message) => message.getBoundingClientRect().bottom > rect.top + 1
      );
      return {
        scroller,
        url: location.pathname + location.search,
        channel,
        fromBottom,
        anchor: anchorElement?.dataset.messageId ?? null,
        anchorTop: anchorElement
          ? anchorElement.getBoundingClientRect().top - rect.top
          : 0,
        scrollTop: scroller.scrollTop,
        height: scroller.clientHeight,
      };
    };

    // How far the view moved by itself between two frames, or null. The
    // previous frame's top message is looked up again by id: if it moved, or
    // left the DOM, the view moved.
    const motion = (
      previous: Baseline,
      current: Baseline
    ): { kind: Violation['kind']; delta: number } | null => {
      if (previous.fromBottom <= TOLERANCE_PX) {
        return current.fromBottom <= TOLERANCE_PX
          ? null
          : { kind: 'lost-bottom', delta: current.fromBottom };
      }
      if (previous.anchor === null) return null;
      const previousAnchor = current.scroller.querySelector<HTMLElement>(
        `[data-message-id="${previous.anchor}"]`
      );
      if (!previousAnchor) {
        return {
          kind: 'anchor-moved',
          delta: previous.scrollTop - current.scrollTop,
        };
      }
      const delta =
        previousAnchor.getBoundingClientRect().top -
        current.scroller.getBoundingClientRect().top -
        previous.anchorTop;
      return Math.abs(delta) > TOLERANCE_PX
        ? { kind: 'anchor-moved', delta }
        : null;
    };

    const record = (
      current: Baseline,
      previous: Baseline,
      kind: Violation['kind'],
      delta: number
    ) => {
      report.count += 1;
      report.violations.push({
        kind,
        at: Math.round(performance.now()),
        channel: current.channel,
        anchor: previous.anchor,
        delta: Math.round(delta),
        scrollTop: Math.round(current.scrollTop),
      });
      if (report.violations.length > 20) report.violations.shift();
    };

    // Compare each painted frame with the one before it.
    const sample = () => {
      const current = readFrame();
      const previous = baseline;
      baseline = current;
      // A navigation (another conversation, a jump to a message) mounts or
      // repositions a timeline on purpose; it is loaded anew.
      if (
        !current ||
        !previous ||
        previous.scroller !== current.scroller ||
        previous.url !== current.url
      ) {
        return;
      }

      const now = performance.now();
      // A scrolling click's first frame of motion can paint before its
      // scroll event fires.
      const motionExplained =
        (scrollInputPending && now - lastInputAt < INPUT_SCROLL_DELAY_MS) ||
        now - Math.max(lastScrollInputAt, lastScrollAt) < MOTION_GRACE_MS ||
        now - lastResizeAt < LAYOUT_GRACE_MS;
      const heightExplained =
        now - Math.max(lastInputAt, lastResizeAt) < LAYOUT_GRACE_MS;
      if (!motionExplained) {
        report.checked += 1;
        const moved = motion(previous, current);
        if (moved) record(current, previous, moved.kind, moved.delta);
      }
      if (!heightExplained && current.height !== previous.height) {
        record(current, previous, 'resized', current.height - previous.height);
      }
    };

    // Sample after the frame paints, not in the frame callback, so the
    // sample sees what the user saw.
    const loop = () =>
      requestAnimationFrame(() =>
        setTimeout(() => {
          sample();
          report.frames += 1;
          loop();
        }, 0)
      );
    loop();
  }

  const report = page.__channelProbe;
  return {
    frames: report.frames,
    checked: report.checked,
    count: report.count,
    violations: report.violations.slice(-5),
  };
});

export const channelStaysPutAfterLoad = always(() => probe.current.count === 0);

type Timeline = {
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  above: number;
  below: number;
  height: number;
  /** Mounted messages that end above the visible area, nearest first. */
  aboveIds: string[];
  /** Messages at least partly visible. */
  visibleIds: string[];
} | null;

const timeline = extract((state): Timeline => {
  const scroller = state.document.querySelector<HTMLElement>(
    'main [data-channel-scroll]'
  );
  if (!scroller) return null;
  const rect = scroller.getBoundingClientRect();
  if (rect.height === 0) return null;
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    above: Math.round(scroller.scrollTop),
    below: Math.round(
      scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
    ),
    height: Math.round(rect.height),
    aboveIds: [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
      .filter((message) => message.getBoundingClientRect().bottom < rect.top)
      .map((message) => message.dataset.messageId ?? '')
      .reverse()
      .slice(0, 3),
    visibleIds: [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
      .filter((message) => {
        const box = message.getBoundingClientRect();
        return box.bottom > rect.top && box.top < rect.bottom;
      })
      .map((message) => message.dataset.messageId ?? '')
      .slice(0, 3),
  };
});

// Bombadil's default scroll moves only the window; the timeline is an inner
// scroller, so wheel over its center instead.
const scrollTimeline = actions(() => {
  const current = timeline.current;
  if (!current) return [];
  const origin = { x: current.x, y: current.y };
  const templates: ActionTemplate[] = [];
  if (current.above > 0) {
    templates.push({
      ScrollUp: {
        origin,
        distance: [
          40,
          Math.max(41, Math.min(current.above, current.height * 3)),
        ],
      },
    });
  }
  if (current.below > 0) {
    templates.push({
      ScrollDown: {
        origin,
        distance: [
          40,
          Math.max(41, Math.min(current.below, current.height * 3)),
        ],
      },
    });
  }
  return templates;
});

const channels = [
  manifest.channels.general.id,
  manifest.navigation.genericChannelMention.sourceChannelId,
  manifest.navigation.targetedMessageMention.sourceChannelId,
];

const openChannel = registerCustomAction(
  'openChannel',
  async (_document, window, id: string) => {
    window.location.assign(`/app/channel/${id}`);
  }
);

// Another member writes. Rows arrive or change through the live socket while
// the reader is idle, which is when the view must not move. Content that
// lays out late (link unfurls, images, code blocks) is the classic trigger.
const PEER_MESSAGES = [
  'Short peer message',
  Array.from({ length: 40 }, () => 'a long wrapped peer message').join(' '),
  '```\nfirst line of code\nsecond line of code\nthird line of code\n```',
  'A link that unfurls https://example.com',
  `An image ${local.frontendOrigin}/app/icon.png`,
];

const peerRequest = async (
  window: Window,
  method: string,
  path: string,
  body: Record<string, unknown>
) => {
  const response = await window.fetch(`${local.backendOrigin}/dss${path}`, {
    method,
    headers: {
      authorization: `Bearer ${local.peerToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...body, nonce: window.crypto.randomUUID() }),
  });
  if (!response.ok) {
    throw new Error(`peer ${method} ${path} failed: ${response.status}`);
  }
  return response.json();
};

type PeerWindow = Window & { __peerMessages?: string[] };

const peerPost = registerCustomAction(
  'peerPost',
  async (_document, window, channel: string, content: string) => {
    const posted = await peerRequest(
      window,
      'POST',
      `/messages/channel/${channel}`,
      { content, mentions: [], attachments: [] }
    );
    const page = window as PeerWindow;
    if (posted?.id)
      page.__peerMessages = [...(page.__peerMessages ?? []), posted.id];
  }
);

const peerReply = registerCustomAction(
  'peerReply',
  async (
    _document,
    window,
    channel: string,
    message: string,
    content: string
  ) => {
    await peerRequest(window, 'POST', `/messages/channel/${channel}`, {
      content,
      mentions: [],
      attachments: [],
      thread_id: message,
    });
  }
);

const peerReact = registerCustomAction(
  'peerReact',
  async (_document, window, channel: string, message: string) => {
    await peerRequest(
      window,
      'POST',
      `/messages/channel/${channel}/items/${message}/reactions`,
      { emoji: '👍', add: true }
    );
  }
);

// Edits the peer's own latest message, which grows it by several lines.
const peerEdit = registerCustomAction(
  'peerEdit',
  async (_document, window, channel: string, content: string) => {
    const message = (window as PeerWindow).__peerMessages?.at(-1);
    if (!message) return;
    await peerRequest(
      window,
      'PATCH',
      `/messages/channel/${channel}/items/${message}`,
      { content, mentions: [] }
    );
  }
);

const openMessage = registerCustomAction(
  'openMessage',
  async (_document, window, channel: string, message: string) => {
    window.location.assign(
      `/app/channel/${channel}?channel_message_id=${message}`
    );
  }
);

const focusComposer = registerCustomAction(
  'focusComposer',
  async (document) => {
    document
      .querySelector<HTMLElement>('main [contenteditable="true"]')
      ?.focus();
  }
);

const currentChannel = extract(
  (state) =>
    state.window.location.pathname.match(/\/channels?\/([^/~?]+)/)?.[1] ?? null
);

const within = (value: Range, low: number, high: number) =>
  typeof value === 'number'
    ? value >= low && value <= high
    : value[0] >= low && value[1] <= high;

// Clicks inside the timeline only (reactions, threads, disclosures); the rest
// of the app is out of scope for this property.
const timelineClicks = clicks.filter((action) => {
  const current = timeline.current;
  if (!current || typeof action !== 'object' || !('Click' in action))
    return false;
  const { x, y } = action.Click.point;
  return (
    within(x, current.left, current.right) &&
    within(y, current.top, current.bottom)
  );
});

// Messages in the middle of the general channel's 5,000-message history
// (md5('local-e2e-scroll-<channel>-<n>') in the seed).
const MID_HISTORY_MESSAGES = [
  'a808c813-73cc-27d7-183d-33639f96f542',
  '7a35b969-2813-c9a6-0b20-46110eed3386',
  '0dcb7c0f-f584-5189-39df-f5e064142095',
];

const peerActions = actions(() => {
  const channel = currentChannel.current;
  const current = timeline.current;
  // The peer belongs only to the seeded channels; a request elsewhere is
  // rejected, and a rejected request fails the run.
  if (!channel || !current || !channels.includes(channel)) return [];
  const nearby = [...current.aboveIds, ...current.visibleIds];
  return [
    ...PEER_MESSAGES.map((text) => peerPost(channel, text)),
    ...nearby.map((message) => peerReact(channel, message)),
    ...nearby.map((message) =>
      peerReply(channel, message, PEER_MESSAGES[1] ?? '')
    ),
    peerEdit(channel, `${PEER_MESSAGES[1]}\n\n${PEER_MESSAGES[2]}`),
  ];
});

const typing = actions(() =>
  timeline.current
    ? [focusComposer(), { TypeText: { text: { Regexp: '[a-z ]{40,400}' } } }]
    : []
);

export const explore = weighted([
  [40, scrollTimeline],
  [10, timelineClicks],
  [5, actions(() => channels.map((id) => openChannel(id)))],
  [
    5,
    actions(() =>
      MID_HISTORY_MESSAGES.map((message) =>
        openMessage(manifest.channels.general.id, message)
      )
    ),
  ],
  [25, peerActions],
  [10, typing],
  [
    5,
    actions(() => [
      { SetViewport: { width: 390, height: 844 } },
      { SetViewport: { width: 1280, height: 800 } },
    ]),
  ],
  [5, back],
  [1, forward],
  // Idle time is where drift shows.
  [30, actions(() => ['Wait'])],
]);
