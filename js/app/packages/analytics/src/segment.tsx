import { platformFetch } from 'core/util/platformFetch';
import {
  type AllTrackingEventValues,
  TrackingEvents,
} from './types/TrackingEvents';
import { isLocal } from './utils';

// because the compiler inlines values only in the entrypoint module
// these values need to be set from the caller
let appVersion = '';
let isNightly = '';
let isDemo = '';

// esbuild define inlines 'define' values at compile time so these setters are required for runtime in nodejs
export function setAppVersion(val: string | undefined) {
  appVersion = val ?? '';
}
export function setIsNightly(val: string | undefined) {
  isNightly = val ?? 'false';
}
export function setDemo(val: string = 'false') {
  isDemo = val;
}

let _userId: string | undefined;
let _groupId: string | undefined;
let _anonymousId: string | undefined;
let _writeKey: string | undefined;

export function setSegmentWriteKey(writeKey: string | undefined) {
  if (!writeKey) return;
  _writeKey = writeKey;
  return;
}

async function setAnonId() {
  if (_anonymousId) {
    // _anonymousId already set
    return;
  }

  try {
    // crypto.randomUUID() is only available in secure contexts (HTTPS)
    _anonymousId = crypto.randomUUID();
  } catch (e) {
    console.error(e);
  }
}

const idProm = setAnonId();

function getAnonId() {
  return _anonymousId;
}

type Identity =
  | { anonymousId: string | undefined; userId: undefined }
  | { anonymousId: string | undefined; userId: string };

function getId(): Identity {
  return _userId == null
    ? { anonymousId: _anonymousId, userId: undefined }
    : // pass the old anonymousId so that segment can retroactively associate userId with anonId
      { anonymousId: _anonymousId, userId: _userId };
}

function getPage() {
  const s = window.location.href.split('#');
  return {
    path: window.location.pathname,
    referrer: document.referrer,
    search: window.location.search,
    title: s.at(-1) ?? '',
    url: s.at(0) ?? '',
  };
}

function getContext(identified?: true) {
  return {
    library: {
      name: '@coparse/analytics',
      version: 'v0.1',
    },
    userAgent: navigator.userAgent,
    page: getPage(),
    active: identified,
    groupId: _groupId,
    appVersion: appVersion,
    beta: isNightly.toString(),
    demo: isDemo,
  };
}

// Replace batching logic with immediate send
async function sendEvent(
  type: 'identify' | 'group' | 'track' | 'page' | 'alias',
  props: { [k: string]: any }
): Promise<void> {
  if (!_writeKey) {
    // console.log('no write key set, not sending analytics');
    return;
  }

  const encoded = window.btoa(`${_writeKey}:`);

  const event = {
    type,
    ...getId(),
    ...props,
    properties: {
      ...props.properties,
      appVersion: appVersion,
      beta: isNightly.toString(),
      demo: isDemo,
    },
    context: getContext(),
    timestamp: new Date().toISOString(),
  };

  const url = new URL('https://analytics.macro.com');
  url.pathname = '/v1/batch';

  try {
    await platformFetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${encoded}`,
      },
      keepalive: true,
      body: JSON.stringify({
        batch: [event],
      }),
    });
  } catch (e) {
    console.error('Error sending analytics: ', e);
  }
}

function identify(userId: string, traits?: any): void;
function identify(traits: any): void;

function identify(
  ...args: [userId: string, traits?: any] | [traits: any]
): void {
  if (args.length === 2) {
    const [userId, traits] = args;
    _userId = userId;

    sendEvent('identify', { userId, traits });
  } else {
    const [traits] = args;
    sendEvent('identify', { traits });
  }
}

function group(groupId: string, traits?: any): void {
  sendEvent('group', {
    groupId,
    traits,
  });
}

async function track(
  event: AllTrackingEventValues,
  properties?: { [k: string]: any }
): Promise<void> {
  return idProm.then(() => {
    if (!_anonymousId) {
      console.warn("tried to track event but couldn't get anon id");
    }
    sendEvent('track', {
      event,
      properties,
    });
  });
}

function page(name: string, properties?: { [k: string]: any }): void;
function page(
  category: string,
  name: string,
  properties?: { [k: string]: any }
): void;

function page(
  ...args:
    | [name: string, properties?: any]
    | [category: string, name: string, properites?: any]
) {
  if (args.length > 2) {
    const [category, name, properties] = args;
    sendEvent('page', { category, name, properties });
  } else {
    const [name, properties] = args;
    sendEvent('page', { name, properties });
  }
}

function alias(userId: string, previousId?: string): void {
  previousId = previousId ?? _userId;

  if (previousId == null) {
    return;
  }

  _userId = userId;

  sendEvent('alias', { userId, previousId });
}

function setUserId(id: string) {
  _userId = id;
}

/**
 * called when the react app is about to be detroyed
 * no longer needs to flush batch since we're sending immediately
 */
async function terminateClient(): Promise<void> {
  return;
}

const client = {
  track,
  identify,
  group,
  page,
  alias,
  terminateClient,
  setUserId,
  getAnonId,
  TrackingEvents,
};

const doNothing: (..._args: any[]) => void = () => {};
const doNothingAsyc: (..._args: any[]) => Promise<void> = () =>
  Promise.resolve();
const mockClient: typeof client = {
  track: doNothingAsyc,
  identify: doNothing,
  group: doNothing,
  page: doNothing,
  alias: doNothing,
  terminateClient: doNothingAsyc,
  setUserId: doNothing,
  getAnonId: () => undefined,
  TrackingEvents,
};

export function withAnalytics() {
  if (isLocal()) {
    return mockClient;
  }
  return client;
}
