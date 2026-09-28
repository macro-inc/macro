/**
 * Generates the complete DisplayResults tool schema from the frontend Zod
 * contract. Run `bun run gen-dynamic-ui-schema` to write it, or add `--check`
 * to verify the committed schema is current.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayResultsToolSchema } from '../src/features/dynamic-ui/toolSchema';

async function main(): Promise<void> {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const outputPath = resolve(
    scriptDirectory,
    '../../../crates/ai_tools/src/display_results/schema.generated.json'
  );
  const output = `${JSON.stringify(displayResultsToolSchema(), null, 2)}\n`;

  if (process.argv.includes('--check')) {
    let current: string | undefined;
    try {
      current = await Bun.file(outputPath).text();
    } catch {
      current = undefined;
    }
    if (current !== output) {
      throw new Error(
        'crates/ai_tools/src/display_results/schema.generated.json is stale; run `bun run gen-dynamic-ui-schema`'
      );
    }
    return;
  }
  await Bun.write(outputPath, output);
}

if (import.meta.main) {
  await main();
}
