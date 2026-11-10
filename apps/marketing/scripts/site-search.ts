import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { SearchPage } from '../src/features/documentation/core/page-search';
import { FEATURE_PAGES } from '../src/features/marketing/core/navigation';
import { workspaceFeatures } from '../src/features/marketing/core/workspace-features';

const root = path.resolve(import.meta.dirname, '../src');

/** Keep discovery focused, and combine reference text with its feature page. */
export function curateSearchPages(pages: SearchPage[]): SearchPage[] {
  const merged = new Map<string, SearchPage>();
  for (const page of pages) {
    if (
      /\/changelog(?:\/|$)|\/AI\/mcp\/tools(?:\/|$)/.test(page.href) ||
      /^(Legal|Company)$|^Blog · (?!Comparison$|Customer stories$)/.test(
        page.context
      )
    )
      continue;
    const href = page.href.replace(/#guide(?:-.*)?$/, '');
    const existing = merged.get(href);
    if (existing) existing.text += ` ${page.text}`;
    else merged.set(href, { ...page, href });
  }
  return [...merged.values()];
}

/** Index human text at build time; never ship source code or article components. */
export function sourceSearchText(source: string): string {
  const file = ts.createSourceFile(
    'page.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const text: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) return;
    if (
      ts.isJsxAttribute(node) &&
      !['title', 'description', 'subtitle', 'label', 'alt', 'caption'].includes(
        node.name.getText(file)
      )
    )
      return;
    if (
      ts.isJsxText(node) ||
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      const value = node.text.trim();
      if (value && !/^(https?:|[./#])/.test(value)) text.push(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return text.join(' ').replace(/\s+/g, ' ');
}

export function postSearchPage(source: string): SearchPage | undefined {
  const file = ts.createSourceFile(
    'post.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let result: SearchPage | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'postMeta' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const fields: Record<string, string> = {};
      for (const property of node.initializer.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          ts.isStringLiteral(property.initializer)
        )
          fields[property.name.text] = property.initializer.text;
      }
      if (fields.slug && fields.title)
        result = {
          href: `/posts/${fields.slug}`,
          title: fields.title,
          context: fields.category ? `Blog · ${fields.category}` : 'Blog',
          iconHref: `/posts/${fields.slug}`,
          text: sourceSearchText(source),
        };
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return result;
}

const featureSources: Record<string, string> = {
  '/email': 'app/routes/RouteEmail.tsx',
  '/tasks': 'app/routes/RouteTasks.tsx',
  '/crm': 'app/routes/RouteCrm.tsx',
  '/channels': 'features/marketing/views/ProductChannelsPage.tsx',
  '/documents': 'features/marketing/views/ProductDocumentsPage.tsx',
  '/calls': 'features/marketing/views/ProductCallsPage.tsx',
  '/agents': 'features/marketing/views/ProductAgentsPage.tsx',
  '/github': 'features/marketing/views/ProductReviewsPage.tsx',
};
const otherPages = [
  [
    '/',
    'Home',
    'Website',
    'features/marketing/components/homepage/MacroHero.tsx',
  ],
  ['/pricing', 'Pricing', 'Website', 'app/routes/RoutePricing.tsx'],
  [
    '/replace-apps',
    'Replace 27+ apps',
    'Main benefits',
    'features/marketing/views/ReplaceAppsPage.tsx',
  ],
  ['/download', 'Download Macro', 'Website', 'app/routes/RouteDownload.tsx'],
  ['/demo', 'Try Macro', 'Website', 'app/routes/RouteDemo.tsx'],
  [
    '/tour',
    'Product tour',
    'Website',
    'features/marketing/views/SalesPage.tsx',
  ],
  ['/jobs', 'Jobs', 'Company', 'app/routes/RouteJobs.tsx'],
  [
    '/wall-of-love',
    'Wall of love',
    'Company',
    'app/routes/RouteWallOfLove.tsx',
  ],
  ['/partners', 'Partners', 'Company', 'app/routes/RoutePartners.tsx'],
  ['/posts', 'Blog', 'Website', 'routes/posts/index.tsx'],
  ['/legal', 'Legal', 'Website', 'app/routes/RouteLegal.tsx'],
  ['/terms', 'Terms of service', 'Legal', 'app/routes/RouteTerms.tsx'],
  ['/privacy', 'Privacy policy', 'Legal', 'app/routes/RoutePrivacy.tsx'],
  ['/dpa', 'Data processing agreement', 'Legal', 'app/routes/RouteDpa.tsx'],
  [
    '/delete-account',
    'Delete account',
    'Legal',
    'app/routes/RouteDeleteAccount.tsx',
  ],
  [
    '/partners/terms',
    'Partner terms',
    'Legal',
    'app/routes/RoutePartnerTerms.tsx',
  ],
] as const;

export function publicSearchPages(
  watch: (filename: string) => void
): SearchPage[] {
  const read = (relative: string) => {
    const filename = path.join(root, relative);
    watch(filename);
    return fs.readFileSync(filename, 'utf8');
  };
  watch(path.join(root, 'features/marketing/core/workspace-features.ts'));
  const features = FEATURE_PAGES.map(
    (page): SearchPage => ({
      href: page.href,
      title: page.label,
      context: 'Features',
      iconHref: page.guide,
      text: featureSources[page.href]
        ? sourceSearchText(read(featureSources[page.href]))
        : JSON.stringify(workspaceFeatures[page.href.slice(1)]),
    })
  );
  const other = otherPages.map(
    ([href, title, context, source]): SearchPage => ({
      href,
      title,
      context,
      iconHref: href,
      text: sourceSearchText(read(source)),
    })
  );
  const postsRoot = path.join(root, 'routes/posts/entries');
  const posts = fs.readdirSync(postsRoot).flatMap((folder) => {
    const relative = `routes/posts/entries/${folder}/index.tsx`;
    if (!fs.existsSync(path.join(root, relative))) return [];
    const page = postSearchPage(read(relative));
    return page ? [page] : [];
  });
  return [...features, ...other, ...posts];
}
