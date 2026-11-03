/**
 * Generates the complete DisplayResults and PresentView tool schemas from the
 * frontend Zod contract. Run `bun run gen-dynamic-ui-schema` to write them, or
 * add `--check` to verify the committed schemas are current.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  displayResultsToolSchema,
  presentViewToolSchema,
} from '../src/features/dynamic-ui/toolSchema';

const SCHEMAS = [
  {
    path: 'crates/ai_tools/src/display_results/schema.generated.json',
    schema: displayResultsToolSchema,
  },
  {
    path: 'crates/dynamic_ui/src/present_view.schema.generated.json',
    schema: presentViewToolSchema,
  },
];

async function main(): Promise<void> {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  for (const { path, schema } of SCHEMAS) {
    const outputPath = resolve(repository, path);
    const output = `${JSON.stringify(schema(), null, 2)}\n`;
    if (process.argv.includes('--check')) {
      let current: string | undefined;
      try {
        current = await Bun.file(outputPath).text();
      } catch {
        current = undefined;
      }
      if (current !== output) {
        throw new Error(
          `${path} is stale; run \`bun run gen-dynamic-ui-schema\``
        );
      }
      continue;
    }
    await Bun.write(outputPath, output);
  }
}

if (import.meta.main) {
  await main();
}
