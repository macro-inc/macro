/** TypeDoc owns signatures, visibility, inherited members and wire type rendering. */
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as TypeDoc from 'typedoc';
import type { PluginOptions } from 'typedoc-plugin-markdown';

export async function renderSdkDocs(root: string, output: string) {
  // The workspace also uses an older TypeDoc. Load the plugin's peer instance so
  // its reflection instanceof checks see the same constructors.
  const plugin = createRequire(import.meta.url).resolve(
    'typedoc-plugin-markdown'
  );
  const { Application } = (await import(
    createRequire(plugin).resolve('typedoc')
  )) as typeof TypeDoc;

  const sdk = join(root, 'packages/sdk');
  const entryPoints = [
    ...new Bun.Glob('src/entities/**/*.ts').scanSync(sdk),
    ...new Bun.Glob('generated/*/types.gen.ts').scanSync(sdk),
    'src/macro.ts',
    'src/config.ts',
    'src/mentions.ts',
    'src/events/receiver.ts',
    'src/utils/lazy.ts',
    'src/utils/pagination.ts',
    'src/utils/unwrap.ts',
  ]
    .filter(
      (file) =>
        !/\.(test|spec)\.ts$/.test(file) && !file.includes('/__tests__/')
    )
    .sort()
    .map((file) => join(sdk, file));
  const options = {
    entryPoints,
    basePath: sdk,
    tsconfig: join(sdk, 'tsconfig.json'),
    plugin: ['typedoc-plugin-markdown'],
    name: 'Macro SDK',
    readme: join(root, 'packages/sdk-docs/pages/home.md'),
    exclude: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
    excludePrivate: true,
    excludeProtected: true,
    excludeInternal: true,
    disableSources: true,
    excludeExternals: true,
    gitRevision: 'main',
    includeVersion: false,
    router: 'member',
    cleanOutputDir: true,
    hideBreadcrumbs: true,
    hidePageHeader: true,
    expandObjects: true,
    parametersFormat: 'table',
    interfacePropertiesFormat: 'table',
    classPropertiesFormat: 'table',
    typeAliasPropertiesFormat: 'table',
    typeDeclarationFormat: 'table',
    outputs: [
      { name: 'markdown', path: join(output, 'markdown') },
      { name: 'html', path: join(output, 'html'), options: { router: 'kind' } },
    ],
  } satisfies TypeDoc.TypeDocOptions & Partial<PluginOptions>;
  const app = await Application.bootstrapWithPlugins(options);
  const project = await app.convert();
  if (!project) throw new Error('TypeDoc could not convert the public SDK.');
  // TypeDoc only warns when it cannot clear old output. Fail here so callers
  // never consume stale files left behind by a failed render.
  await rm(output, { recursive: true, force: true });
  await app.generateOutputs(project);
  if (app.logger.hasErrors()) throw new Error('TypeDoc generation failed.');
}
