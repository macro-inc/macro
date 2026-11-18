/**
 * The agent's entrypoint: builds its real context and its behavior from the
 * environment it was started with (`behavior/context/startup.ts`). `cli.ts`
 * runs it, or calls one of its capabilities from outside the running process.
 * A configuration it can't start with ends the process with exit code 78.
 */
// Bun before 1.4.2 has no Temporal: drop the polyfill once the repo's Bun has it.
import 'temporal-polyfill/global';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { query, type SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { inSubprocess } from '@macro-inc/muppet/core/code';
import type { Scripts } from '@macro-inc/muppet/runtimes/pieces';
import { checker, loader } from '@macro-inc/muppet/utilities/scripts';
import typescript from 'typescript';
import { authorized } from './behavior/agent/authority.ts';
import {
  budgeted,
  capped,
  fileLedger,
  recordSpend,
} from './behavior/agent/budget.ts';
import { agentClaude, capabilityServer } from './behavior/agent/claude.ts';
import { guards } from './behavior/agent/guards/index.ts';
import { profile } from './behavior/agent/profile.ts';
import { restarter } from './behavior/capabilities/heartbeat/restart.ts';
import { childEnvironment, claude } from './behavior/context/children.ts';
import { base as makeBase } from './behavior/context/index.ts';
import { timedOut } from './behavior/context/shell.ts';
import {
  type Configured,
  exitCodes,
  type RunFiles,
  runFiles,
  startup,
} from './behavior/context/startup.ts';
import {
  telemetryEnvironment,
  trace,
  traceparentVariable,
} from './behavior/context/telemetry.ts';
import { assistant as makeAgent } from './behavior/index.ts';

const wakesLog = 'wakes';
const budgetOwner = 'budget';
/** Where a script's process finds the wake it runs in (the secrets capability's session id). */
const wakeVariable = 'MUPPET_WAKE_ID';
const restartVariable = 'MUPPET_RESTART_FILE';
/** The flag that makes `cli.ts exec` print its result for `inSubprocess` to read. */
export const resultFlag = '--result-line';

/** The value, or the process ends with the configuration exit code, saying what is wrong. */
const orExit = <Value>(configured: Configured<Value>): Value => {
  if (configured.kind === 'configured') return configured.value;
  console.error(`can't start: ${configured.message}`);
  return process.exit(exitCodes.configuration);
};

const started = orExit(startup(process.env, [capabilityServer]));
const built = orExit(makeBase(started));

export const base = built.base;
export const wiring = built.wiring;

/** The files `cli.ts run` tells its launcher through: the last good HEAD, and the restart marker. */
export const launcherFiles = (): RunFiles => orExit(runFiles(process.env));

// A land can happen in any of the agent's processes (a script, `bin/agent`),
// so asking for a restart only touches the supervisor's marker, whose path
// unit restarts the service; no process exits on its own. The path is passed
// on to every child, and is no secret.
const restartFile = process.env[restartVariable];
const launcher: Readonly<Record<string, string>> =
  restartFile === undefined ? {} : { [restartVariable]: restartFile };
const restart =
  restartFile === undefined
    ? undefined
    : restarter({
        disk: base.disk,
        file: restartFile,
        clock: base.clock,
        exit: () => undefined,
      });

export { claude };

/** Bubblewrap, which the image provides when children run sandboxed. */
export const sandboxProgram = (): string | undefined => {
  const [program] = started.sandbox;
  if (program === undefined) return undefined;
  const found = Bun.which(program);
  if (found === null) throw new Error(`${program} is not on PATH`);
  return found;
};

// One type checker for the life of the process: the first script pays for
// reading the agent's code, and each one after costs only its own check.
const check = checker({ typescript, config: base.config.tsconfig });

const load = loader({
  directory: base.config.scripts,
  script: { file: base.config.scriptType, name: 'Script' },
  check: async (files) => check.check(files),
  id: () => crypto.randomUUID(),
  write: async (path, text) => {
    await Bun.write(path, text);
  },
  remove: (path) => rm(path, { force: true }),
  load: (path) => import(path),
});

// A script the agent writes runs in a process of its own, with none of this
// one's environment or credentials: `cli.ts exec`, which type-checks it the
// same way, and reaches Macro through this process's relay. Each script that
// passes is written to the repository, so it can import its packages, under
// a fresh name, and only for as long as it takes to import it.
export const scripts: Scripts = {
  script: { file: base.config.scriptType, name: 'Script' },
  load,
  signatures: async (file, names) => check.signatures(file, names),
  run: inSubprocess({
    timeoutMs: base.config.scriptTimeoutMs,
    run: (source, { timeoutMs, wakeId }) =>
      trace('agent.capability_script', async (span) => {
        if (wakeId !== undefined) span.set('agent.wake_id', wakeId);
        const parent = span.traceparent();
        const ran = await base.shell.run(
          [
            ...started.sandbox,
            process.execPath,
            base.config.cli,
            'exec',
            resultFlag,
            '-',
          ],
          {
            cwd: base.config.root,
            stdin: source,
            env: {
              ...(await wiring.relayed()),
              ...launcher,
              ...(wakeId === undefined ? {} : { [wakeVariable]: wakeId }),
              ...(parent === undefined
                ? {}
                : { [traceparentVariable]: parent }),
              ...telemetryEnvironment(process.env),
            },
            timeoutMs,
          }
        );
        span.set(
          'agent.script_outcome',
          ran.code === timedOut
            ? 'timed_out'
            : ran.code === 0
              ? 'exited'
              : 'failed'
        );
        return ran.code === timedOut
          ? { kind: 'timedOut', stdout: ran.stdout, stderr: ran.stderr }
          : { kind: 'exited', ...ran };
      }),
  }),
};

const ledger = fileLedger({
  disk: base.disk,
  join: base.join,
  directory: base.state.run(budgetOwner),
});
const spend = recordSpend({
  ledger,
  clock: base.clock,
  timeZone: base.config.timeZone,
});

// Claude gets the baseline, a way back into this agent with no key, how it
// reaches Anthropic, and its git identity: nothing else of this process.
const claudeEnvironment = async () =>
  childEnvironment(process.env, {
    ...(await wiring.relayed()),
    ...launcher,
    ...(await wiring.claudeAccess()),
    ...(await base.environment()),
  });
const claudeSandbox = {
  argv: started.sandbox,
  spawn: (
    [command = '', ...args]: readonly string[],
    { cwd, env, signal }: Omit<SpawnOptions, 'command' | 'args'>
  ) =>
    spawn(command, args, {
      cwd,
      env,
      signal,
      stdio: ['pipe', 'pipe', 'inherit'],
    }),
};

const claudeAgent = agentClaude({
  query,
  claude,
  mcpServers: started.mcpServers,
  model: base.config.model,
  profile: capped(profile(base.config), base.config.budget.perRunUsd),
  environment: claudeEnvironment,
  after: (milliseconds, run) => {
    const timer = setTimeout(run, milliseconds);
    return () => clearTimeout(timer);
  },
  guards,
  wakeId: () => Bun.randomUUIDv7(),
  trace,
  sandbox: claudeSandbox,
  record: async (entry) => {
    await base.log.event(wakesLog, entry);
    await spend(entry);
  },
});

// Every wake first decides who its owner is, then is held to the owner's daily
// cap, on a ledger that outlives restarts.
export const agent = authorized({
  agent: budgeted({
    agent: claudeAgent,
    ledger,
    caps: base.config.budget,
    clock: base.clock,
    timeZone: base.config.timeZone,
  }),
  authority: base.authority,
});

// An appraisal of people runs Claude Code as a wake does, on the same ledger.
export const assistant = makeAgent(
  base,
  agent,
  {
    executable: claude,
    environment: claudeEnvironment,
    sandbox: claudeSandbox,
    spend,
  },
  restart
);
