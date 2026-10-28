#!/usr/bin/env bun
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const {
  port,
  'worker-url': workerUrlOpt,
  'ws-url': wsUrl,
  'supervisor-model': supervisorModelFlag,
  'interpret-model': interpretModelFlag,
  'coding-model': codingModelFlag,
  'fast-model': fastModelFlag,
  mode,
  propagate,
  interpret,
  debug,
  out,
  prompt: promptFlag,
  'prompt-file': promptFile,
} = await yargs(hideBin(process.argv))
  .usage('$0 --prompt <text> --ws-url <url>')
  .help()
  .strict()
  .option('ws-url', {
    type: 'string',
    demandOption: true,
    describe:
      'sync service ws url with token, e.g. wss://…/document/<id>/connect?token=<doc-token>',
  })
  .option('prompt', {
    type: 'string',
    describe: 'the edit instruction (or use --prompt-file)',
  })
  .option('port', { type: 'number', default: 8933, describe: 'worker port' })
  .option('worker-url', {
    type: 'string',
    describe: 'full worker base URL (overrides --port)',
  })
  .option('supervisor-model', {
    type: 'string',
    describe: 'provider:model for the supervisor',
  })
  .option('interpret-model', {
    type: 'string',
    describe: 'provider:model for the interpret pass',
  })
  .option('coding-model', {
    type: 'string',
    describe: 'provider:model for the coding agents',
  })
  .option('mode', {
    type: 'string',
    choices: ['supervised', 'fast'] as const,
    default: 'supervised',
    describe:
      'supervised = full pipeline; fast = one model edits the whole doc directly (needs --fast-model)',
  })
  .option('fast-model', {
    type: 'string',
    describe: 'provider:model for --mode fast, e.g. google:gemini-3.7-flash',
  })
  .option('propagate', {
    type: 'boolean',
    default: true,
    describe:
      'commit edits to the shared doc (use --no-propagate to only compute and return ops, like the inline web path)',
  })
  .option('interpret', {
    type: 'boolean',
    default: true,
    describe:
      'run the intent-interpretation pass before editing (use --no-interpret to skip)',
  })
  .option('debug', {
    type: 'boolean',
    default: false,
    describe:
      'include the supervisor step trace + replay trace in the response',
  })
  .option('out', {
    type: 'string',
    describe: 'write the replay trace JSON to this file (implies --debug)',
  })
  .option('prompt-file', {
    type: 'string',
    describe: 'read the prompt from this file instead of --prompt',
  })
  .check((argv) => {
    if (!argv.prompt && !argv['prompt-file'])
      throw new Error('provide --prompt <text> or --prompt-file <path>');
    if (argv.mode === 'fast' && !argv['fast-model'])
      throw new Error('--mode fast requires --fast-model');
    if (argv._.length > 0)
      throw new Error(
        `unexpected positional args: ${argv._.join(' ')} — everything is a flag (use --prompt)`
      );
    return true;
  })
  .parse();

const prompt = promptFile
  ? (await Bun.file(promptFile as string).text()).trim()
  : (promptFlag as string);

const parsed = new URL(wsUrl as string);
const pathParts = parsed.pathname.split('/');
const documentId = pathParts[2];
const documentToken = parsed.searchParams.get('token');
if (!documentId || !documentToken) {
  console.error(
    '--ws-url must be in the form wss://…/document/<id>/connect?token=<doc-token>'
  );
  process.exit(1);
}

const parseModel = (flag: string) => {
  const [provider, model] = flag.split(':');
  return { provider: provider!, model: model! };
};

const workerUrl = workerUrlOpt ?? `http://localhost:${port}`;

const controller = new AbortController();
process.on('SIGINT', () => {
  console.error('\naborting request…');
  controller.abort();
});
const wantDebug = debug || Boolean(out);

const res = await fetch(`${workerUrl}/edit`, {
  method: 'POST',
  signal: controller.signal,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    documentToken,
    documentId,
    prompt,
    models: {
      supervisor: supervisorModelFlag
        ? [parseModel(supervisorModelFlag)]
        : undefined,
      interpret: interpretModelFlag
        ? [parseModel(interpretModelFlag)]
        : undefined,
      coding: codingModelFlag ? [parseModel(codingModelFlag)] : undefined,
      fast: fastModelFlag ? [parseModel(fastModelFlag)] : undefined,
    },
    mode,
    propagate,
    interpret,
    debug: wantDebug,
  }),
  timeout: false,
} as RequestInit & { timeout: boolean }).catch((err) => {
  if (controller.signal.aborted) process.exit(130);
  throw err;
});

const body = (await res.json()) as {
  trace?: string;
  replay?: unknown;
} & Record<string, unknown>;

if (out && body.replay) {
  await Bun.write(out, JSON.stringify(body.replay));
  const events = (body.replay as { events?: unknown[] }).events ?? [];
  console.log(`wrote replay trace to ${out} (${events.length} events)`);
}

if (wantDebug && body.trace) {
  console.log(body.trace);
  const { trace, replay, ...rest } = body;
  console.log('\n---\n');
  console.log(rest);
} else {
  const { replay, ...rest } = body;
  console.log(rest);
}
