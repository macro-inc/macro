import type { Readiness } from './measure';
import type { CapturedSpan } from './otlp';

/** An item to open: its exact list title, and its id to check the route. */
export type TargetItem = { name: string; id: string };

/**
 * Account-specific items to open. They name real content, so they live in a
 * file outside the repository (see README.md).
 */
export type Targets = {
  /** A channel with no unread messages, so opening it marks nothing read. */
  channel?: TargetItem;
  /** Both documents must be listed under Files › Shared with me. */
  smallDocument?: TargetItem;
  largeDocument?: TargetItem;
};

/** An expression evaluated in the page that returns the elements to tap. */
type Target = (targets: Targets) => string;

export type Step = {
  id: string;
  target: Target;
  ready: Readiness;
  /** The route must contain this once the step is ready. */
  route: (targets: Targets) => string;
};

export type Scenario = {
  /** Taps that bring the app to the scenario's start, untimed. */
  prepare?: Target[];
  /** Run once cold, then again warm, in one fresh process. */
  steps?: Step[];
};

const quote = (value: string) => JSON.stringify(value);

const button = (label: string) => () =>
  `document.querySelectorAll(${quote(`button[aria-label=${quote(label)}]`)})`;

const tab = (label: string) => () =>
  `[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === ${quote(label)})`;

/**
 * List rows titled `name`. Refuses a row that shows unread items: opening it
 * would mark them read, and the harness never writes.
 */
function row(item: TargetItem | undefined, key: string) {
  if (!item)
    return `(() => { throw new Error('Set ${key} in the targets file'); })()`;
  return `(() => {
    const rows = [...document.querySelectorAll('[data-soup-entity]')].filter(
      (element) => element.innerText.split('\\n')[0].trim() === ${quote(item.name)}
    );
    if (rows.some((element) => element.querySelector('[data-unread="true"], [aria-label*="unread" i]')))
      throw new Error('${key} shows unread items; pick one with none');
    return rows;
  })()`;
}

const navigation = (span: CapturedSpan) => span.name === 'navigation';

const opened = (entityType: string) => (span: CapturedSpan) =>
  span.name === 'list.open' && span.attributes['entity.type'] === entityType;

const documentEditor = (span: CapturedSpan) => span.name === 'doc.editor';

/** Dock buttons (their English labels) and the route each one opens. */
const VIEWS = [
  { id: 'channels', label: 'Chat', route: '#/channels' },
  { id: 'mail', label: 'Email', route: '#/mail' },
  { id: 'calendar', label: 'Calendar', route: '#/calendar' },
  { id: 'agents', label: 'Agents', route: '#/agents' },
  { id: 'files', label: 'Files', route: '#/drive' },
  { id: 'notifications', label: 'Notifications', route: '#/notifications' },
];

const back = (id: string, route: string): Step => ({
  id,
  target: button('Go Back'),
  ready: { root: navigation },
  route: () => route,
});

export const SCENARIOS: Record<string, Scenario> = {
  'cold-start': {},
  views: {
    steps: VIEWS.map((view) => ({
      id: `view.${view.id}`,
      target: button(view.label),
      ready: { root: navigation },
      route: () => view.route,
    })),
  },
  channel: {
    prepare: [button('Chat')],
    steps: [
      {
        id: 'channel.open',
        target: (targets) => row(targets.channel, 'channel'),
        ready: { root: opened('channel') },
        route: (targets) => `/channel/${targets.channel?.id}`,
      },
      back('channel.back', '#/channels'),
    ],
  },
  document: {
    prepare: [button('Files'), tab('Shared with me')],
    steps: [
      {
        id: 'document.small.open',
        target: (targets) => row(targets.smallDocument, 'smallDocument'),
        ready: { root: opened('document'), also: [documentEditor] },
        route: (targets) => `/md/${targets.smallDocument?.id}`,
      },
      back('document.back', '#/drive/shared'),
      {
        id: 'document.large.open',
        target: (targets) => row(targets.largeDocument, 'largeDocument'),
        ready: { root: opened('document'), also: [documentEditor] },
        route: (targets) => `/md/${targets.largeDocument?.id}`,
      },
      back('document.back', '#/drive/shared'),
    ],
  },
};
