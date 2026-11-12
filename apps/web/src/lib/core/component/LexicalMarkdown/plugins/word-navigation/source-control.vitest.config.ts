import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import original from '../../../../vitest.config';

/** Separate process so module-captured Source platform facts cannot leak to Linux controls. */
export default mergeConfig(
  original,
  defineConfig({
    root: fileURLToPath(new URL('../../../../../../../', import.meta.url)),
    test: {
      include: [
        'src/lib/core/component/LexicalMarkdown/plugins/word-navigation/source-apple.source-control.ts',
      ],
      maxWorkers: 1,
    },
  })
);
