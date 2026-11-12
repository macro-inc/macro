/**
 * @vitest-environment jsdom
 *
 * Each `loadPage` is a new page of a tab whose sessionStorage is what this
 * test's storage holds at that moment: the next page after a reload, or a
 * tab duplicated or opened from this one, which the browser gives a copy.
 * Pages talk over real BroadcastChannels and each keeps its own page events.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { holdMobile, holdScreen, MOBILE_DEVICES } from './tests/device';
import { agentNavigationRunsHere } from './ui-client';

const device = vi.hoisted(() => ({ nativeApp: false, touch: false }));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => device.nativeApp,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@core/constant/featureFlags')>();
  return {
    ...actual,
    isFeatureEnabled: (flag: unknown) => flag === actual.enableAgentNavigation,
  };
});

const NativeChannel = globalThis.BroadcastChannel;
const opened: BroadcastChannel[] = [];
let recording: BroadcastChannel[] | undefined;

/** Records which page opened each channel, so a page can crash. */
class RecordedChannel extends NativeChannel {
  constructor(name: string) {
    super(name);
    opened.push(this);
    recording?.push(this);
  }
}

type Page = {
  id: () => string;
  /** The page goes; `persisted` keeps it in the back/forward cache. */
  leave: (persisted: boolean) => void;
  returnFromCache: () => void;
  /** The page dies without `pagehide`: a crash, a discarded tab. */
  crash: () => void;
};

function asPage<T>(channels: BroadcastChannel[], run: () => T): T {
  recording = channels;
  try {
    return run();
  } finally {
    recording = undefined;
  }
}

async function loadPage(): Promise<Page> {
  vi.resetModules();
  const { uiClientId } = await import('./ui-client');
  const channels: BroadcastChannel[] = [];
  const events = new EventTarget();
  const listen = vi
    .spyOn(window, 'addEventListener')
    .mockImplementation((type, listener) =>
      events.addEventListener(type, listener)
    );
  asPage(channels, uiClientId);
  listen.mockRestore();

  return {
    id: uiClientId,
    leave: (persisted) => {
      events.dispatchEvent(new PageTransitionEvent('pagehide', { persisted }));
    },
    returnFromCache: () =>
      asPage(channels, () =>
        events.dispatchEvent(
          new PageTransitionEvent('pageshow', { persisted: true })
        )
      ),
    crash: () => {
      for (const channel of channels) channel.close();
    },
  };
}

/** Long enough for any page to answer a hello. */
const answered = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeAll(() => vi.stubGlobal('BroadcastChannel', RecordedChannel));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => sessionStorage.clear());
afterEach(() => {
  for (const channel of opened.splice(0)) channel.close();
  vi.restoreAllMocks();
  vi.stubGlobal('BroadcastChannel', RecordedChannel);
});

describe('uiClientId', () => {
  it('stays the same through the life of a page', async () => {
    const page = await loadPage();

    expect(page.id()).toBe(page.id());
  });

  it('survives a reload of the tab', async () => {
    const before = await loadPage();
    const id = before.id();
    before.leave(false);

    const after = await loadPage();
    await answered();

    expect(after.id()).toBe(id);
  });

  it('survives a reload after the page died without pagehide', async () => {
    const before = await loadPage();
    const id = before.id();
    before.crash();

    const after = await loadPage();
    await answered();

    expect(after.id()).toBe(id);
  });

  it('still gives an id when storage and channels are refused', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor() {
          throw new DOMException('denied', 'SecurityError');
        }
      }
    );

    const page = await loadPage();

    expect(page.id()).toMatch(/^[0-9a-f-]{36}$/);
    expect(page.id()).toBe(page.id());
  });

  it('gives a tab duplicated or opened from this one its own id', async () => {
    const original = await loadPage();
    const id = original.id();

    const copy = await loadPage();

    await vi.waitFor(() => expect(copy.id()).not.toBe(id));
    expect(original.id()).toBe(id);

    // The copy's own reloads keep its new id.
    const minted = copy.id();
    copy.leave(false);
    expect((await loadPage()).id()).toBe(minted);
  });

  it('gives the copy its own id once the original comes back from the back/forward cache', async () => {
    const original = await loadPage();
    const id = original.id();
    original.leave(true);
    const copy = await loadPage();
    await answered();
    expect(copy.id()).toBe(id);

    original.returnFromCache();

    await vi.waitFor(() => expect(copy.id()).not.toBe(id));
    expect(original.id()).toBe(id);
  });
});

describe('agentNavigationRunsHere', () => {
  afterEach(() => {
    device.nativeApp = false;
    device.touch = false;
  });

  it.each([
    { on: 'a phone held upright', touch: true, size: [390, 844], runs: false },
    { on: 'a phone held sideways', touch: true, size: [844, 390], runs: false },
    { on: 'a touch tablet', touch: true, size: [820, 1180], runs: true },
    { on: 'a 639px touch screen', touch: true, size: [639, 960], runs: false },
    { on: 'a 640px touch screen', touch: true, size: [960, 640], runs: true },
    { on: 'a desktop', touch: false, size: [1512, 982], runs: true },
  ] as const)('on $on: $runs', ({ touch, size: [width, height], runs }) => {
    device.touch = touch;
    holdScreen(width, height);

    expect(agentNavigationRunsHere()).toBe(runs);
  });

  it('never runs in the native apps, iPad included', () => {
    device.nativeApp = true;
    device.touch = true;
    holdScreen(1024, 1366);

    expect(agentNavigationRunsHere()).toBe(false);
  });
});

describe('startUiClientId', () => {
  // The page's own listeners stay off the shared window.
  beforeEach(() => {
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
  });

  it('takes the id and joins the channel as the app starts', async () => {
    vi.resetModules();
    const { startUiClientId, typedInClientId } = await import('./ui-client');

    startUiClientId();

    expect(opened).toHaveLength(1);
    const stored = sessionStorage.getItem('macro.ui-client-id');
    expect(stored).toMatch(/^[0-9a-f-]{36}$/);
    expect(typedInClientId()).toBe(stored);
  });

  it.each(MOBILE_DEVICES)(
    'starts neither the id nor its channel on $on, nor sends one',
    async (mobile) => {
      holdMobile(device, mobile);
      vi.resetModules();
      const { startUiClientId, typedInClientId } = await import('./ui-client');

      startUiClientId();

      expect(typedInClientId()).toBeUndefined();
      expect(opened).toEqual([]);
      expect(sessionStorage.getItem('macro.ui-client-id')).toBeNull();
    }
  );
});
