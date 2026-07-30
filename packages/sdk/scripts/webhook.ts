import { parseArgs } from 'node:util';
import type { Env } from '../src/config';
import type { EventName } from '../src/events/types';
import { Macro } from '../src/macro';

const localEndpoint = 'http://host.docker.internal:8787/macro-events';
const defaultEvents = 'channel.message_posted';

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    env: { type: 'string' },
    events: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    name: { type: 'string' },
    port: { type: 'string' },
    scope: { type: 'string' },
    url: { type: 'string' },
  },
  strict: true,
});

const [command, webhookId] = positionals;
if (values.help || !command) {
  printHelp();
  process.exit(values.help ? 0 : 1);
}

switch (command) {
  case 'register':
    await register();
    break;
  case 'receive':
    if (!webhookId) fail('usage: webhook receive <webhook-id>');
    await receive(webhookId);
    break;
  default:
    fail(`unknown webhook command: ${command}`);
}

async function register(): Promise<void> {
  const env = parseEnv(values.env) ?? askEnv();
  const endpointUrl =
    values.url ??
    ask('Webhook endpoint URL', env === 'local' ? localEndpoint : undefined);
  const name = values.name ?? ask('Webhook name', 'macro-sdk-webhook');
  const events = (
    values.events ?? ask('Events, comma separated', defaultEvents)
  )
    .split(',')
    .map((event) => event.trim())
    .filter(Boolean) as EventName[];
  const scope = parseScope(values.scope) ?? askScope();
  if (events.length === 0) fail('at least one event is required');

  const macro = new Macro({ env });
  const webhook = await macro.webhooks.create({
    url: endpointUrl,
    name,
    filters: [{ events }],
    scope,
  });
  const secret = webhook.signingSecret;

  console.log(`
Webhook registered.

MACRO_WEBHOOK_ID=${webhook.id}
MACRO_WEBHOOK_SECRET=${secret ?? '<missing>'}

Start the event printer and validation receiver:
MACRO_WEBHOOK_SECRET=<the value above> bun run webhook receive ${webhook.id} --env ${env}
`);

  if (!secret) process.exit(1);
}

async function receive(id: string): Promise<void> {
  const env = parseEnv(values.env) ?? askEnv();
  const secret =
    process.env.MACRO_WEBHOOK_SECRET ?? ask('Webhook signing secret');
  const port = parsePort(values.port ?? '8787');
  const macro = new Macro({ env, webhookSecret: secret });
  const events = macro.events;
  if (!events) fail('Webhook signing secret is required');
  const receiver = events.webhook();

  Bun.serve({
    hostname: '0.0.0.0',
    port,
    fetch: async (request) => {
      const event = request.headers.get('x-macro-event') ?? 'unknown';
      console.log(`[${event}] ${await request.clone().text()}`);
      try {
        return await receiver(request);
      } catch (error) {
        console.error('Webhook signature verification failed:', error);
        return new Response('invalid signature', { status: 401 });
      }
    },
  });
  console.log(`Listening on 0.0.0.0:${port}; validating webhook ${id}...`);

  const validation = await macro.webhooks.byId(id).validate();
  if (validation.is_valid) {
    console.log('Webhook verified. Waiting for deliveries.');
  } else {
    console.error(
      `Validation failed: ${validation.message ?? 'delivery was not accepted'}`,
    );
  }
}

function printHelp(): void {
  console.log(`
Register a webhook or receive and print its events.

  webhook register [--env <dev|prod|local>] [--url <endpoint URL>]
                   [--name <webhook name>] [--events <event,event>]
                   [--scope <user|team>]

  webhook receive <webhook-id> [--env <dev|prod|local>] [--port <port>]

For just run_local, register ${localEndpoint}. Run receive on the Docker host
with MACRO_WEBHOOK_SECRET set to the value printed by register.
`);
}

function ask(label: string, defaultValue?: string): string {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = prompt(`${label}${suffix}:`);
  if (answer === null) process.exit(1);
  const value = answer.trim() || defaultValue;
  if (!value) fail(`${label} is required`);
  return value;
}

function askEnv(): Env {
  return (
    parseEnv(
      ask(
        'Macro environment (dev, prod, local)',
        process.env.MACRO_ENV ?? 'dev',
      ),
    ) ?? fail('Macro environment is required')
  );
}

function askScope(): 'user' | 'team' {
  return (
    parseScope(ask('Webhook scope (user, team)', 'user')) ??
    fail('Webhook scope is required')
  );
}

function parseEnv(value: string | undefined): Env | undefined {
  if (value === undefined) return undefined;
  if (value === 'dev' || value === 'prod' || value === 'local') return value;
  fail('Macro environment must be dev, prod, or local');
}

function parsePort(value: string): number {
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port < 65_536) return port;
  fail('port must be an integer between 1 and 65535');
}

function parseScope(value: string | undefined): 'user' | 'team' | undefined {
  if (value === undefined) return undefined;
  if (value === 'user' || value === 'team') return value;
  fail('Webhook scope must be user or team');
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
