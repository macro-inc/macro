import { createClient } from '@hey-api/openapi-ts';
import config from '../openapi-ts.config';

const clients = await createClient(await config);

if (clients.length === 0) {
  throw new Error('SDK generation failed: no clients were generated.');
}

// Keep generated blank lines consistent with repository whitespace checks.
for await (const path of new Bun.Glob('generated/**/*.ts').scan()) {
  const file = Bun.file(path);
  const content = await file.text();
  const normalized = content.replace(/^[\t ]+$/gm, '');

  if (normalized !== content) {
    await Bun.write(file, normalized);
  }
}
