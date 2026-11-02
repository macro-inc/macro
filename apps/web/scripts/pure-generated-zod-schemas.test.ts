import { build, type Rollup } from 'vite';
import { expect, it } from 'vitest';
import { pureGeneratedZodSchemas } from './pure-generated-zod-schemas';

it.each(['zod.ts', 'tools/schemas.ts'])(
  'drops entire unused chains and preserves the schema object API: %s',
  async (name) => {
    const schemaId = `/generated/${name}`;
    const result = (await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [
        pureGeneratedZodSchemas(),
        {
          name: 'schema-fixture',
          resolveId(id) {
            if (id === 'entry' || id === schemaId) return id;
          },
          load(id) {
            if (id === 'entry')
              return `import { used } from '${schemaId}'; export const result = used.omit({ private: true }).safeParse({ value: 'ok' });`;
            if (id === schemaId)
              return `import { z } from 'zod';
                export const unused = z.object({ value: z.string().describe('unused nested marker') }).describe('unused outer marker');
                export const used = z.object({ value: z.string(), private: z.string() }).describe('used marker');`;
          },
        },
      ],
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: 'entry', preserveEntrySignatures: 'strict' },
      },
    })) as Rollup.RollupOutput;
    const code = result.output
      .filter((file) => file.type === 'chunk')
      .map((file) => file.code)
      .join('\n');
    expect(code).not.toContain('unused nested marker');
    expect(code).not.toContain('unused outer marker');
    expect(code).toContain('used marker');
    const module = await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    );
    expect(module.result).toEqual({ success: true, data: { value: 'ok' } });
  }
);
