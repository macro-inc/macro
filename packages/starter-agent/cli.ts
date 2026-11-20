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
  traceStart,
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
import {
  onlineRoute,
  reportsOnline,
} from './behavior/capabilities/chat/online.ts';
import { stayOnline } from './behavior/capabilities/chat/presence.ts';
import { commit } from './behavior/capabilities/heartbeat/commit.ts';
import { limits, logs } from './behavior/capabilities/heartbeat/config.ts';
import { repositoryOf } from './behavior/capabilities/heartbeat/live.ts';
import { gitCommand } from './behavior/capabilities/heartbeat/repository.ts';
import {
  markHealthy,
  restartExitCode,
} from './behavior/capabilities/heartbeat/restart.ts';
import { ensureSchedules } from './behavior/capabilities/heartbeat/schedules.ts';
import {
  stopper,
  watchMarker,
} from './behavior/capabilities/heartbeat/stop.ts';
import { macroKey } from './behavior/context/index.ts';
import { configured, startOrExit } from './behavior/context/startup.ts';
import { ensureIntroduction } from './behavior/events/handlers/identity.ts';
import {
  assistant,
  base,
  claude,
  launcherFiles,
  resultFlag,
  sandboxProgram,
  scripts,
  wakesRunning,
  wiring,
} from './index.ts';

// Imports are evaluated before this line runs: loading the code ends here.
const loadedAt = Date.now();

const usage =
  'usage: bin/agent <run|list|describe|exec|guard|function> [input]';
const presenceLog = 'presence';
/** How long a boot may take to hear Macro before it counts as failed. */
const listeningDeadlineMs = 3 * 60_000;
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

const stop = stopper({
  running: wakesRunning,
  commit: (message) =>
    commit(repositoryOf(assistant.decorations), message, limits.commitLockWait),
  log: (entry) => base.log.event(logs.heartbeat, entry),
  flush: () => Telemetry.flush(),
  exit: (code) => process.exit(code),
  timeoutMs: limits.stopSync,
  sleep: (ms) => Bun.sleep(ms),
});

const run = async (): Promise<void> => {
  // A stop syncs once more when no wake is running, so a teammate moved to
  // another machine starts from all it did here; one during the start too.
  process.on('SIGTERM', () => void stop());
  // Everything the agent needs to run is checked before anything starts,
  // including the files it tells its launcher through (`launcherFiles`): a
  // healthy boot, or a restart onto code it landed.
  const files = launcherFiles();
  // A land, in any of the agent's processes, touches the restart marker: the
  // agent then stops the way a stop does and exits 75, which its launcher
  // (teammate-boot's supervisor, macrod or systemd) starts again.
  void watchMarker({
    read: () => base.disk.read(files.restart),
    sleep: (ms) => Bun.sleep(ms),
    everyMs: limits.restartPoll,
    changed: () => void stop(restartExitCode),
  });
  // Wakes are traces of their own: the event loop starts in this context,
  // outside the start's span.
  const outsideStart = Telemetry.captureContext();
  const { running } = await startOrExit(
    () =>
      traceStart(
        process.env,
        async (phase) => {
          // The online report comes later, when presence opens; it still
          // belongs to the start, so Macro's side joins the setup trace.
          const startContext = Telemetry.captureContext();
          await phase('agent.start.checks', async () => {
            await configured(claude);
            await configured(sandboxProgram);
          });
          const { presence, hosts } = await phase('agent.start.addresses', () =>
            configured(wiring.addresses)
          );
          const apiKey = await phase('agent.start.credentials', () =>
            configured(() => base.credentials.get(macroKey))
          );
          // Once presence is open, the agent tells Macro it is up: its row turns
          // Running and its inviter hears it is ready.
          const online = reportsOnline({
            post: () =>
              startContext.run(() =>
                Telemetry.span(
                  'agent.online.report',
                  { kind: 'client' },
                  async (span) => {
                    const headers: Record<string, string> = {
                      'x-macro-user-api-key': apiKey,
                    };
                    span.injectTraceHeaders(headers);
                    const { status } = await fetch(
                      `${hosts.auth}${onlineRoute}`,
                      { method: 'POST', headers }
                    );
                    span.setAttr('http.response.status_code', status);
                    return status;
                  }
                )
              ),
            log: (entry) => void base.log.event(presenceLog, entry),
          });
          // The agent shows online in Macro for as long as it runs.
          stayOnline({
            onOnline: online.report,
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
          await phase('agent.start.schedules', () =>
            ensureSchedules(assistant.decorations.schedules)
          );
          // A new agent's first wake is to ask its owner who it is.
          await phase('agent.start.introduction', () =>
            ensureIntroduction(base, assistant.decorations.schedules)
          );
          const systemPrompt = await phase(
            'agent.start.charter',
            async () => (await base.disk.read(base.config.charter)) ?? ''
          );
          const started = outsideStart.run(() =>
            assistant.run(parallel({ systemPrompt, ...scripts }))
          );
          // Built, credentials read, presence open, sources started and chat
          // hearing Macro: a healthy boot, so the launcher's rollback starts
          // from this HEAD. One that Macro answers but whose stream doesn't
          // open in time exits, as a failed boot; one offline waits, up.
          await phase('agent.start.healthy', () =>
            markHealthy({
              git: (args) =>
                base.shell.run(gitCommand('git', base.config.root, args)),
              disk: base.disk,
              file: files.lastGood,
              listening: assistant.decorations.chat.listening,
              deadline: () => Bun.sleep(listeningDeadlineMs),
              reached: assistant.decorations.chat.reached,
              reachable: assistant.decorations.chat.reachable,
            })
          );
          // Wrapped, so the start's span ends here instead of awaiting the loop.
          return { running: started };
        },
        [
          { name: 'agent.start.load', end: loadedAt },
          { name: 'agent.start.telemetry', start: loadedAt, end: telemetryAt },
        ]
      ),
    {
      flush: () => Telemetry.flush(),
      wait: (ms) => Bun.sleep(ms),
      report: (message) => console.error(message),
      exit: (code) => process.exit(code),
    }
  );
  await running;
};

// Spans export only when the computer names an OTLP endpoint.
await startTelemetry({ environment: process.env, agent: base.config.me });
const telemetryAt = Date.now();

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
