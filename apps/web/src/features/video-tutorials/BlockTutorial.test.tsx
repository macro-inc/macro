import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TUTORIALS } from './catalog';
import {
  hasTutorial,
  TutorialPill,
  TutorialRow,
  TutorialSidebarItem,
} from './views/BlockTutorial';

// The app's platform: the web app unless a test says otherwise.
const platform = vi.hoisted(() => ({
  tauri: false,
  nativeMobile: undefined as 'ios' | 'android' | undefined,
}));
vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  isTauri: () => platform.tauri,
  getNativeMobilePlatform: () => platform.nativeMobile,
}));

const track = vi.hoisted(() => vi.fn());
vi.mock('@app/lib/analytics', () => ({ analytics: { track } }));

// The app's channel list and split router, as the dialog's support link reads them.
const channelList = vi.hoisted(() => ({
  channels: [] as (Pick<ApiChannelWithLatest, 'id' | 'name' | 'owner_id'> &
    Partial<Pick<ApiChannelWithLatest, 'updated_at'>>)[],
}));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({
    channels: () => channelList.channels,
    isLoading: () => false,
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|ada@acme.test',
}));
const openWithSplit = vi.hoisted(() => vi.fn());
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit }),
}));

const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

beforeEach(() => {
  platform.tauri = false;
  platform.nativeMobile = undefined;
  localStorage.clear();
  channelList.channels = [];
  openWithSplit.mockClear();
  track.mockClear();
  play.mockClear();
  pause.mockClear();
  // jsdom has no layout observers (the shelf measures its row) or scrolling.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  // jsdom has no media playback.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: play,
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: pause,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const row = () =>
  screen.queryByRole('button', { name: /Learn how to use Macro Mail/ });
const video = () => document.querySelector('video');
const playButton = () => screen.getByRole('button', { name: /^Play / });
// jsdom keeps Kobalte's dialog mounted for its exit; it is closed once marked so.
const dialogClosed = () =>
  screen.queryByRole('dialog')?.hasAttribute('data-closed') ?? true;

describe('block tutorial row', () => {
  it('opens the video paused and plays it only from the play button', async () => {
    render(() => <TutorialRow tutorial="mail" />);

    fireEvent.click(row()!);
    await screen.findByRole('dialog');
    expect(play).not.toHaveBeenCalled();
    // The play pill names the video and shows its presenter and length.
    const pill = screen.getByRole('button', {
      name: 'Play Learn how to use Macro Mail, 1:42',
    });
    expect(pill.textContent).toContain('Jacob Beckerman');
    expect(pill.textContent).toContain('Watch demo · 1:42');
    expect(video()?.autoplay).toBe(false);
    expect(video()?.controls).toBe(false);

    fireEvent.click(pill);
    expect(play).toHaveBeenCalledTimes(1);
    expect(video()?.controls).toBe(true);
    expect(document.activeElement).toBe(video());
  });

  it('counts a play once, when playback really starts', async () => {
    render(() => <TutorialRow tutorial="mail" />);

    fireEvent.click(row()!);
    await screen.findByRole('dialog');
    fireEvent.click(playButton());
    const played = () =>
      track.mock.calls.filter(([, payload]) => payload.action === 'played');
    expect(played()).toHaveLength(0);

    fireEvent.playing(video()!);
    fireEvent.playing(video()!);
    expect(played()).toHaveLength(1);
  });

  it('closes on Escape once playing and pauses the video', async () => {
    render(() => <TutorialRow tutorial="mail" />);

    fireEvent.click(row()!);
    await screen.findByRole('dialog');
    fireEvent.click(playButton());
    fireEvent.keyDown(video()!, { key: 'Escape' });

    expect(pause).toHaveBeenCalled();
    await waitFor(() => expect(dialogClosed()).toBe(true));
  });

  it('stays dismissed on this device', () => {
    const first = render(() => <TutorialRow tutorial="mail" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(row()).toBeNull();
    first.unmount();

    render(() => <TutorialRow tutorial="mail" />);
    expect(row()).toBeNull();
  });
});

describe('shelf after a video ends', () => {
  it('offers the other tutorials and switches to one, paused', async () => {
    render(() => <TutorialRow tutorial="mail" />);
    fireEvent.click(row()!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(playButton());
    fireEvent.playing(video()!);
    expect(screen.queryByText('More videos from Macro')).toBeNull();

    fireEvent.ended(video()!);

    screen.getByText('More videos from Macro');
    expect(
      screen.queryByRole('button', { name: /^Learn how to use Macro Mail,/ })
    ).toBeNull();
    expect(video()?.controls).toBe(false);

    fireEvent.click(
      screen.getByRole('button', { name: /^Learn how to use Macro CRM,/ })
    );

    expect(screen.queryByText('More videos from Macro')).toBeNull();
    expect(dialog.textContent).toContain('Learn how to use Macro CRM');
    expect(video()?.getAttribute('src')).toBe(TUTORIALS.crm?.videoUrl);
    expect(document.activeElement).toBe(playButton());
    expect(track).toHaveBeenLastCalledWith('tutorial_video', {
      tutorial: 'macro-crm',
      action: 'opened',
    });

    // Plays of the new video count for it.
    fireEvent.click(playButton());
    fireEvent.playing(video()!);
    expect(track).toHaveBeenLastCalledWith('tutorial_video', {
      tutorial: 'macro-crm',
      action: 'played',
    });
  });

  it('replays the video from the start', async () => {
    render(() => <TutorialRow tutorial="mail" />);
    fireEvent.click(row()!);
    await screen.findByRole('dialog');
    fireEvent.click(playButton());
    fireEvent.ended(video()!);
    video()!.currentTime = 80;
    play.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));

    expect(play).toHaveBeenCalledTimes(1);
    expect(video()?.currentTime).toBe(0);
    expect(screen.queryByText('More videos from Macro')).toBeNull();
  });
});

describe('support link under the video', () => {
  it("opens the person's support channel and closes the dialog", async () => {
    channelList.channels = [
      { id: 'general', name: 'general', owner_id: 'macro|ada@acme.test' },
      {
        id: 'someone-elses-support',
        name: 'Macro Support x grace',
        owner_id: 'macro|grace@acme.test',
      },
      {
        id: 'support-ada',
        name: 'Macro Support x ada',
        owner_id: 'macro|ada@acme.test',
      },
    ];
    render(() => <TutorialPill tutorial="crm" />);
    fireEvent.click(
      screen.getByRole('button', { name: /Learn how to use Macro CRM/ })
    );
    await screen.findByRole('dialog');
    screen.getByText('Have questions about Macro CRM?');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Talk to us in your support channel →',
      })
    );

    expect(openWithSplit).toHaveBeenCalledWith(
      { type: 'channel', id: 'support-ada' },
      { activate: true }
    );
    expect(track).toHaveBeenCalledWith('tutorial_video', {
      tutorial: 'macro-crm',
      action: 'support_clicked',
    });
    await waitFor(() => expect(dialogClosed()).toBe(true));
  });

  it("opens a Macro team member's most recently active support channel", async () => {
    // A Macro team member is in customers' support channels but owns none.
    channelList.channels = [
      {
        id: 'older-support',
        name: 'Macro Support x grace',
        owner_id: 'macro|grace@acme.test',
        updated_at: '2026-11-01T10:00:00Z',
      },
      {
        id: 'recent-support',
        name: 'Macro Support x lin',
        owner_id: 'macro|lin@acme.test',
        updated_at: '2026-11-04T10:00:00Z',
      },
    ];
    render(() => <TutorialRow tutorial="mail" />);
    fireEvent.click(row()!);
    await screen.findByRole('dialog');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Talk to us in your support channel →',
      })
    );
    expect(openWithSplit).toHaveBeenCalledWith(
      { type: 'channel', id: 'recent-support' },
      { activate: true }
    );
  });

  it('leaves the lip out when the person is in no support channel', async () => {
    channelList.channels = [
      { id: 'general', name: 'general', owner_id: 'macro|ada@acme.test' },
    ];
    render(() => <TutorialRow tutorial="mail" />);
    fireEvent.click(row()!);
    await screen.findByRole('dialog');

    expect(screen.queryByText('Have questions about Macro Mail?')).toBeNull();
  });
});

describe('block tutorial pill', () => {
  it('opens the same paused video and dismisses separately from other tutorials', async () => {
    render(() => <TutorialPill tutorial="mail" />);
    fireEvent.click(
      screen.getByRole('button', { name: /Learn how to use Macro Mail/ })
    );
    await screen.findByRole('dialog');
    expect(play).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('tutorial_video', {
      tutorial: 'macro-mail',
      action: 'opened',
    });
  });

  it('renders nothing for a block whose video is not in the catalog yet', () => {
    // Every block gets a video eventually, so take one out for this test.
    const scheduling = TUTORIALS.scheduling;
    delete TUTORIALS.scheduling;
    try {
      render(() => <TutorialPill tutorial="scheduling" />);
      expect(screen.queryByRole('button')).toBeNull();
    } finally {
      TUTORIALS.scheduling = scheduling;
    }
  });
});

describe('block tutorial sidebar item', () => {
  it('names its block among other tutorials and opens that video', async () => {
    render(() => (
      <>
        <TutorialSidebarItem tutorial="docs" named />
        <TutorialSidebarItem tutorial="spreadsheets" named />
      </>
    ));
    const spreadsheets = screen.getByRole('button', {
      name: 'Watch tutorial: Learn how to use Macro Spreadsheets, 0:56',
    });
    expect(spreadsheets.textContent).toContain('Macro Spreadsheets');
    expect(spreadsheets.textContent).not.toContain('Watch tutorial');

    fireEvent.click(spreadsheets);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Learn how to use Macro Spreadsheets');
    expect(video()?.getAttribute('src')).toBe(TUTORIALS.spreadsheets?.videoUrl);
    expect(track).toHaveBeenCalledWith('tutorial_video', {
      tutorial: 'macro-spreadsheets',
      action: 'opened',
    });
  });

  it('says "Watch tutorial" on its own', () => {
    render(() => <TutorialSidebarItem tutorial="docs" />);
    const docs = screen.getByRole('button', {
      name: /Learn how to use Macro Docs/,
    });
    expect(docs.textContent).toContain('Watch tutorial');
  });
});

describe('in the native apps', () => {
  it.each(['ios', 'android'] as const)(
    'renders no entry in the %s app',
    (nativeMobile) => {
      platform.tauri = true;
      platform.nativeMobile = nativeMobile;
      render(() => (
        <>
          <TutorialRow tutorial="mail" />
          <TutorialPill tutorial="crm" />
          <TutorialSidebarItem tutorial="docs" named />
        </>
      ));

      expect(screen.queryByRole('button')).toBeNull();
      expect(hasTutorial('mail')).toBe(false);
    }
  );

  it('streams the video and poster from the web app in the desktop app', async () => {
    // The desktop app's bundle has no videos; a built one loads them from macro.com.
    vi.stubEnv('DEV', false);
    platform.tauri = true;
    render(() => <TutorialRow tutorial="mail" />);
    expect(hasTutorial('mail')).toBe(true);

    fireEvent.click(row()!);
    await screen.findByRole('dialog');

    const served = (asset: string | undefined) =>
      new URL(asset!, 'https://macro.com').href;
    expect(video()?.getAttribute('src')).toBe(served(TUTORIALS.mail?.videoUrl));
    expect(video()?.getAttribute('poster')).toBe(
      served(TUTORIALS.mail?.posterUrl)
    );
  });
});
