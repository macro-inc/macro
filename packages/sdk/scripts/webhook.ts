import { parseArgs } from 'node:util';
import type { Env } from '../src/config';
import type { EventName } from '../src/events/types';
import { resolveLocalPortmap } from '../src/local-portmap';
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
    namespace: { type: 'string' },
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
  const scope = values.scope ?? fail('--scope is required');
  if (scope !== 'user' && scope !== 'team') fail('--scope must be user or team');
  const userId =
    scope === 'user'
      ? required(values['user-id'], '--user-id')
      : values['user-id'];

  const namespace = values.namespace ?? crypto.randomUUID();

  const macro = new Macro({ env, requestedAs: userId });
  const webhook = await macro.webhooks.create({
    url: endpointUrl,
    namespace,
    name,
    filters: [{ events }],
    scope,
  });
  const secret = webhook.signingSecret ?? fail('webhook signing secret missing');

  console.log(`
Webhook registered.

MACRO_WEBHOOK_ID=${webhook.id}
MACRO_WEBHOOK_SECRET="${secret}"

Start the event printer and validation receiver:
MACRO_WEBHOOK_SECRET="${secret}" bun run webhook receive ${webhook.id} --env ${env}${userId ? ` --user-id "${userId}"` : ''}
`);
}

async function receive(id: string): Promise<void> {
  const env = parseEnv(values.env) ?? fail('--env is required');
  const secret =
    process.env.MACRO_WEBHOOK_SECRET ??
    fail('MACRO_WEBHOOK_SECRET is required');
  const port = Number(
    values.port ?? resolveLocalPortmap()?.sdkWebhookHostReceiverPort ?? 8787,
  );
  const userId = values['user-id'];
  const macro = new Macro({
    env,
    webhookSecret: secret,
    requestedAs: userId,
  });
  const receiver = macro.events.webhook();

  Bun.serve({
    hostname: '0.0.0.0',
    port,
    fetch: async (request) => {
      const bodyPromise = request.clone().text();
      try {
        const response = await receiver(request);
        const event = request.headers.get('x-macro-event') ?? 'unknown';
        console.log(`[${event}] ${await bodyPromise}`);
        return response;
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
                   [--namespace <workspace-unique namespace, random by default>]

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

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
