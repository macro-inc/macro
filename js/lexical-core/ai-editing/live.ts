import * as readline from 'node:readline';
import PQueue from 'p-queue';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { LoroDoc } from 'loro-crdt';
import {
  FromPeer,
  FromRemote,
} from '../../app/packages/service-clients/service-sync/generated/schema';
import { LinearBackoff } from '../../app/packages/websocket/core/backoff/linear-backoff';
import { ArrayQueue } from '../../app/packages/websocket/core/queue/array-queue';
import { BebopSerializer } from '../../app/packages/websocket/core/serializers/bebop-serializer';
import { WebsocketBuilder } from '../../app/packages/websocket/core/websocket-builder';
import { browserWebSocketFactory } from '../../app/packages/websocket/platform/minimal-websocket';
import { Mirror } from '../../loro-mirror/packages/core/src';
import { MARKDOWN_LORO_SCHEMA } from '../markdown-loro-schema';
import type { SerializedEditorState } from 'lexical';
import { type Provider, createModel } from './agents/agent';
import { serializeSnapshotWithIds } from './utils';
import { initDebug } from './debug';
import { METHODS, editViaCode } from './methods';

const argv = yargs(hideBin(process.argv))
  .scriptName('live')
  .command('$0 <url>', 'Live-edit a document over the sync WebSocket', (y) =>
    y
      .positional('url', { type: 'string', describe: 'ws URL including ?token=<jwt>' })
      .option('provider', { type: 'string', choices: ['anthropic', 'openai', 'cerebras', 'google'], default: 'openai', describe: 'AI provider' })
      .option('model', { type: 'string', describe: 'model ID override' })
      .option('child-provider', { type: 'string', choices: ['anthropic', 'openai', 'cerebras', 'google'], describe: 'AI provider for child (writer) agents (defaults to --provider)' })
      .option('child-model', { type: 'string', describe: 'model ID override for child agents' })
      .option('method', { type: 'string', choices: ['code', 'xml'], default: 'code', describe: 'editing method' })
      .option('report-diff', { type: 'boolean', default: false, describe: 'feed a running diff back to the agent each step' })
      .option('interpret', { type: 'boolean', default: false, describe: 'run an intent-interpretation pass before editing' })
      .option('lightweight', { type: 'boolean', default: false, describe: 'send only headings to the supervisor; use find tool to locate content' })
      .option('debug', { type: 'string', describe: 'dir to write one file per LLM turn' })
  )
  .strict()
  .parseSync();
const url = argv.url as string;
const model = createModel(argv.provider as Provider, argv.model as string | undefined);
const childProvider = (argv.childProvider ?? argv.provider) as Provider;
const childModelId = (argv.childModel ?? argv.model) as string | undefined;
const childModel = (childProvider !== argv.provider || childModelId !== argv.model)
  ? createModel(childProvider, childModelId)
  : undefined;
const runDocEditor = METHODS[argv.method as string] ?? editViaCode;
const reportDiff = argv.reportDiff as boolean;
const interpret = argv.interpret as boolean;
const lightweight = argv.lightweight as boolean;
initDebug(argv.debug as string | undefined);

const doc = new LoroDoc();
const mirror = new Mirror({ doc, schema: MARKDOWN_LORO_SCHEMA });

function currentSnapshot(): SerializedEditorState {
  return mirror.getState() as unknown as SerializedEditorState;
}

let synced = false;
let busy = false;
let sessionIn = 0;
let sessionOut = 0;

function handleRemote(msg: FromRemote): void {
  if (msg.isRemoteInitialSync()) {
    const { snapshot } = msg.value as { snapshot: Uint8Array };
    doc.import(snapshot);
    try {
      ws.send(FromPeer.fromPeerRegisterId({ peerid: doc.peerId as unknown as bigint }));
    } catch {
      /* best-effort attribution; not required to push updates */
    }
    synced = true;
    showDoc();
    rl.prompt();
  } else if (msg.isRemoteUpdate()) {
    if (busy) return; // don't clobber an in-flight edit; resyncs next turn
    try {
      doc.import((msg.value as { update: Uint8Array }).update);
    } catch (e) {
      console.error('remote update dropped (missing causal history):', e);
    }
  }
}

// The sync server sends text 'ping' and expects 'pong' back, which is inverted
// from this lib's heartbeat (client pings, server pongs). The lib sends
// `pingMessage` as raw text (bypassing the Bebop serializer) and swallows an
// incoming `pongMessage` before deserialize — so we emit 'pong' as keepalive and
// let the server's 'ping' be intercepted instead of hitting the FromRemote decoder.
const ws = new WebsocketBuilder(url)
  .withFactory(browserWebSocketFactory)
  .withSerializer(new BebopSerializer<FromPeer, FromRemote>(FromPeer, FromRemote))
  .withBuffer(new ArrayQueue())
  .withBackoff(new LinearBackoff(500, 500, 5_000))
  .withMaxRetries(20)
  .withHeartbeat({
    interval: 15_000,
    timeout: 10_000,
    pingMessage: 'pong',
    pongMessage: 'ping',
    maxMissedHeartbeats: 6,
  })
  .onOpen(() => console.error('connected — waiting for initial sync…'))
  .onClose(() => console.error('\ndisconnected — retrying…'))
  .onError((_w, e) => console.error('ws error:', e))
  .onMessage((_w, ev) => handleRemote(ev.data))
  .build();

// Local loro commits are pushed to the server (the serializer encodes; the buffer
// holds them while disconnected). Remote `doc.import()` does NOT fire this.
doc.subscribeLocalUpdates((update) => {
  ws.send(FromPeer.fromPeerUpdate({ updates: [update], id: crypto.randomUUID() }));
});

function showDoc(): void {
  console.error(`\n=== document ===\n${serializeSnapshotWithIds(currentSnapshot())}\n`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });

// At most 3 edit requests run at once. Pasting a multiline block emits one
// 'line' event per newline; without a cap they'd all fire concurrently, race
// on the shared mirror/doc, and blow the provider's tokens-per-minute limit.
const queue = new PQueue({ concurrency: 5 });
// `busy` gates remote updates from clobbering in-flight edits: true whenever
// the queue has active or pending work, false once it fully drains.
queue.on('active', () => { busy = true; });
queue.on('idle', () => { busy = false; });

async function handleRequest(request: string): Promise<void> {
  const startedAt = Date.now();
  try {
    const usage = await runDocEditor(currentSnapshot(), request, model, (next) => {
      mirror.setState(next as never);
      mirror.sync();
      doc.commit();
      showDoc();
    }, { reportDiff, interpret, childModel, lightweight });

    const tin = usage.inputTokens;
    const tout = usage.outputTokens;

    sessionIn += tin;
    sessionOut += tout;

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.error(
      `[tokens] turn: in ${tin} out ${tout}  ·  session: in ${sessionIn} out ${sessionOut}  ·  ${elapsed}s`
    );
  } catch (e) {
    console.error('edit failed:', e);
  } finally {
    rl.prompt();
  }
}

rl.on('line', (line) => {
  const request = line.trim();
  if (!request) return rl.prompt();
  if (!synced) {
    console.error('not synced yet…');
    return rl.prompt();
  }
  void queue.add(() => handleRequest(request));
});
