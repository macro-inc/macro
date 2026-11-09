import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@macro-inc/collaboration/session/compatibility.generated':
        process.env.COMPAT_SELECTION_SCHEMA_PATH ??
        fileURLToPath(
          new URL(
            '../../../../collaboration/src/session/compatibility.generated.ts',
            import.meta.url
          )
        ),
    },
  },
  test: {
    include: ['src/selection/tests/{constructors,reads}.test.ts'],
    environment: 'node',
  },
});
