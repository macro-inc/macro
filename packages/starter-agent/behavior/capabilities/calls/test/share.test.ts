import { expect, test } from 'bun:test';
import { Room } from '@livekit/rtc-node';
import { passthrough } from '../../../agent/claude.ts';
import {
  callShare,
  type FrameFeed,
  latestFrameQueue,
  makeShare,
  type SharePorts,
  startRule,
} from '../share.ts';
import type { ShareNeeds } from '../types.ts';

/** Never connected: only handed from the call to its own `publish`. */
const room = new Room();

/** A turn of the event loop, so everything already queued runs. */
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const field = (data: Readonly<Record<string, unknown>> | undefined): string => {
  const value = data?.reason ?? data?.rule ?? data?.host ?? '';
  return typeof value === 'string' ? value : '';
};

const setup = (
  needs: Partial<ShareNeeds> = {},
  ports: Partial<SharePorts> = {}
) => {
  const log: string[] = [];
  const feed: FrameFeed = {
    stop: async () => {
      log.push('feed-stop');
    },
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise(() => {}),
      return: async () => ({ done: true, value: undefined }),
    }),
  };
  const share = callShare(
    {
      room: () => room,
      publish: async () => {
        log.push('publish');
        return {
          stop: async () => {
            log.push('unpublish');
          },
          stopped: new Promise(() => {}),
        };
      },
      say: async (line) => {
        log.push(`say:${line}`);
      },
      uninvited: false,
      emit: (name, data) => {
        log.push(`${name}:${field(data)}`);
      },
      ...needs,
    },
    {
      show: async (url) => {
        log.push(`show:${url}`);
      },
      frames: () => {
        log.push('frames');
        return feed;
      },
      trace: passthrough,
      ...ports,
    }
  );
  return { share, log };
};

/** A `show` that waits to be let through. */
const held = () => {
  const gate: { release: () => void } = { release: () => {} };
  const show = () =>
    new Promise<void>((resolve) => {
      gate.release = resolve;
    });
  return { gate, show };
};

test('the desktop as it is: said out loud before it publishes, and stopped with a line', async () => {
  const { share, log } = setup();
  expect(await share.tools.share_screen()).toBe(
    "Sharing your screen. It's already been said out loud: don't announce it again."
  );
  expect(log.indexOf("say:I'm sharing my screen.")).toBeLessThan(
    log.indexOf('publish')
  );
  expect(log.some((line) => line.startsWith('show:'))).toBe(false);
  expect(await share.tools.stop_share()).toBe('Stopped sharing.');
  expect(log).toContain('unpublish');
  expect(log).toContain('feed-stop');
  expect(log.at(-1)).toBe('say:Stopped sharing.');
});

test('with a url, the page is put in front in the browser before the capture starts', async () => {
  const { share, log } = setup();
  await share.tools.share_screen('https://example.com/a?b=1');
  expect(log.indexOf('show:https://example.com/a?b=1')).toBeLessThan(
    log.indexOf('frames')
  );
  expect(log).toContain('share.start:example.com');
});

test('refused when the agent joined uninvited, and nothing opens', async () => {
  const { share, log } = setup({ uninvited: true });
  expect(await share.tools.share_screen('https://example.com/')).toBe(
    'Refused: uninvited.'
  );
  expect(log).toEqual(['share.refused:uninvited']);
});

test('only web pages are put in front', () => {
  for (const url of ['file:///etc/passwd', 'chrome://settings', 'javascript:1'])
    expect(startRule({ url, uninvited: false, active: false })).toEqual({
      ok: false,
      rule: 'scheme',
    });
  expect(startRule({ uninvited: false, active: false })).toEqual({ ok: true });
});

test('stopping without a share says nothing', async () => {
  const { share, log } = setup();
  expect(await share.tools.stop_share()).toBe('Stopped sharing.');
  expect(log).toEqual([]);
});

test('the call ending stops the share without saying so', async () => {
  const { share, log } = setup();
  await share.tools.share_screen();
  await share.stop();
  expect(log).toContain('share.stop:call-end');
  expect(log).toContain('feed-stop');
  expect(log).not.toContain('say:Stopped sharing.');
});

test('the publication ending stops the share', async () => {
  const ended: { now: () => void } = { now: () => {} };
  const { share, log } = setup({
    publish: async () => ({
      stop: async () => {},
      stopped: new Promise<void>((resolve) => {
        ended.now = resolve;
      }),
    }),
  });
  await share.tools.share_screen();
  ended.now();
  await turn();
  expect(log).toContain('share.stop:publication-ended');
  expect(log).toContain('feed-stop');
});

test('a stop while the page is being put in front abandons the start', async () => {
  const { gate, show } = held();
  const { share, log } = setup({}, { show });
  const starting = share.tools.share_screen('https://example.com');
  await turn();
  await share.stop();
  gate.release();
  expect(await starting).toContain('start-failed');
  expect(log).not.toContain('frames');
  expect(log).not.toContain('publish');
});

test('latest frame queue drops old frames and releases a parked next on stop', async () => {
  const queue = latestFrameQueue(2, 2);
  const frames = queue[Symbol.asyncIterator]();
  queue.push(new Uint8Array([1]));
  queue.push(new Uint8Array([2]));
  const newest = await frames.next();
  expect(newest.done === true ? undefined : newest.value.data[0]).toBe(2);
  const parked = frames.next();
  await frames.return?.();
  expect((await parked).done).toBe(true);
});

test('one share starts at a time', async () => {
  const { gate, show } = held();
  const { share } = setup({}, { show });
  const first = share.tools.share_screen('https://example.com');
  expect(await share.tools.share_screen()).toContain('already-sharing');
  gate.release();
  await first;
  await share.stop();
});

test('each failed start releases what it acquired', async () => {
  const failing = (what: string) => async () => {
    throw new Error(what);
  };
  for (const failed of ['show', 'frames', 'say', 'publish']) {
    const { share, log } =
      failed === 'show'
        ? setup({}, { show: failing('show') })
        : failed === 'frames'
          ? setup(
              {},
              {
                frames: () => {
                  throw new Error('frames');
                },
              }
            )
          : failed === 'say'
            ? setup({ say: failing('say') })
            : setup({ publish: failing('publish') });
    expect(await share.tools.share_screen('https://example.com')).toContain(
      'start-failed'
    );
    if (failed === 'say' || failed === 'publish')
      expect(log).toContain('feed-stop');
    expect(log).not.toContain('unpublish');
  }
});

test('a share is a screen.share span with its host and whether it went up, never the path', async () => {
  const fields: Record<string, unknown> = {};
  const names: string[] = [];
  const { share } = setup(
    { uninvited: true },
    {
      trace: (name, run) => {
        names.push(name);
        return run({
          set: (key, value) => {
            fields[key] = value;
          },
          traceparent: () => undefined,
        });
      },
    }
  );
  await share.tools.share_screen('https://example.com/a?token=x');
  expect(names).toEqual(['screen.share']);
  expect(fields).toEqual({
    'share.host': 'example.com',
    'share.started': false,
  });
});

test('every call gets its own sharing from the same ports', async () => {
  const log: string[] = [];
  const make = makeShare({
    show: async () => {},
    frames: () => {
      throw new Error('frames');
    },
    trace: passthrough,
  });
  const share = make({
    room: () => room,
    publish: async () => {
      throw new Error('unused');
    },
    say: async () => {},
    uninvited: true,
    emit: (name) => {
      log.push(name);
    },
  });
  expect(await share.tools.share_screen('https://example.com/')).toBe(
    'Refused: uninvited.'
  );
  expect(log).toEqual(['share.refused']);
});

/** A sound port that logs what it's asked, and fails when told to. */
const sound = (log: string[], fails = false): SharePorts['sound'] => {
  return async (given) => {
    expect(given).toBe(room);
    if (fails) throw new Error('no sink');
    log.push('sound');
    return {
      stop: async () => {
        log.push('sound-stop');
      },
    };
  };
};

test("a share sends the desktop's sound, and stopping stops it", async () => {
  const log: string[] = [];
  const { share, log: shared } = setup({}, { sound: sound(log) });
  expect(
    await share.tools.share_screen('https://www.youtube.com/')
  ).toStartWith('Sharing');
  expect(log).toEqual(['sound']);
  expect(shared).toContain('share.start:www.youtube.com');
  await share.tools.stop_share();
  expect(log).toEqual(['sound', 'sound-stop']);
  // Once: a second stop has nothing left to stop.
  await share.stop();
  expect(log).toEqual(['sound', 'sound-stop']);
});

test('a share whose sound fails still shows the screen', async () => {
  const log: string[] = [];
  const { share, log: shared } = setup({}, { sound: sound(log, true) });
  expect(await share.tools.share_screen('https://example.com/')).toStartWith(
    'Sharing'
  );
  expect(shared).toContain('share.sound-failed:');
  expect(shared).toContain('share.start:example.com');
  await share.stop();
  expect(shared).toContain('unpublish');
});

test('sound that arrives after the share was stopped is stopped at once', async () => {
  const log: string[] = [];
  const gate: { open: () => void } = { open: () => {} };
  const { share } = setup(
    {},
    {
      sound: async () => {
        await new Promise<void>((resolve) => {
          gate.open = resolve;
        });
        log.push('sound');
        return {
          stop: async () => {
            log.push('sound-stop');
          },
        };
      },
    }
  );
  const starting = share.tools.share_screen('https://example.com/');
  for (let i = 0; i < 20; i++) await turn();
  await share.tools.stop_share();
  gate.open();
  expect(await starting).toStartWith('Refused');
  expect(log).toEqual(['sound', 'sound-stop']);
});
