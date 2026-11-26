import type { Readiness } from './measure';
import type { CapturedSpan } from './otlp';
import type { TargetItem, TargetKey, Targets } from './targets';

/** An expression evaluated in the page that returns the elements to tap. */
type Target = (targets: Targets) => string;

export type Step = {
  id: string;
  target: Target;
  ready: Readiness;
  /** The route must contain this once the step is ready. */
  route: (targets: Targets) => string;
  /** The targets-file item the step opens, recorded with its sample. */
  opens?: TargetKey;
  /** The item a back step leaves, whose size its time depends on: recorded too. */
  leaves?: TargetKey;
};

export type Scenario = {
  /** Taps that bring the app to the scenario's start, untimed. */
  prepare?: Target[];
  /** The route must contain this once prepared, or the run stops. */
  preparedRoute?: string;
  /**
   * Items the steps open. Preparing finds each one's row (choosing among a
   * key's candidates) and fails when none is there to open.
   */
  opens?: TargetKey[];
  /** Run once cold, then again warm, in one fresh process. */
  steps?: Step[];
};

const quote = (value: string) => JSON.stringify(value);

const button = (label: string) => () =>
  `document.querySelectorAll(${quote(`button[aria-label=${quote(label)}]`)})`;

const tab = (label: string) => () =>
  `[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === ${quote(label)})`;

/** A row's unread markers: an unread rail, a pin's dot, a mention count. */
export const UNREAD = '[data-unread="true"], [aria-label*="unread" i]';

/** Thrown in the page when a list holds no row with the title. */
export const NOT_IN_LIST = 'is not in the list';

/** Thrown in the page when the row shows unread items. */
export const SHOWS_UNREAD = 'shows unread items';

/**
 * List rows titled `name`. Lists are virtual, so a row far down is not in
 * the page until the list scrolls to it: when none is rendered, this scrolls
 * the list from the top until one is (reading further pages as the list
 * does), and marks the page as moved so the step waits for the list to come
 * to rest before its timed tap. Refuses a row that shows unread items:
 * opening it would mark them read, and the harness never writes.
 */
export function row(item: TargetItem | undefined, key: string) {
  if (!item)
    return `(() => { throw new Error('Set ${key} in the targets file'); })()`;
  return `(async () => {
    const title = ${quote(item.name)};
    const matching = () => [...document.querySelectorAll('[data-soup-entity]')].filter(
      (element) => element.innerText.split('\\n')[0].trim() === title
    );
    const rendered = (rows) => rows.some((element) => element.getBoundingClientRect().height > 0);
    const checked = (rows) => {
      if (rows.some((element) => element.querySelector(${quote(UNREAD)})))
        throw new Error('${key} ${SHOWS_UNREAD}; pick one with none');
      return rows;
    };
    let rows = matching();
    if (rendered(rows)) return checked(rows);
    // The list under the first row a touch would reach; hidden views keep copies.
    const reachable = [...document.querySelectorAll('[data-soup-entity]')].find((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.height === 0) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit && element.contains(hit);
    });
    let scroller = reachable?.parentElement;
    while (scroller && !(/auto|scroll/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight + 1))
      scroller = scroller.parentElement;
    // No list yet: the caller tries again.
    if (!scroller) return checked(rows);
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    const pause = (ms) => new Promise((done) => setTimeout(done, ms));
    window.__macroBenchmarkMoved = true;
    scroller.scrollTop = 0;
    await frame();
    await frame();
    // Inside the DevTools call's own 30 s limit.
    const deadline = Date.now() + 20000;
    let still = 0;
    while (Date.now() < deadline) {
      rows = matching();
      if (rendered(rows)) return checked(rows);
      const top = scroller.scrollTop;
      const height = scroller.scrollHeight;
      scroller.scrollTop = top + scroller.clientHeight * 0.75;
      await frame();
      await frame();
      if (scroller.scrollTop !== top || scroller.scrollHeight !== height) still = 0;
      // At the end while a next page loads: wait for it, within the deadline.
      else if (document.querySelector('[aria-busy="true"]')) await pause(150);
      // At the end and idle: give a next page about three seconds to start.
      else if (++still > 20) break;
      else await pause(150);
    }
    throw new Error('${key} ${NOT_IN_LIST}' + (Date.now() >= deadline ? ' (searched 20 s)' : ''));
  })()`;
}

const navigation = (span: CapturedSpan) => span.name === 'navigation';

const opened = (entityType: string) => (span: CapturedSpan) =>
  span.name === 'list.open' && span.attributes['entity.type'] === entityType;

const documentEditor = (span: CapturedSpan) => span.name === 'doc.editor';

/**
 * Dock buttons (their English labels), the route each one opens, and content
 * that must be on screen too before the view counts as ready.
 */
const VIEWS: { id: string; label: string; route: string; content?: string }[] = [
  { id: 'channels', label: 'Chat', route: '#/channels' },
  { id: 'mail', label: 'Email', route: '#/mail' },
  { id: 'calendar', label: 'Calendar', route: '#/calendar' },
  { id: 'agents', label: 'Agents', route: '#/agents' },
  { id: 'files', label: 'Files', route: '#/drive' },
  {
    id: 'notifications',
    label: 'Notifications',
    route: '#/notifications',
    // The view reports ready with the feed's skeleton; its rows load later.
    content: '[data-notification-row]',
  },
];

const back = (id: string, route: string, leaves?: TargetKey): Step => ({
  id,
  target: button('Go Back'),
  ready: { root: navigation },
  route: () => route,
  leaves,
});

export const SCENARIOS: Record<string, Scenario> = {
  'cold-start': {},
  views: {
    steps: VIEWS.map((view) => ({
      id: `view.${view.id}`,
      target: button(view.label),
      ready: { root: navigation, visible: view.content },
      route: () => view.route,
    })),
  },
  channel: {
    prepare: [button('Chat')],
    preparedRoute: '#/channels',
    opens: ['channel'],
    steps: [
      {
        id: 'channel.open',
        target: (targets) => row(targets.channel, 'channel'),
        ready: { root: opened('channel') },
        route: (targets) => `/channel/${targets.channel?.id}`,
        opens: 'channel',
      },
      back('channel.back', '#/channels', 'channel'),
    ],
  },
  document: {
    // On phones Shared with me is in the Files sidebar.
    prepare: [button('Files'), button('Show sidebar'), tab('Shared with me')],
    preparedRoute: '#/drive/shared',
    opens: ['smallDocument', 'largeDocument'],
    steps: [
      {
        id: 'document.small.open',
        target: (targets) => row(targets.smallDocument, 'smallDocument'),
        ready: { root: opened('document'), also: [documentEditor] },
        route: (targets) => `/md/${targets.smallDocument?.id}`,
        opens: 'smallDocument',
      },
      back('document.back', '#/drive/shared'),
      {
        id: 'document.large.open',
        target: (targets) => row(targets.largeDocument, 'largeDocument'),
        ready: { root: opened('document'), also: [documentEditor] },
        route: (targets) => `/md/${targets.largeDocument?.id}`,
        opens: 'largeDocument',
      },
      back('document.back', '#/drive/shared'),
    ],
  },
};
