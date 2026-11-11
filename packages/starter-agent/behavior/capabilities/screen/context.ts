/**
 * The screen's real ports: the only place in the area that starts a
 * program, opens a socket, or reads the process table.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { behavior, type ContextOf } from '@macro-inc/muppet/core/behavior';
import type { Base } from '../../context/index.ts';
import type { Started } from '../../context/shell.ts';
import {
  fontDirectories,
  fontsVariable,
  type ScreenConfig,
  screenConfig,
} from './config.ts';
import { cdpJson, openTab } from './context/cdp.ts';
import type { Process, Tab } from './measure.ts';
import {
  type Capture,
  captureArgv,
  cleanEnv,
  cutFrames,
  frameBytes,
  latestFrames,
} from './screen.ts';

export type ScreenPorts = {
  readonly config: ScreenConfig;
  /** JSON from the browser's DevTools address. */
  readonly get: (path: string) => Promise<unknown>;
  /** A new tab in front, on a page. */
  readonly tab: (url: string) => Promise<Tab>;
  /**
   * The display as raw frames. Starts capturing now; `stop()`, or dropping
   * the process, ends it. Nothing captures while nobody's reading.
   */
  readonly capture: (fps?: number) => Capture;
  /** Starts a program on the display, its output going to ours. */
  readonly start: (
    argv: readonly string[],
    env: Readonly<Record<string, string>>
  ) => Started;
  /** Resolves when this process is told to stop (SIGTERM or SIGINT). */
  readonly stopped: () => Promise<void>;
  readonly processes: () => readonly Process[];
  /** CPU seconds this process has used. */
  readonly ownCpu: () => number;
  readonly save: (path: string, frame: Uint8Array) => Promise<void>;
  /** Adds a line to the screen's log. Never throws. */
  readonly log: (entry: object) => Promise<void>;
};

const logStream = 'screen';
const statFile = 'stat';
const commandFile = 'cmdline';
const numeric = /^\d+$/;
const microseconds = 1e6;

/** Every process's parent, CPU ticks and command line. One that ends while it's read is left out. */
const processes =
  (directory: string, join: Base['join']) => (): readonly Process[] =>
    readdirSync(directory).flatMap((name) => {
      if (!numeric.test(name)) return [];
      try {
        // The name can hold spaces and parens: fields count from the last ')'.
        const stat = readFileSync(join(directory, name, statFile), 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        return [
          {
            pid: Number(name),
            parent: Number(fields[1]),
            ticks: Number(fields[11]) + Number(fields[12]),
            command: readFileSync(
              join(directory, name, commandFile),
              'utf8'
            ).replaceAll('\0', ' '),
          },
        ];
      } catch {
        return [];
      }
    });

export const screenPorts = (base: Base): ScreenPorts => {
  const config = screenConfig({
    state: base.state,
    join: base.join,
    fonts: fontDirectories(process.env[fontsVariable]),
  });
  const env = () => cleanEnv(process.env, config.display);
  return {
    config,
    get: (path) => cdpJson(config.cdpPort, path),
    tab: (url) => openTab(config.cdpPort, url),
    capture: (fps = config.fps) => {
      const child = Bun.spawn([...captureArgv(config, fps)], {
        env: env(),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'inherit',
      });
      const size = frameBytes(config);
      return {
        width: config.width,
        height: config.height,
        fps,
        format: 'I420',
        pid: child.pid,
        frames: () => latestFrames(cutFrames(child.stdout, size), size),
        stop: () => child.kill(),
        exited: child.exited,
      };
    },
    start: (argv, extra) => {
      const child = Bun.spawn([...argv], {
        env: { ...env(), ...extra },
        stdin: 'ignore',
        stdout: 'inherit',
        stderr: 'inherit',
      });
      return {
        pid: child.pid,
        exited: child.exited,
        kill: () => child.kill('SIGTERM'),
      };
    },
    stopped: () =>
      new Promise((resolve) => {
        process.once('SIGTERM', () => resolve());
        process.once('SIGINT', () => resolve());
      }),
    processes: processes(config.processes, base.join),
    ownCpu: () => {
      const { user, system } = process.cpuUsage();
      return (user + system) / microseconds;
    },
    save: async (path, frame) => {
      await Bun.write(path, frame);
    },
    log: (entry) => base.log.event(logStream, entry),
  };
};

/** What the screen adds to the agent's context: the share browser's settings and the ports that reach it. */
export const screenContext = (base: Base) =>
  behavior<Base>().decorate({ screen: screenPorts(base) });

export type ScreenContext = ContextOf<ReturnType<typeof screenContext>>;
