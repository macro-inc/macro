import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSdkDocs } from '../src/render';

const root = fileURLToPath(new URL('../../../', import.meta.url));
await renderSdkDocs(root, join(root, 'packages/sdk-docs/dist/docs'));
