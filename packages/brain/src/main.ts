// `brain`: the daemon (`brain run`), its health probe (`brain health`), and
// the commands a turn uses to talk and remember through the running brain.
import { match, P } from 'ts-pattern';
import { loadConfig } from './config.ts';
import { callBrain } from './control.ts';
import { stdinText } from './subprocess.ts';

const USAGE = `usage: brain <command>
  run                                      run the brain (env: MACRO_API_KEY, MACRO_GATEWAY, BRAIN_WORKSPACE,
                                           BRAIN_HEALTH_PORT, ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN)
  react <channel> <message> <emoji>          react to a message
  check                                    typecheck, tests, fake-event boot of this workspace
  health                                   print the running brain's health; exit 1 unless ok
inside a turn:
  post <channel> <text|->                  reply <channel> <root> <text|->
  context <channel> [root]                 handoff --channel <id> [--root <id>] --label <words> <task|->
  remember <topic> <text|->                recall <words...>             forget <topic>
  focus <text|->                           promise <to> <text|->         release <words...>
  schedule (--once <time> | --cron <expr> --timezone <tz>) <note|->
  schedules                                unschedule <routine_id>`;
class UsageError extends Error {}
const env = (name: string) => process.env[name];
/** The argument, or stdin when it is `-`. Empty text is refused. */
async function textArgument(value: string | undefined): Promise<string> {
  if (value === undefined)
    throw new UsageError('missing text (pass it, or - to read stdin)');
  const text = value === '-' ? await stdinText() : value;
  if (text.trim() === '') throw new UsageError('empty text');
  return text.trim();
}
/** `--name value` flags and the remaining positional arguments. */
function flags(args: string[]): {
  named: Map<string, string>;
  rest: string[];
} {
  const named = new Map<string, string>();
  const rest: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] ?? '';
    const value = args[index + 1];
    if (argument.startsWith('--') && value !== undefined) {
      named.set(argument.slice(2), value);
      index++;
    } else {
      rest.push(argument);
    }
  }
  return { named, rest };
}
const required = (value: string | undefined, name: string): string => {
  if (!value) throw new UsageError(`missing ${name}`);
  return value;
};
const print = (value: unknown) =>
  console.log(
    typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  );
async function run(): Promise<void> {
  const { supervise } = await import('./supervisor.ts');
  await supervise();
}
async function health(): Promise<number> {
  const { healthPort: port } = loadConfig(env);
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  print(await response.json());
  return response.ok ? 0 : 1;
}
async function command(args: string[]): Promise<number> {
  const [name, ...rest] = args;
  const brain = (
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: object
  ) => callBrain(env, fetch, method, path, body);
  const { named, rest: positional } = flags(rest);
  await match(name ?? 'help')
    .with('run', run)
    .with('check', async () => {
      const { checkWorkspace } = await import('./supervisor.ts');
      await checkWorkspace(process.cwd());
    })
    .with('health', async () => {
      process.exitCode = await health();
    })
    .with('post', async () =>
      print(
        await brain('POST', '/talk/post', {
          channel: required(rest[0], 'channel'),
          text: await textArgument(rest[1]),
        })
      )
    )
    .with('reply', async () =>
      print(
        await brain('POST', '/talk/reply', {
          channel: required(rest[0], 'channel'),
          root: required(rest[1], 'root'),
          text: await textArgument(rest[2]),
        })
      )
    )
    .with('react', async () =>
      print(
        await brain('POST', '/talk/react', {
          channel: required(rest[0], 'channel'),
          message: required(rest[1], 'message'),
          emoji: required(rest[2], 'emoji'),
        })
      )
    )
    .with('context', async () => {
      const query = new URLSearchParams({
        channel: required(rest[0], 'channel'),
      });
      if (rest[1]) query.set('root', rest[1]);
      const lines = (await brain('GET', `/talk/context?${query}`)) as unknown[];
      for (const line of lines) console.log(JSON.stringify(line));
    })
    .with('handoff', async () =>
      print(
        await brain('POST', '/handoff', {
          channel: required(named.get('channel'), '--channel'),
          root: named.get('root') ?? null,
          label: required(named.get('label'), '--label'),
          task: await textArgument(positional[0]),
        })
      )
    )
    .with('remember', async () =>
      print(
        await brain('POST', '/memory/remember', {
          topic: required(rest[0], 'topic'),
          text: await textArgument(rest[1]),
        })
      )
    )
    .with('recall', async () =>
      print(
        await brain(
          'GET',
          `/memory/recall?${new URLSearchParams({ q: required(rest.join(' '), 'words') })}`
        )
      )
    )
    .with('forget', async () =>
      print(
        await brain('POST', '/memory/forget', {
          topic: required(rest[0], 'topic'),
        })
      )
    )
    .with('focus', async () =>
      print(
        await brain('POST', '/memory/focus', {
          focus: await textArgument(rest[0]),
        })
      )
    )
    .with('promise', async () =>
      print(
        await brain('POST', '/memory/promise', {
          to: required(rest[0], 'to'),
          what: await textArgument(rest[1]),
        })
      )
    )
    .with('release', async () =>
      print(
        await brain('POST', '/memory/release', {
          match: required(rest.join(' '), 'words'),
        })
      )
    )
    .with('schedule', async () => {
      const once = named.get('once');
      const cron = named.get('cron');
      const trigger = once
        ? { type: 'once', at: once }
        : {
            type: 'cron',
            schedule: required(cron, '--once or --cron'),
            timezone: required(named.get('timezone'), '--timezone'),
          };
      print(
        await brain('POST', '/schedules', {
          note: await textArgument(positional[0]),
          trigger,
        })
      );
    })
    .with('schedules', async () => print(await brain('GET', '/schedules')))
    .with('unschedule', async () =>
      print(
        await brain(
          'DELETE',
          `/schedules/${encodeURIComponent(required(rest[0], 'routine id'))}`
        )
      )
    )
    .with(P.union('--help', 'help'), () => console.log(USAGE))
    .otherwise((unknown) => {
      throw new UsageError(`unknown command ${unknown}`);
    });
  return Number(process.exitCode ?? 0);
}
if (import.meta.main) {
  try {
    await command(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof UsageError
        ? `${error.message}\n\n${USAGE}`
        : String(error)
    );
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}
