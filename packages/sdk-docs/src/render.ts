/** TypeDoc owns signatures, visibility, inherited members and wire type rendering. */
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as TypeDoc from 'typedoc';
import type { PluginOptions } from 'typedoc-plugin-markdown';

/**
 * What an SDK declaration tells agents and nobody else, from two TSDoc block
 * tags the public reference omits: `@routing`, one "Use when …; not …"
 * sentence an agent decides on, and `@agent`, how that area of Macro works.
 */
export interface AgentNotes {
  /** The TypeDoc module the declaration lives in, e.g. `src/entities/databases/namespace`. */
  module: string;
  /** The declaration, e.g. `DatabaseNamespace`; the module itself for a module comment. */
  name: string;
  /** The `@routing` sentence, when the declaration has one. */
  routing?: string;
  /** The `@agent` guidance as Markdown, when the declaration has some. */
  guide?: string;
}

const AGENT_TAGS: readonly `@${string}`[] = ['@routing', '@agent'];

/**
 * The hint tags `packages/sdk-mcp` turns methods into MCP operations with,
 * also omitted from the public reference. `@readonly` is a TSDoc standard
 * tag, so it is only removed from methods.
 */
const MCP_MODIFIER_TAGS: readonly `@${string}`[] = [
  '@write',
  '@destructive',
  '@openworld',
  '@idempotent',
];
const MCP_BLOCK_TAGS: readonly `@${string}`[] = ['@mcp-exclude'];

export async function renderSdkDocs(
  root: string,
  output: string
): Promise<AgentNotes[]> {
  // The workspace also uses an older TypeDoc. Load the plugin's peer instance so
  // its reflection instanceof checks see the same constructors.
  const plugin = createRequire(import.meta.url).resolve(
    'typedoc-plugin-markdown'
  );
  const { Application, Comment, OptionDefaults, ReflectionKind } =
    (await import(createRequire(plugin).resolve('typedoc'))) as typeof TypeDoc;

  const sdk = join(root, 'packages/sdk');
  const entryPoints = [
    ...new Bun.Glob('src/entities/**/*.ts').scanSync(sdk),
    ...new Bun.Glob('generated/*/types.gen.ts').scanSync(sdk),
    // Specta-generated review types the review handles are typed with.
    'generated/agent-reviews/index.ts',
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
    blockTags: [...OptionDefaults.blockTags, ...AGENT_TAGS, ...MCP_BLOCK_TAGS],
    modifierTags: [...OptionDefaults.modifierTags, ...MCP_MODIFIER_TAGS],
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
  const notes = takeAgentNotes(project, Comment, ReflectionKind);
  removeMcpTags(project, ReflectionKind);
  // TypeDoc only warns when it cannot clear old output. Fail here so callers
  // never consume stale files left behind by a failed render.
  await rm(output, { recursive: true, force: true });
  await app.generateOutputs(project);
  if (app.logger.hasErrors()) throw new Error('TypeDoc generation failed.');
  return notes;
}

/** Remove the MCP hint tags from every comment. */
function removeMcpTags(
  project: TypeDoc.ProjectReflection,
  kinds: typeof TypeDoc.ReflectionKind
) {
  for (const reflection of Object.values(project.reflections)) {
    const own = reflection.comment;
    if (!own) continue;
    for (const tag of MCP_MODIFIER_TAGS) own.modifierTags.delete(tag);
    if (reflection.kindOf(kinds.CallSignature | kinds.Method))
      own.modifierTags.delete('@readonly');
    own.blockTags = own.blockTags.filter(
      (block) => !MCP_BLOCK_TAGS.includes(block.tag)
    );
  }
}

/** Collect every `@routing` and `@agent` block and remove it from the outputs. */
function takeAgentNotes(
  project: TypeDoc.ProjectReflection,
  comment: typeof TypeDoc.Comment,
  kinds: typeof TypeDoc.ReflectionKind
): AgentNotes[] {
  const notes: AgentNotes[] = [];
  for (const reflection of Object.values(project.reflections)) {
    const own = reflection.comment;
    if (!own) continue;
    const text = (tag: string) => {
      const parts = own.blockTags
        .filter((block) => block.tag === tag)
        .map((block) => comment.combineDisplayParts(block.content).trim());
      return parts.length ? parts.join('\n\n') : undefined;
    };
    const routing = text('@routing');
    const guide = text('@agent');
    if (!routing && !guide) continue;
    own.blockTags = own.blockTags.filter(
      (block) => !AGENT_TAGS.includes(block.tag)
    );
    let module: TypeDoc.Reflection | undefined = reflection;
    while (module && !module.kindOf(kinds.Module)) module = module.parent;
    notes.push({
      module: module?.name ?? '',
      name: reflection.name,
      ...(routing ? { routing } : {}),
      ...(guide ? { guide } : {}),
    });
  }
  return notes.sort(
    (a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name)
  );
}
