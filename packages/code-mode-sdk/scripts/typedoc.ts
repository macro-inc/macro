import { readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

/** Keep canonical plugin output intact; only organize pages for the agent's reader. */
export async function readMarkdownPages(directory: string) {
  const pages = new Map<string, string>();
  for (const entry of (await readdir(directory, { recursive: true })).sort()) {
    if (entry.endsWith('.md')) {
      pages.set(
        entry.replaceAll('\\', '/'),
        await readFile(join(directory, entry), 'utf8')
      );
    }
  }
  return pages;
}

/** One SDK entity: what it is for, and the compact index of what it declares. */
export type EntityDocs = { name: string; description: string; index: string };

/**
 * The agent reads the SDK in two steps: an entity's index lists its classes,
 * methods and types by symbol, and each symbol's own reference is read on
 * request. Symbols are a class (`Task`), one of its methods (`Task.update`) or
 * a type (`CreateTaskOptions`); a name two pages share is qualified by its
 * directory (`storage.Message`).
 */
export type SdkDocs = {
  entities: EntityDocs[];
  symbols: Record<string, string>;
};

const LINK = /\[([^\]]*)\]\(([^)]+\.md)(?:#([^)]*))?\)/g;

export function packageEntityDocs(
  sourcePages: ReadonlyMap<string, string>,
  descriptions: Readonly<Record<string, string>>
): SdkDocs {
  // The public SDK retains deployed legacy APIs. Native discovery tools cover
  // current sessions; omit the legacy chat and workspace namespaces here.
  // Only the `Macro` class loses these members; other classes keep methods
  // with the same names, such as `WhatsAppNamespace.chats()`.
  const hiddenNamespace = (path: string) =>
    /^src\/entities\/(chats|workspace)\//.test(path);
  const withoutLegacyMembers = (markdown: string) =>
    markdown
      .replace(
        /^### (?:chats|workspace)\b[^\n]*\n[\s\S]*?(?=^### |^## |(?![\s\S]))/gm,
        ''
      )
      .replace(/^\| <a id="property-(?:chats|workspace)"[^\n]*\n/gm, '');
  const pages = new Map(
    [...sourcePages]
      .filter(
        ([path]) => !hiddenNamespace(path) && !path.endsWith('/README.md')
      )
      .map(([path, markdown]) => [
        path,
        path.startsWith('src/macro/')
          ? withoutLegacyMembers(markdown)
          : markdown,
      ])
  );
  const core = [
    'src/macro/',
    'src/config/',
    'src/mentions/',
    'src/entities/entity/',
    'src/entities/search/',
    'src/entities/sharing/',
    'src/entities/messages/',
    'src/entities/reference/',
    'src/utils/',
    'src/events/',
  ];
  const sections = [
    ...Object.entries(descriptions).map(([directory, description]) => ({
      name:
        directory === 'foreign'
          ? 'foreignEntities'
          : directory.replace(/-([a-z])/g, (_, letter: string) =>
              letter.toUpperCase()
            ),
      description,
      // Agent and host setup share one discovery topic, as do AI calls and
      // image generation, keeping the classifier request within its
      // 32-question contract as the public API grows.
      prefixes: (directory === 'agents'
        ? ['agents', 'harnesses']
        : directory === 'channels'
          ? ['channels', 'external-chat', 'whatsapp']
          : directory === 'ai'
            ? ['ai', 'images']
            : [directory]
      ).map((value) => `src/entities/${value}/`),
    })),
    {
      name: 'core',
      description:
        'SDK construction, entity handles, lazy fields, search options, events and shared types.',
      prefixes: core,
    },
  ];
  const resolve = (from: string, target: string) =>
    posix.normalize(
      posix.join(posix.dirname(from), decodeURIComponent(target))
    );

  // Every page an entity declares, and every wire contract those reach.
  const documented = new Set<string>();
  const owned = sections.map(({ name, prefixes }) => {
    const own = [...pages.keys()].filter((path) =>
      prefixes.some((prefix) => path.startsWith(prefix))
    );
    if (!own.length) throw new Error(`TypeDoc generated no pages for ${name}`);
    const reached = new Set(own);
    // Follow the plugin's links, not TypeScript syntax. Shared wire definitions
    // may recurse or reference one another; a Set handles cycles deterministically.
    for (const path of reached) {
      for (const match of (pages.get(path) ?? '').matchAll(LINK)) {
        const target = resolve(path, match[2] ?? '');
        if (hiddenNamespace(target)) continue;
        if (!pages.has(target))
          throw new Error(`Broken TypeDoc link: ${path} -> ${target}`);
        if (target.startsWith('generated/')) reached.add(target);
      }
    }
    for (const path of reached) documented.add(path);
    return own.sort();
  });

  // A page is known by its name. An SDK class or type keeps it when no other
  // SDK page shares it; a wire contract keeps it only when no page at all does.
  const named = new Map<string, string[]>();
  for (const path of documented) {
    const name = pageName(path);
    named.set(name, [...(named.get(name) ?? []), path]);
  }
  const symbolOf = new Map<string, string>();
  for (const [name, paths] of named) {
    const sdk = paths.filter((path) => path.startsWith('src/'));
    for (const path of paths) {
      const bare = path.startsWith('src/')
        ? sdk.length === 1
        : paths.length === 1;
      symbolOf.set(path, bare ? name : `${pageGroup(path)}.${name}`);
    }
  }
  if (new Set(symbolOf.values()).size !== symbolOf.size)
    throw new Error('Two TypeDoc pages share a qualified symbol');

  // Links name the symbol they point at, as ReadCodeDocs takes it.
  const relink = (path: string, markdown: string) =>
    markdown
      .replace(LINK, (_whole, label: string, target: string, anchor) => {
        const symbol = symbolOf.get(resolve(path, target));
        if (!symbol) return label;
        // An anchor is a member; its label keeps the member's case.
        const member = anchor
          ? `.${label.replaceAll('`', '').split('.').pop()}`
          : '';
        return `\`${symbol}${member}\``;
      })
      // TypeDoc writes an inherited member as `[Class].[member]`.
      .replace(/`([^`]+)`\.`\1\.([^`]+)`/g, '`$1.$2`');

  const symbols: Record<string, string> = {};
  for (const path of [...documented].sort()) {
    const symbol = symbolOf.get(path) ?? '';
    const markdown = relink(path, pages.get(path) ?? '');
    if (!path.includes('/classes/')) {
      symbols[symbol] = markdown.trim();
      continue;
    }
    const { header, methods } = splitClass(markdown);
    symbols[symbol] = header;
    for (const method of methods)
      symbols[`${symbol}.${method.name}`] = method.markdown;
  }

  // Where each namespace class is reached from: `macro.tasks`.
  const accessors = new Map<string, string>();
  for (const match of relink(
    'src/macro/classes/Macro.md',
    pages.get('src/macro/classes/Macro.md') ?? ''
  ).matchAll(
    /^\| <a id="property-[^"]+"><\/a> `([^`]+)` \| `readonly` \| `([^`]+)`/gm
  ))
    accessors.set(match[2] ?? '', `macro.${match[1]}`);

  return {
    entities: sections.map(({ name, description }, index) => ({
      name,
      description,
      index: entityIndex(
        name,
        description,
        (owned[index] ?? []).map((path) => ({
          path,
          symbol: symbolOf.get(path) ?? '',
          markdown: relink(path, pages.get(path) ?? ''),
        })),
        accessors
      ),
    })),
    symbols,
  };
}

function pageName(path: string) {
  return posix.basename(path, '.md');
}

/** The directory that tells two same-named pages apart: a wire service or an entity. */
function pageGroup(path: string) {
  const parts = path.split('/');
  return parts[0] === 'generated'
    ? (parts[1] ?? '')
    : (parts[parts.indexOf('entities') + 1] ?? parts[1] ?? '');
}

type Method = { name: string; markdown: string; inherited: boolean };

/** A class page's own description and fields, and each method on its own. */
function splitClass(markdown: string) {
  const sections = markdown.split(/^(?=## )/m);
  const header = sections
    .filter(
      (section) =>
        !section.startsWith('## Constructors') &&
        !section.startsWith('## Methods')
    )
    .join('')
    .trim();
  const methods: Method[] = (
    sections.find((section) => section.startsWith('## Methods')) ?? ''
  )
    .split(/^(?=### )/m)
    .filter((block) => block.startsWith('### '))
    .map((block) => {
      const text = block.replace(/\n\*\*\*\s*$/, '').trim();
      return {
        name: (text.match(/^### (\S+?)\(\)/) ?? [])[1] ?? '',
        markdown: text,
        inherited: /^#### Inherited from/m.test(text),
      };
    })
    .filter((method) => method.name);
  return { header, methods };
}

/** Markdown inline code and escapes, as plain text. */
function plain(markdown: string) {
  return markdown
    .replace(/\*\*|`/g, '')
    .replace(/\\([<>|_*[\]{}])/g, '$1')
    .trim();
}

/** The first sentence of the paragraph after a heading's signature. */
function summary(markdown: string) {
  const paragraph =
    markdown
      .split(/\n\n+/)
      .slice(1)
      .find(
        (part) =>
          !part.startsWith('>') &&
          !part.startsWith('#') &&
          !part.startsWith('|') &&
          !part.startsWith('-')
      ) ?? '';
  const sentence =
    plain(paragraph.replace(/\n/g, ' ')).split(/(?<=\.)\s/)[0] ?? '';
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}

function entityIndex(
  name: string,
  description: string,
  pages: { path: string; symbol: string; markdown: string }[],
  accessors: ReadonlyMap<string, string>
) {
  const lines = [
    `## ${name}`,
    description,
    'Read any symbol below, or one a reference names, with ReadCodeDocs.',
  ];
  const kinds: Record<string, string[]> = {};
  for (const { path, symbol, markdown } of pages) {
    if (!path.includes('/classes/')) {
      const kind = path.includes('/functions/') ? 'Functions' : 'Types';
      kinds[kind] = [...(kinds[kind] ?? []), `\`${symbol}\``];
      continue;
    }
    const { header, methods } = splitClass(markdown);
    const reach = accessors.get(symbol);
    const parent = header.match(/^## Extends\n\n- `([^`]+)`/m)?.[1];
    lines.push(
      '',
      `### ${symbol}${reach ? ` (\`${reach}\`)` : ''}`,
      ...[summary(header), parent && `Extends \`${parent}\`.`].filter(
        (line): line is string => Boolean(line)
      )
    );
    const fields = [
      ...header.matchAll(/^\| <a id="property-[^"]+"><\/a> `([^`]+)`/gm),
    ].map((match) => match[1]);
    if (fields.length) lines.push(`Fields: ${fields.join(', ')}`);
    for (const method of methods.filter((method) => !method.inherited)) {
      const signature = method.markdown.match(/^> (.+)$/m)?.[1] ?? '';
      const about = summary(method.markdown);
      lines.push(
        `- \`${symbol}.${method.name}\`: ${plain(signature)}${about ? ` — ${about}` : ''}`
      );
    }
  }
  for (const kind of ['Functions', 'Types'])
    if (kinds[kind]?.length)
      lines.push('', `${kind}: ${kinds[kind].join(', ')}`);
  return `${lines.join('\n')}\n`;
}
