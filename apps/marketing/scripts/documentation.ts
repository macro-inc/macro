import fs from 'node:fs';
import path from 'node:path';
import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import type { Plugin } from 'vite';
import { parse } from 'yaml';
import redirects from '../seo/page-redirects.json';
import { FEATURE_PAGES } from '../src/features/marketing/core/navigation';
import { TUTORIAL_VIDEOS } from '../src/features/marketing/core/tutorial-videos';
import { curateSearchPages, publicSearchPages } from './site-search';

const docsRoot = path.resolve(import.meta.dirname, '../../docs');
const moduleId = 'virtual:macro-docs';
const resolvedId = `\0${moduleId}`;
const searchId = 'virtual:macro-search';
const resolvedSearchId = `\0${searchId}`;

interface DocNode {
  type: string;
  value?: string;
  url?: string;
  depth?: number;
  name?: string;
  attributes?: { type: string; name?: string; value?: unknown }[];
  children?: DocNode[];
  data?: { hProperties?: Record<string, string> };
}
type NavigationItem = string | { group: string; pages: NavigationItem[] };

export function docsHref(href: string, slug = ''): string {
  if (href.startsWith('https://macro.com/video/tutorials/'))
    return href.slice('https://macro.com'.length);
  if (href.startsWith('/video/tutorials/')) return href;
  if (/^https:\/\/docs\.macro\.com(?:\/|$)/.test(href)) {
    href = href.slice('https://docs.macro.com'.length) || '/';
  }
  const isFeature = FEATURE_PAGES.some(
    (page) => page.guide === `/docs/${slug}`
  );
  if (href.startsWith('#')) return isFeature ? `#guide-${href.slice(1)}` : href;
  if (/^(?:[a-z]+:|\/\/)/i.test(href)) return href;
  if (/^\/(?:images|videos|logo)\//.test(href) || href === '/favicon.svg')
    return `/docs-assets${href}`;
  const split = href.search(/[?#]/);
  const pathname = split < 0 ? href : href.slice(0, split);
  const suffix = split < 0 ? '' : href.slice(split);
  const target = pathname.startsWith('/')
    ? pathname.slice(1)
    : path.posix.join(path.posix.dirname(slug), pathname);
  const clean = target.replace(/\.(mdx?|html)$/, '').replace(/\/$/, '');
  const source = `/docs${clean && clean !== 'index' ? `/${clean}` : ''}`;
  const destination = (redirects as Record<string, string>)[source] ?? source;
  if (FEATURE_PAGES.some((page) => page.href === destination)) {
    const hashAt = suffix.indexOf('#');
    const query = hashAt < 0 ? suffix : suffix.slice(0, hashAt);
    const hash = hashAt < 0 ? '' : suffix.slice(hashAt + 1);
    return `${destination}${query}#guide${hash ? `-${hash}` : ''}`;
  }
  return `${destination}${suffix}`;
}

export function readDoc(filename: string) {
  const source = fs.readFileSync(filename, 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\s*\n/);
  if (!match) throw new Error(`Missing documentation frontmatter: ${filename}`);
  const meta: unknown = parse(match[1]);
  if (
    !meta ||
    typeof meta !== 'object' ||
    !('title' in meta) ||
    typeof meta.title !== 'string'
  )
    throw new Error(`Missing title: ${filename}`);
  return {
    title: meta.title,
    description:
      'description' in meta && typeof meta.description === 'string'
        ? meta.description
        : '',
    body: source.slice(match[0].length),
  };
}

export function isDocsAsset(filename: string): boolean {
  const normalized = path.resolve(filename);
  return (
    ['images', 'videos', 'logo'].some((dir) =>
      normalized.startsWith(`${path.join(docsRoot, dir)}/`)
    ) || normalized === path.join(docsRoot, 'favicon.svg')
  );
}

function files(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    return entry.isDirectory() ? files(filename) : [filename];
  });
}

function docsIndex(full = false): string {
  return (
    '# Macro documentation\n\n' +
    files(docsRoot)
      .filter((file) => file.endsWith('.mdx'))
      .sort()
      .map((filename) => {
        const slug = path.relative(docsRoot, filename).replace(/\.mdx$/, '');
        const { title, description } = readDoc(filename);
        return full
          ? markdownDoc(filename, slug)
          : `- [${title}](https://macro.com${docsHref(`/${slug}`)}): ${description}`;
      })
      .join(full ? '\n\n---\n\n' : '\n') +
    '\n'
  );
}

function documentationMarkup(slug: string, title: string) {
  return () => (tree: DocNode) => {
    const isFeature = FEATURE_PAGES.some(
      (page) => page.guide === `/docs/${slug}`
    );
    const ids = new Map<string, number>();
    const text = (node: DocNode): string =>
      node.value ?? node.children?.map(text).join('') ?? '';
    const visit = (node: DocNode) => {
      if (node.url) node.url = docsHref(node.url, slug);
      for (const attr of node.attributes ?? []) {
        if (
          (attr.name === 'href' ||
            attr.name === 'src' ||
            attr.name === 'poster') &&
          typeof attr.value === 'string'
        )
          attr.value = docsHref(attr.value, slug);
        if (attr.name === 'className') attr.name = 'class';
      }
      if (node.name === 'video') {
        const src = node.attributes?.find((attr) => attr.name === 'src')?.value;
        const id =
          typeof src === 'string'
            ? src.match(/^\/video\/tutorials\/([^/]+)\.mp4$/)?.[1]
            : undefined;
        if (id && Object.hasOwn(TUTORIAL_VIDEOS, id)) {
          node.name = 'TutorialVideoEmbed';
          node.attributes = [
            { type: 'mdxJsxAttribute', name: 'tutorial', value: id },
          ];
        }
      }
      if (node.type === 'heading') {
        const base = text(node)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}_\s-]/gu, '')
          .replace(/\s/g, '-');
        const count = ids.get(base) ?? 0;
        ids.set(base, count + 1);
        node.data = {
          ...node.data,
          hProperties: {
            id: `${isFeature ? 'guide-' : ''}${count ? `${base}-${count}` : base}`,
          },
        };
        // The page shell owns the single H1.
        if (node.depth === 1) node.depth = 2;
      }
      if (isFeature) {
        node.children = node.children?.filter((child) => {
          // The feature page owns the demos. Keep the written reference only.
          if (
            ['video', 'iframe', 'img', 'GuideGraphic', 'Frame'].includes(
              child.name ?? ''
            )
          )
            return false;
          if (
            child.name === 'div' &&
            child.attributes?.some(
              (attr) =>
                (attr.name === 'className' || attr.name === 'class') &&
                typeof attr.value === 'string' &&
                attr.value.includes('preview')
            )
          )
            return false;
          if (child.type === 'image') return false;
          return !(
            child.type === 'paragraph' && /^Watch a \d/.test(text(child))
          );
        });
      }
      node.children?.forEach(visit);
    };
    tree.children = tree.children?.filter(
      (node) =>
        !(node.type === 'heading' && node.depth === 1 && text(node) === title)
    );
    visit(tree);
  };
}

function markdownDoc(filename: string, slug: string): string {
  const { title, body } = readDoc(filename);
  const linked = body
    .replace(
      /(href|src|poster)="([^"]+)"/g,
      (_, attr, url) => `${attr}="${docsHref(url, slug)}"`
    )
    .replace(
      /(\]\()([^\s)]+)(\))/g,
      (_, before, url, after) => `${before}${docsHref(url, slug)}${after}`
    );
  return `# ${title}\n\n${linked}`;
}

/** Compile the existing docs content into the website, never a second copy. */
export function documentation(): Plugin {
  return {
    name: 'macro-documentation',
    enforce: 'pre',
    resolveId(id) {
      if (id === moduleId) return resolvedId;
      if (id === searchId) return resolvedSearchId;
      if (id.startsWith('macro-doc:')) {
        const filename = path.resolve(docsRoot, `${id.slice(10)}.mdx`);
        if (!filename.startsWith(`${docsRoot}/`))
          throw new Error('Invalid docs path');
        return filename;
      }
    },
    async load(id) {
      if (id === resolvedId || id === resolvedSearchId) {
        const configFile = path.join(docsRoot, 'docs.json');
        this.addWatchFile(configFile);
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        const pages = files(docsRoot)
          .filter((file) => file.endsWith('.mdx'))
          .map((filename) => {
            this.addWatchFile(filename);
            const slug = path
              .relative(docsRoot, filename)
              .replace(/\.mdx$/, '');
            const { title, description, body } = readDoc(filename);
            return {
              slug,
              href: docsHref(`/${slug}`),
              title,
              description,
              keywords: [...body.matchAll(/^#{1,6} (.+)$/gm)]
                .map((m) => m[1])
                .join(' '),
              text: `${description} ${body}`
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' '),
            };
          });
        const groups = new Map<string, string>();
        const collectGroups = (
          items: NavigationItem[],
          trail: string[] = []
        ) => {
          for (const item of items) {
            if (typeof item === 'string')
              groups.set(item, trail.join(' · ') || 'Guides');
            else collectGroups(item.pages, [...trail, item.group]);
          }
        };
        collectGroups(config.navigation.pages);
        const searchPages = curateSearchPages([
          ...publicSearchPages((filename) => this.addWatchFile(filename)),
          ...pages.map((page) => ({
            ...page,
            context: groups.get(page.slug) ?? 'Guides',
            iconHref: `/docs/${page.slug}`,
          })),
        ]);
        if (id === resolvedSearchId)
          return `export const searchPages = ${JSON.stringify(searchPages)};`;
        return `export const pages = ${JSON.stringify(pages.map(({ text: _text, ...page }) => page))};\nexport const navigation = ${JSON.stringify(config.navigation.pages)};\nexport const loaders = {${pages.map((p) => `${JSON.stringify(p.slug)}: () => import(${JSON.stringify(`macro-doc:${p.slug}`)})`).join(',')}};`;
      }
      if (id.startsWith(`${docsRoot}/`) && id.endsWith('.mdx')) {
        const slug = path.relative(docsRoot, id).replace(/\.mdx$/, '');
        const { body, title } = readDoc(id);
        return String(
          await compile(body, {
            jsx: true,
            jsxImportSource: 'solid-js',
            remarkPlugins: [remarkGfm, documentationMarkup(slug, title)],
          })
        );
      }
    },
    configureServer(server) {
      server.watcher.add(docsRoot);
      server.middlewares.use((req, res, next) => {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost');
        const url = requestUrl.pathname;
        const destination = (redirects as Record<string, string>)[
          url.replace(/\/$/, '')
        ];
        if (destination) {
          res.writeHead(308, {
            Location: `${destination}${requestUrl.search}`,
          });
          res.end();
          return;
        }
        if (url === '/docs/llms.txt' || url === '/docs/llms-full.txt') {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(docsIndex(url.endsWith('llms-full.txt')));
          return;
        }
        if (url !== '/docs.md' && !/^\/docs\/.+\.md$/.test(url)) {
          next();
          return;
        }
        const slug = url === '/docs.md' ? 'index' : url.slice(6, -3);
        const filename = path.resolve(docsRoot, `${slug}.mdx`);
        if (!filename.startsWith(`${docsRoot}/`) || !fs.existsSync(filename)) {
          res.statusCode = 404;
          res.end('Guide not found');
          return;
        }
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.end(markdownDoc(filename, slug));
      });
      server.middlewares.use('/docs-assets', (req, res, next) => {
        let relative: string;
        try {
          relative = decodeURIComponent((req.url ?? '').split('?')[0]);
        } catch {
          res.statusCode = 400;
          res.end();
          return;
        }
        const filename = path.resolve(docsRoot, `.${relative}`);
        if (!isDocsAsset(filename)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
          next();
          return;
        }
        const types: Record<string, string> = {
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.mp4': 'video/mp4',
        };
        res.setHeader(
          'Content-Type',
          types[path.extname(filename)] ?? 'application/octet-stream'
        );
        fs.createReadStream(filename).pipe(res);
      });
    },
    generateBundle() {
      for (const full of [false, true]) {
        this.emitFile({
          type: 'asset',
          fileName: `docs/llms${full ? '-full' : ''}.txt`,
          source: docsIndex(full),
        });
      }
      for (const filename of files(docsRoot).filter((file) =>
        file.endsWith('.mdx')
      )) {
        const slug = path.relative(docsRoot, filename).replace(/\.mdx$/, '');
        this.emitFile({
          type: 'asset',
          fileName: slug === 'index' ? 'docs.md' : `docs/${slug}.md`,
          source: markdownDoc(filename, slug),
        });
      }
      for (const dir of ['images', 'videos', 'logo']) {
        for (const filename of files(path.join(docsRoot, dir))) {
          this.emitFile({
            type: 'asset',
            fileName: `docs-assets/${path.relative(docsRoot, filename)}`,
            source: fs.readFileSync(filename),
          });
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'docs-assets/favicon.svg',
        source: fs.readFileSync(path.join(docsRoot, 'favicon.svg')),
      });
    },
    handleHotUpdate(context) {
      if (!context.file.startsWith(`${docsRoot}/`)) return;
      const registry = context.server.moduleGraph.getModuleById(resolvedId);
      if (registry) context.server.moduleGraph.invalidateModule(registry);
      context.server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}
