/**
 * bin/agent: the agent from the command line.
 *
 *   bin/agent run                     run the agent: listen for events until stopped
 *   bin/agent list                    its catalog, one line per capability
 *   bin/agent describe <name>...      full docs of capabilities, or of single functions
 *   bin/agent <function> [json|-]     call a function of a capability; its output is printed as JSON
 *   bin/agent exec <file|->           type-check and run a code-mode script, as RunCapabilityScript does
 *   bin/agent guard                   a Claude Code PreToolUse hook: hold a tool call to the agent's guards
 *
 * A function called here runs in its own process, with the same context and
 * state as the running agent, so anything it can do in a wake, or a
 * person can do from a shell. It is called by a one-line script, so its JSON
 * input is type-checked like any script's: a mistyped flag, or input the
 * function doesn't take, is refused before anything runs.
 *
 * Everything it needs is in its environment (`behavior/context/startup.ts`);
 * without it, it exits 78. `run` exits 0 when stopped.
 */
// Bun before 1.4.2 has no Temporal: drop the polyfill once the repo's Bun has it.
import { Telemetry } from '@macro-inc/observability/core';
import {
  startTelemetry,
  trace,
  underParent,
} from './behavior/context/telemetry.ts';
import 'temporal-polyfill/global';
import {
  describe,
  moduleOf,
  summarize,
} from '@macro-inc/muppet/core/capability';
import { calling, execute, resultLine } from '@macro-inc/muppet/core/code';
import { parallel } from '@macro-inc/muppet/runtimes/parallel';
import { z } from 'zod';
import { refusal } from './behavior/agent/guard.ts';
import { guards } from './behavior/agent/guards/index.ts';
import { stayOnline } from './behavior/capabilities/chat/presence.ts';
import { markHealthy } from './behavior/capabilities/heartbeat/restart.ts';
import { ensureSchedules } from './behavior/capabilities/heartbeat/schedules.ts';
import { macroKey } from './behavior/context/index.ts';
import { exitCodes } from './behavior/context/startup.ts';
import { ensureIntroduction } from './behavior/events/handlers/identity.ts';
import {
  assistant,
  base,
  claude,
  launcherFiles,
  resultFlag,
  sandboxProgram,
  scripts,
  wiring,
} from './index.ts';

const usage =
  'usage: bin/agent <run|list|describe|exec|guard|function> [input]';
const presenceLog = 'presence';
const openState = 1;

const [command, ...rest] = process.argv.slice(2);

/** An argument, or all of stdin when it is `-`. Never stdin unasked: a hook or a script leaves it open, and the read would wait forever. */
const input = async (argument: string | undefined): Promise<string> =>
  argument === '-' ? await Bun.stdin.text() : (argument ?? '');

const print = (value: unknown): void => {
  console.log(
    typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  );
};

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const Hook = z.object({
  tool_name: z.string(),
  tool_input: z.unknown(),
  cwd: z.string(),
});

/** The value, or the process ends with the configuration exit code: what is missing isn't the code's fault. */
const configuredOrExit = async <Value>(
  value: () => Promise<Value> | Value
): Promise<Value> => {
  try {
    return await value();
  } catch (error) {
    console.error(
      `can't start: ${error instanceof Error ? error.message : String(error)}`
    );
    return process.exit(exitCodes.configuration);
  }
};

const run = async (): Promise<void> => {
  // Everything the agent needs to run is checked before anything starts,
  // including the files it tells its launcher through (`launcherFiles`): a
  // healthy boot, or a restart onto code it landed.
  const files = launcherFiles();
  await configuredOrExit(claude);
  await configuredOrExit(sandboxProgram);
  const { presence } = await configuredOrExit(wiring.addresses);
  const apiKey = await configuredOrExit(() => base.credentials.get(macroKey));
  process.on('SIGTERM', () => {
    void Telemetry.flush().finally(() => process.exit(exitCodes.stopped));
  });
  // The agent shows online in Macro for as long as it runs.
  stayOnline({
    open: () => {
      const socket = new WebSocket(presence, {
        headers: { 'x-macro-user-api-key': apiKey },
      });
      return {
        send: (data) => socket.send(data),
        isOpen: () => socket.readyState === openState,
        onOpen: (handle) => socket.addEventListener('open', handle),
        onClose: (handle) =>
          socket.addEventListener('close', ({ code, reason }) =>
            handle(code, reason)
          ),
      };
    },
    log: (entry) => void base.log.event(presenceLog, entry),
  });
  // The standing schedules exist before anything fires; ones the agent changed are left alone.
  await ensureSchedules(assistant.decorations.schedules);
  // A new agent's first wake is to ask its owner who it is.
  await ensureIntroduction(base, assistant.decorations.schedules);
  const running = assistant.run(
    parallel({
      systemPrompt: (await base.disk.read(base.config.charter)) ?? '',
      ...scripts,
    })
  );
  // Built, credentials read, presence open and sources started: a healthy
  // boot, so the launcher's rollback starts from this HEAD.
  await markHealthy({
    git: (args) => base.shell.run(['git', '-C', base.config.root, ...args]),
    disk: base.disk,
    file: files.lastGood,
  });
  await running;
};

// Spans export only when the computer names an OTLP endpoint.
await startTelemetry({ environment: process.env, agent: base.config.me });

switch (command) {
  case undefined:
    fail(usage);
    break;
  case 'run':
    await run();
    break;
  case 'list':
    print(summarize(assistant.capabilities));
    break;
  case 'describe':
    print(await describe(assistant.capabilities, rest, scripts.signatures));
    break;
  case 'exec': {
    // With the flag, the result is one marked line, for the agent's process that ran this one.
    const marked = rest[0] === resultFlag;
    const [file] = marked ? rest.slice(1) : rest;
    const source =
      file === undefined || file === '-'
        ? await Bun.stdin.text()
        : await Bun.file(file).text();
    // Under the agent process's script span, so the run is one trace.
    const executed = await underParent(process.env, () =>
      trace('agent.capability_script.exec', async (span) => {
        const ran = await execute(assistant.decorations, scripts.load)(source);
        span.set('agent.script_outcome', ran.kind);
        return ran;
      })
    );
    await Telemetry.flush();
    if (marked) process.stdout.write(resultLine(executed));
    else print(executed);
    process.exit(executed.kind === 'succeeded' ? 0 : 1);
    break;
  }
  case 'guard': {
    const hook = Hook.safeParse(JSON.parse(await Bun.stdin.text()));
    const reason = hook.success
      ? refusal(guards, {
          tool: hook.data.tool_name,
          input: hook.data.tool_input,
          cwd: hook.data.cwd,
          environment: process.env,
        })
      : undefined;
    if (reason !== undefined)
      print({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      });
    process.exit(0);
    break;
  }
  default: {
    const owner = moduleOf(assistant.capabilities, command);
    if (owner === undefined) {
      const capability = assistant.capabilities[command];
      fail(
        capability === undefined
          ? `${command} is not a function of a capability, or a command\n${usage}`
          : `${command} is a ${capability.kind}, not a function: ${capability.summary}`
      );
      break;
    }
    const text = (await input(rest[0])).trim();
    const executed = await execute(
      assistant.decorations,
      scripts.load
    )(
      calling(
        scripts.script,
        { file: owner.file, name: command },
        text === '' ? undefined : JSON.parse(text)
      )
    );
    if (executed.kind === 'failed')
      fail(`${command} failed: ${executed.error}`);
    else print(executed.output);
    process.exit(0);
  }
}
