/**
 * The processes a watcher deals with: finding the agent's joins among everything
 * running, signalling one, and starting one.
 */

import type { Config } from '../../../context/config.ts';
import type { Disk } from '../../../context/disk.ts';
import type { Shell, Started } from '../../../context/shell.ts';
import { telemetryEnvironment } from '../../../context/telemetry.ts';
import { type CallsPaths, joinCapability } from '../config.ts';
import type { JoinInput } from '../join.ts';
import type { LeaveSignal } from '../watch.ts';

/** Where Linux lists processes, and the file holding one's arguments. */
const processDirectory = '/proc';
const argumentsFile = 'cmdline';
const binDirectory = 'bin';
const agentProgram = 'assistant';
const cliFile = 'cli.ts';

/** The file every process of this agent runs: what a join's arguments are matched against. */
export const cliPath = (
  config: Pick<Config, 'root'>,
  join: (...parts: readonly string[]) => string
): string => join(config.root, cliFile);

/** Every process on the machine with its arguments. One that exits mid-scan, or isn't readable, is skipped. */
export const running =
  ({
    disk,
    join,
    directory = processDirectory,
  }: {
    readonly disk: Pick<Disk, 'list' | 'read'>;
    readonly join: (...parts: readonly string[]) => string;
    readonly directory?: string;
  }) =>
  async (): Promise<
    readonly { readonly pid: number; readonly argv: readonly string[] }[]
  > =>
    (
      await Promise.all(
        (
          await disk.list(directory)
        )
          .filter((name) => /^\d+$/.test(name))
          .map(async (name) => {
            const text = await disk
              .read(join(directory, name, argumentsFile))
              .catch(() => undefined);
            return text === undefined
              ? []
              : [{ pid: Number(name), argv: text.split('\0') }];
          })
      )
    ).flat();

/** Signals a process. Nothing happens if it's already gone. */
export const signal = (pid: number, name: LeaveSignal): void => {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone.
  }
};

/**
 * A command with its stdout and stderr going to files through a `cat` each.
 * Pointed straight at a file, every LiveKit log line is a blocking write on
 * the call's thread, and a loaded disk stalls it for seconds. The cats are their
 * own processes, so only if 64 KB piles up behind a stuck disk does a log
 * line wait.
 */
export const withLogs = (
  command: readonly string[],
  out: string,
  errors: string
): readonly string[] => [
  'bash',
  '-c',
  'o=$1 e=$2; shift 2; exec "$@" > >(exec cat >"$o") 2> >(exec cat >"$e")',
  '_',
  out,
  errors,
  ...command,
];

/**
 * Starts a join as its own process: `bin/agent joinCall '<json>'`, detached,
 * so a call outlives a restart of the watcher, which finds it again by its
 * arguments.
 */
export const startJoin =
  ({
    shell,
    disk,
    config,
    paths,
    join,
    relayed,
  }: {
    readonly shell: Pick<Shell, 'start'>;
    /** What makes the join's process the agent's, reaching Macro through its relay. */
    readonly relayed: () => Promise<Readonly<Record<string, string>>>;
    readonly disk: Pick<Disk, 'makeDirectory'>;
    readonly config: Pick<Config, 'root'>;
    readonly paths: Pick<CallsPaths, 'call' | 'joinLog' | 'joinErrors'>;
    readonly join: (...parts: readonly string[]) => string;
  }) =>
  async (input: JoinInput): Promise<Pick<Started, 'pid' | 'exited'>> => {
    const id = input.callId ?? input.id;
    // The logs' directory must exist before bash opens them.
    await disk.makeDirectory(paths.call(id));
    return shell.start(
      withLogs(
        [
          join(config.root, binDirectory, agentProgram),
          joinCapability,
          JSON.stringify(input),
        ],
        paths.joinLog(id),
        paths.joinErrors(id)
      ),
      {
        cwd: config.root,
        // rtc-node logs debug lines to stdout otherwise.
        env: {
          ...(await relayed()),
          ...telemetryEnvironment(process.env),
          NODE_ENV: 'production',
        },
        detached: true,
      }
    );
  };
