/**
 * Generates the dynamic-UI (`displayResults`) prompt section the Rust prompt
 * crate composes into the agent-session system prompt.
 *
 * The AI chat builds its own copy at runtime and sends it as
 * `additional_instructions`, but an agent session's turn runs entirely on the
 * backend — nothing frontend-side is in that loop. So the same text, from the
 * same Zod schema, is generated into `crates/prompt/src/dynamic_ui.generated.md` and
 * `include_str!`d there.
 *
 * Usage:
 *   bun run gen-dynamic-ui-prompt            # write the file
 *   bun run gen-dynamic-ui-prompt --check    # fail if it is stale
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayResultsPromptBody } from '../src/features/dynamic-ui/toolSchema';

/**
 * The file's contents: the prompt body verbatim. No generated-file banner —
 * the file IS the prompt text, and a comment at the top of it would be sent
 * to the model along with everything else.
 */
function renderDynamicUiPrompt(): string {
  return `${displayResultsPromptBody()}\n`;
}

async function main(): Promise<void> {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const outputPath = resolve(
    scriptDirectory,
    '../../../crates/prompt/src/dynamic_ui.generated.md'
  );
  const output = renderDynamicUiPrompt();

  if (process.argv.includes('--check')) {
    const current = await Bun.file(outputPath)
      .text()
      .catch(() => undefined);
    if (current !== output) {
      throw new Error(
        'crates/prompt/src/dynamic_ui.generated.md is stale; run `bun run gen-dynamic-ui-prompt`'
      );
    }
    return;
  }
  await Bun.write(outputPath, output);
}

if (import.meta.main) {
  await main();
}
