/**
 * Single-agent editing demo (one-shot, JSON in → JSON out).
 *
 *   ANTHROPIC_API_KEY=… bun run lexical-core/ai-editing/demo.ts <snapshot.json> "<request>"
 *
 * <snapshot.json> is a Lexical SerializedEditorState ({ root: … }). stderr carries
 * the transcript + token summary; stdout is the resulting Lexical JSON.
 */

import * as fs from 'node:fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { type Session, createEditingSession, loadSnapshot, toSnapshot } from './ai-toolkit';
import { MODEL_ID, type Provider, createModel, runAgent } from './agents/agent';
import { initDebug } from './debug';
import { serializeWithIds } from './utils';

function loadInput(s: Session, file: string) {
  loadSnapshot(s, JSON.parse(fs.readFileSync(file, 'utf8')));
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('demo')
    .command('$0 <file> <request>', 'Edit a Lexical document JSON with one agent pass', (y) =>
      y
        .positional('file', { type: 'string', describe: 'Lexical SerializedEditorState JSON' })
        .positional('request', { type: 'string', describe: 'what to change (quote it)' })
        .option('provider', { type: 'string', choices: ['anthropic', 'openai', 'cerebras', 'google'], default: 'anthropic', describe: 'AI provider' })
        .option('model', { type: 'string', describe: 'model ID override' })
        .option('debug', { type: 'string', describe: 'dir to write one file per LLM turn' })
    )
    .strict()
    .parseAsync();

  initDebug(argv.debug as string | undefined);

  const provider = argv.provider as Provider;
  const model = createModel(provider, argv.model as string | undefined);

  const s = createEditingSession();
  loadInput(s, argv.file as string);
  console.error(`=== input ===\n${serializeWithIds(s)}`);

  const startedAt = Date.now();
  const { text, totalUsage } = await runAgent(s, argv.request as string, undefined, model);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.error(`\n=== final ===\n${serializeWithIds(s)}`);
  console.error(`\n=== summary ===\n${text}`);
  console.error(
    `\n=== usage === in ${totalUsage.inputTokens} out ${totalUsage.outputTokens} (${provider}:${argv.model ?? MODEL_ID})  ·  ${elapsed}s`
  );

  console.log(JSON.stringify(toSnapshot(s), null, 2)); // result: Lexical JSON
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
