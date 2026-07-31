import { parseArgs } from 'node:util';
import type { Env } from '../src/config';
import type { EventName } from '../src/events/types';
import { Macro } from '../src/macro';

const localEndpoint = 'http://sdk-webhook-relay:8787/macro-events';

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
    'user-id': { type: 'string' },
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
  const env = parseEnv(values.env) ?? fail('--env is required');
  const endpointUrl = required(values.url, '--url');
  const name = required(values.name, '--name');
  const events = parseEvents(values.events ?? fail('--events is required'));
  const scope = parseScope(values.scope) ?? fail('--scope is required');
  const userId = values['user-id'];
  if (scope === 'user' && !userId) {
    fail('--user-id is required when --scope user');
  }
  if (events.length === 0) fail('at least one event is required');

  const macro = new Macro({ env, ...(userId ? { requestedAs: userId } : {}) });
  const webhook = await macro.webhooks.create({
    url: endpointUrl,
    name,
    filters: [{ events }],
    scope,
  });
  const secret = webhook.signingSecret ?? fail('webhook signing secret missing');

  console.log(`
Webhook registered.

MACRO_WEBHOOK_ID=${webhook.id}
MACRO_WEBHOOK_SECRET=${shellQuote(secret)}

Start the event printer and validation receiver:
MACRO_WEBHOOK_SECRET=${shellQuote(secret)} bun run webhook receive ${webhook.id} --env ${env}${userId ? ` --user-id ${shellQuote(userId)}` : ''}
`);
}

async function receive(id: string): Promise<void> {
  const env = parseEnv(values.env) ?? fail('--env is required');
  const secret =
    process.env.MACRO_WEBHOOK_SECRET ??
    fail('MACRO_WEBHOOK_SECRET is required');
  const port = parsePort(values.port ?? '8787');
  const userId = values['user-id'];
  const macro = new Macro({
    env,
    webhookSecret: secret,
    ...(userId ? { requestedAs: userId } : {}),
  });
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

  webhook register --env <dev|prod|local> --url <endpoint URL>
                   --name <webhook name> --events <event,event>
                   --scope <user|team> [--user-id <macro-user-id>]

  webhook receive <webhook-id> --env <dev|prod|local>
                   [--port <port>] [--user-id <macro-user-id>]

For just run_local, use ${localEndpoint} for --url. Run receive on the host
with MACRO_WEBHOOK_SECRET set to the value printed by register.
`);
}

function required(value: string | undefined, option: string): string {
  if (value?.trim()) return value;
  fail(`${option} is required`);
}

function parseEnv(value: string | undefined): Env | undefined {
  if (value === undefined) return undefined;
  if (value === 'dev' || value === 'prod' || value === 'local') return value;
  fail('Macro environment must be dev, prod, or local');
}

function parseEvents(value: string): EventName[] {
  const events = value
    .split(',')
    .map((event) => event.trim())
    .filter(Boolean) as EventName[];
  if (events.length === 0) fail('--events must contain at least one event');
  return events;
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
