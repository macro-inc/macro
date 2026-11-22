import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import core from '../../../apps/web/src/lib/core/vitest.config.ts';

const searchText = process.env.SOURCE_TABLE_REOPEN_SEARCH_TEXT ?? 'true';
if (searchText !== 'true' && searchText !== 'false') {
  throw new Error('SOURCE_TABLE_REOPEN_SEARCH_TEXT must be true or false');
}

export default mergeConfig(
  core,
  defineConfig({
    define: {
      'import.meta.env.VITE_ENABLE_MARKDOWN_SEARCH_TEXT':
        JSON.stringify(searchText),
    },
    root: fileURLToPath(new URL('../../../apps/web/', import.meta.url)),
    test: {
      include: [
        fileURLToPath(new URL('./table-reopen.test.tsx', import.meta.url)),
      ],
      maxWorkers: 1,
      env: {
        SOURCE_TABLE_REOPEN_SEARCH_TEXT: searchText,
        SOURCE_REPOSITORY_ROOT: fileURLToPath(
          new URL('../../../', import.meta.url)
        ),
      },
    },
  })
);
