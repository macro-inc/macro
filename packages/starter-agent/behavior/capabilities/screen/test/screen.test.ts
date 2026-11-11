import { expect, test } from 'bun:test';
import type { Started } from '../../../context/shell.ts';
import { fontDirectories, screenConfig } from '../config.ts';
import {
  captureArgv,
  chromiumArgv,
  cleanEnv,
  clearStaleDisplay,
  cutFrames,
  fontsConf,
  frameBytes,
  latestFrames,
  pulseArgv,
  pulseEnv,
  recordArgv,
  type ServePorts,
  serve,
  status,
  xvfbArgv,
} from '../screen.ts';

const join = (...parts: readonly string[]) => parts.join('/');
const state = {
  private: (owner: string) => `/state/private/${owner}`,
  run: (owner: string) => `/state/run/${owner}`,
};
const config = {
  ...screenConfig({ state, join, fonts: fontDirectories('/n/cjk:/n/emoji') }),
  width: 1280,
  height: 720,
};

/** A turn of the event loop, so everything already queued runs. No real waiting. */
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('it has its own display and loopback port, and the lock and socket follow the display', () => {
  expect(config.display).toBe(':96');
  expect(config.cdpPort).toBe(9335);
  expect(config.lock).toBe('/tmp/.X96-lock');
  expect(config.socket).toBe('/tmp/.X11-unix/X96');
});

test('programs are named, never store paths, and the profile is private state', () => {
  for (const program of [
    config.xvfb,
    config.chromium,
    config.ffmpeg,
    config.pulseaudio,
    config.parec,
  ])
    expect(program).not.toContain('/');
  expect(config.profile).toBe('/state/private/screen/profile');
});

test("the browser's sound goes to one private sink, which a share records", () => {
  const argv = pulseArgv(config);
  // No default.pa: no real sound card, no other sink, nobody's speakers.
  expect(argv).toContain('-n');
  expect(argv).toContain('--daemonize=no');
  expect(argv).toContain(
    'module-native-protocol-unix socket=/state/run/screen/sound/native auth-anonymous=1 auth-cookie-enabled=0'
  );
  expect(argv).toContain(
    'module-null-sink sink_name=share rate=48000 channels=2'
  );
  expect(pulseEnv(config)).toEqual({
    PULSE_RUNTIME_PATH: '/state/run/screen/sound',
    PULSE_STATE_PATH: '/state/run/screen/sound',
  });
  expect(recordArgv(config, 20)).toEqual([
    'parec',
    '--server=unix:/state/run/screen/sound/native',
    '--device=share.monitor',
    '--raw',
    '--format=s16le',
    '--rate=48000',
    '--channels=2',
    '--latency-msec=20',
  ]);
});

test('the screen programs get the baseline on their display, and no library path or credentials', () => {
  // A session's LD_LIBRARY_PATH made ffmpeg and Chromium die on GLIBC_2.43.
  const env = cleanEnv(
    {
      LD_LIBRARY_PATH: '/old/lib',
      LD_PRELOAD: 'x.so',
      HOME: '/h',
      MUPPET_CREDENTIALS_FILE: '/run/agent.env',
      DISPLAY: ':1',
    },
    ':96'
  );
  expect(env).toEqual({ HOME: '/h', DISPLAY: ':96' });
});

test('the browser keeps its sandbox, its own profile, and no browser UI', () => {
  const argv = chromiumArgv(config);
  expect(argv).not.toContain('--no-sandbox');
  expect(argv).toContain('--user-data-dir=/state/private/screen/profile');
  expect(argv).toContain('--kiosk');
  expect(argv).toContain('--remote-debugging-port=9335');
  expect(
    argv.some((flag) => flag.startsWith('--remote-debugging-address'))
  ).toBe(false);
});

test('the window is 1 px over, so no black edge shows', () => {
  expect(chromiumArgv(config)).toContain('--window-size=1281,721');
});

test('the page is composited in software, with SwiftShader only for WebGL', () => {
  // GPU raster through SwiftShader took 13 cores and fell to 20 fps.
  const argv = chromiumArgv(config);
  for (const flag of [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-gpu-compositing',
    '--disable-gpu-rasterization',
  ])
    expect(argv).toContain(flag);
});

test('fonts add to the system config, one dir per pinned font', () => {
  // CJK and emoji drew as boxes with the system's fonts alone.
  expect(config.fonts).toEqual(['/n/cjk', '/n/emoji']);
  const conf = fontsConf(config.systemFonts, config.fonts);
  expect(conf).toContain('/etc/fonts/fonts.conf');
  expect(conf).toContain('<dir>/n/cjk</dir>\n  <dir>/n/emoji</dir>');
  expect(fontDirectories(undefined)).toEqual([]);
});

test('Xvfb stays off the network', () => {
  expect(xvfbArgv(config).join(' ')).toContain('-nolisten tcp');
  expect(xvfbArgv(config).join(' ')).toContain('1280x720x24');
});

test('capture is raw I420 of the configured size on stdout', () => {
  const argv = captureArgv(config, 15).join(' ');
  expect(argv).toContain('-framerate 15 -video_size 1280x720');
  expect(argv).toContain('-pix_fmt yuv420p -f rawvideo pipe:1');
  expect(frameBytes(config)).toBe(1382400);
});

test('frames come out whole however the pipe splits them', async () => {
  async function* chunks() {
    yield new Uint8Array([1, 2, 3]);
    yield new Uint8Array([4]);
    yield new Uint8Array([5, 6, 7, 8, 9]);
  }
  const seen: number[][] = [];
  for await (const frame of cutFrames(chunks(), 4)) seen.push([...frame]);
  expect(seen).toEqual([
    [1, 2, 3, 4],
    [5, 6, 7, 8],
  ]);
});

test('a slow reader gets the newest frame, not a backlog', async () => {
  // ffmpeg queued 2.6s of frames behind a reader taking 100ms a frame.
  async function* source() {
    for (let i = 1; i <= 20; i++) yield new Uint8Array([i]);
  }
  const seen: number[] = [];
  for await (const frame of latestFrames(source(), 1)) {
    seen.push(frame[0] ?? 0);
    // The reader falls behind: the source runs on while it is away.
    await turn();
  }
  expect(seen.length).toBeLessThan(8);
  expect(seen.at(-1)).toBe(20);
  // Each step jumps past what it missed.
  expect((seen[1] ?? 0) - (seen[0] ?? 0)).toBeGreaterThan(2);
});

test('a reader keeping up misses nothing', async () => {
  async function* source() {
    for (let i = 1; i <= 5; i++) {
      yield new Uint8Array([i]);
      await turn();
    }
  }
  const seen: number[] = [];
  for await (const frame of latestFrames(source(), 1)) seen.push(frame[0] ?? 0);
  expect(seen).toEqual([1, 2, 3, 4, 5]);
});

/** A fake machine for the service: a disk of files, and children that live until killed or told to die. */
const machine = (files: Record<string, string> = {}) => {
  const disk = new Map(Object.entries(files));
  const started: {
    readonly program: string;
    readonly env: Readonly<Record<string, string>>;
    readonly die: (code: number) => void;
    killed: boolean;
  }[] = [];
  const log: string[] = [];
  let stop = () => {};
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const ports: ServePorts = {
    config,
    disk: {
      read: async (path) => disk.get(path),
      write: async (path, text) => void disk.set(path, text),
      exists: async (path) => disk.has(path),
      remove: async (path) => void disk.delete(path),
      makeDirectory: async (path) => void disk.set(path, ''),
    },
    clock: { sleep: turn },
    alive: (pid) => pid === 4242,
    start: (argv, env): Started => {
      const program = argv[0] ?? '';
      let die = (_code: number) => {};
      const exited = new Promise<number>((resolve) => {
        die = resolve;
      });
      const child = { program, env, die, killed: false };
      started.push(child);
      // Xvfb opens its socket once it is up, and takes it away when it goes.
      if (program === config.xvfb) {
        disk.set(config.socket, '');
        void exited.then(() => disk.delete(config.socket));
      }
      // So does the sound server.
      if (program === config.pulseaudio) {
        disk.set(config.sound.socket, '');
        void exited.then(() => disk.delete(config.sound.socket));
      }
      return {
        pid: started.length,
        exited,
        kill: () => {
          child.killed = true;
          die(143);
        },
      };
    },
    stopped,
    log: async ({ event }) => void log.push(event),
  };
  return { ports, disk, started, log, stop };
};

const settle = async () => {
  for (let i = 0; i < 20; i++) await turn();
};

test('the service starts Xvfb and the sound server, then Chromium on both, with the fonts, and stops all when told', async () => {
  const { ports, disk, started, stop } = machine();
  const serving = serve(ports);
  await settle();
  expect(started.map(({ program }) => program)).toEqual([
    'Xvfb',
    'pulseaudio',
    'chromium',
  ]);
  expect(started[2]?.env).toEqual({
    FONTCONFIG_FILE: config.fontsFile,
    PULSE_SERVER: 'unix:/state/run/screen/sound/native',
  });
  expect(disk.get(config.fontsFile)).toContain('<dir>/n/cjk</dir>');
  expect(disk.has(config.profile)).toBe(true);
  stop();
  expect(await serving).toBe(1);
  expect(started.every(({ killed }) => killed)).toBe(true);
});

test('when any dies, all are stopped and started again', async () => {
  const { ports, started, log, stop } = machine();
  const serving = serve(ports);
  await settle();
  started[2]?.die(1);
  await settle();
  // Chromium died: Xvfb and the sound server were killed too, and a fresh three are up.
  expect(started[0]?.killed).toBe(true);
  expect(started[1]?.killed).toBe(true);
  expect(started.map(({ program }) => program)).toEqual([
    'Xvfb',
    'pulseaudio',
    'chromium',
    'Xvfb',
    'pulseaudio',
    'chromium',
  ]);
  // The sound server died: a page would play into nothing, so Chromium goes too.
  started[4]?.die(1);
  await settle();
  expect(started[5]?.killed).toBe(true);
  expect(started).toHaveLength(9);
  expect(log.filter((event) => event === 'died')).toHaveLength(2);
  stop();
  expect(await serving).toBe(3);
});

test("a sound socket a killed server left behind isn't taken for a live one", async () => {
  const { ports, started, disk, stop } = machine({
    [config.sound.socket]: '',
  });
  const pulse = ports.start;
  // A server that never opens its socket.
  const silent: ServePorts = {
    ...ports,
    start: (argv, env) => {
      const child = pulse(argv, env);
      if (argv[0] === config.pulseaudio) disk.delete(config.sound.socket);
      return child;
    },
  };
  const serving = serve(silent);
  await settle();
  expect(started.map(({ program }) => program)).toEqual(['Xvfb', 'pulseaudio']);
  stop();
  await serving;
});

test("a dead Xvfb's lock is cleared; a live one's is left alone", async () => {
  // A killed Xvfb leaves its lock behind and the next one refuses to start.
  const stale = machine({ [config.lock]: '      1234\n', [config.socket]: '' });
  await clearStaleDisplay(stale.ports);
  expect(stale.disk.has(config.lock)).toBe(false);
  expect(stale.disk.has(config.socket)).toBe(false);
  const held = machine({ [config.lock]: '      4242\n' });
  expect(clearStaleDisplay(held.ports)).rejects.toThrow('held by pid 4242');
  expect(serve(held.ports)).rejects.toThrow('held by pid 4242');
  expect(held.started).toHaveLength(0);
});

test('status says up with how to reach it, and down when the port is silent', async () => {
  const up = await status({
    config,
    get: async (path) =>
      path === '/json/version'
        ? { Browser: 'Chrome/1' }
        : [{ type: 'page' }, { type: 'service_worker' }, { type: 'page' }],
  });
  expect(up).toMatchObject({
    up: true,
    browser: 'Chrome/1',
    pages: 2,
    cdp: 'http://127.0.0.1:9335',
    display: ':96',
    frames: { format: 'I420', width: 1280, height: 720, frameBytes: 1382400 },
  });
  const down = await status({
    config,
    get: async () => {
      throw new Error('refused');
    },
  });
  expect(down).toEqual({
    up: false,
    cdp: 'http://127.0.0.1:9335',
    display: ':96',
  });
});
