#!/usr/bin/env bun
/**
 * Adoption audit for the `@ui` component library.
 *
 * Answers three questions across `apps/web/src`:
 *   1. How much is each component actually used?
 *   2. How often is a usage reskinned with utility classes? Layout classes are
 *      expected; classes that repaint or resize a component mean its own API
 *      did not cover the need, and that is the signal worth chasing.
 *   3. How many primitives are still hand-rolled (`<button>`) instead of taken
 *      from the library (`<Button>`)?
 *
 * Parses with the TypeScript compiler rather than matching text: JSX is
 * routinely formatted across several lines and imports get renamed
 * (`Calendar as MiniCalendar`), both of which quietly wreck regex counts.
 *
 * Raw Tailwind palette classes are deliberately not checked here —
 * `check-tailwind.ts` already guards those on changed lines in CI.
 *
 *   bun scripts/ui-audit.ts                  # ranked report
 *   bun scripts/ui-audit.ts --json out.json  # machine-readable artifact
 *   bun scripts/ui-audit.ts --explain        # class-token frequencies
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const SRC = 'src';
/** The library's own source: usage inside it is implementation, not adoption. */
const LIBRARY_DIR = join('src', 'components', 'ui');

/**
 * Intrinsic elements the library either covers or ought to. `component: null`
 * means no library primitive exists yet, which is a gap in the library rather
 * than call sites ignoring it — the report says so instead of implying 100%
 * non-adoption.
 */
const HAND_ROLLED: Record<string, string | null> = {
  button: 'Button',
  input: null,
  textarea: null,
  select: 'Select',
};

/**
 * Utility prefixes that change a component's own appearance or control size.
 * A component carrying these is being reskinned at the call site.
 */
const OVERRIDE = [
  /^bg-/, /^text-/, /^font-/, /^border(-|$)/, /^rounded(-|$)/, /^ring(-|$)/,
  /^shadow(-|$)/, /^divide-/, /^outline(-|$)/, /^opacity-/,
  /^p[xytblr]?-/, /^gap(-|$)/, /^h-/, /^size-/, /^leading-/, /^tracking-/,
];

/**
 * Utility prefixes that position a component within its parent. These are the
 * call site's business, not the component's, so they are not misfit signals.
 */
const LAYOUT = [
  /^(flex|grid|block|inline|inline-flex|inline-block|contents|hidden|table)$/,
  /^(absolute|relative|fixed|sticky|static)$/,
  /^(items|justify|self|place|content|order|col|row|basis|grow|shrink)(-|$)/,
  /^m[xytblr]?-/, /^-m[xytblr]?-/, /^(top|left|right|bottom|inset)-/,
  /^-?(top|left|right|bottom|inset)-/, /^z-/, /^w-/, /^(min|max)-[wh]-/,
  /^(overflow|whitespace|break|truncate)(-|$)/, /^aspect-/,
  /^(translate|rotate|scale|transform|transition|duration|ease|delay|animate)(-|$)/,
  /^-?(translate|rotate|scale)-/,
  /^(pointer-events|select|cursor|touch)-/, /^(group|peer)(-|$)/,
  /^sr-only$/, /^(space)-[xy]-/, /^flex-/, /^(float|clear)-/, /^(list|align)-/,
];

type Site = { file: string; line: number; classes: string };

type ComponentStat = {
  name: string;
  files: Set<string>;
  usages: number;
  withClass: number;
  withOverride: number;
  overrideTokens: Map<string, number>;
  sites: Site[];
};

type HandRolledStat = {
  element: string;
  suggested: string | null;
  usages: number;
  files: Set<string>;
  sites: Site[];
};

const components = new Map<string, ComponentStat>();
const handRolled = new Map<string, HandRolledStat>();
const unclassified = new Map<string, number>();
let scannedFiles = 0;

function statFor(name: string): ComponentStat {
  let stat = components.get(name);
  if (!stat) {
    stat = {
      name,
      files: new Set(),
      usages: 0,
      withClass: 0,
      withOverride: 0,
      overrideTokens: new Map(),
      sites: [],
    };
    components.set(name, stat);
  }
  return stat;
}

/** Collects every `.tsx` worth scanning, skipping the library and test/doc files. */
function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collectFiles(path, out);
    } else if (
      entry.name.endsWith('.tsx') &&
      !entry.name.endsWith('.test.tsx') &&
      !entry.name.endsWith('.spec.tsx') &&
      !entry.name.endsWith('.docs.tsx') &&
      !path.startsWith(LIBRARY_DIR)
    ) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Strips Tailwind variant prefixes to get the underlying utility, respecting
 * brackets so an arbitrary variant like `[&:hover]:bg-x` is not split inside
 * its own selector.
 */
export function baseUtility(token: string): string {
  let depth = 0;
  let lastColon = -1;
  for (let i = 0; i < token.length; i++) {
    const char = token[i]!;
    if (char === '[' || char === '(') depth++;
    else if (char === ']' || char === ')') depth--;
    else if (char === ':' && depth === 0) lastColon = i;
  }
  return token.slice(lastColon + 1).replace(/^!/, '');
}

export type ClassKind = 'override' | 'layout' | 'unknown';

export function classifyToken(token: string): ClassKind {
  const base = baseUtility(token);
  if (!base) return 'unknown';
  // Layout is checked first: `w-` and `max-h-` would otherwise be caught by
  // the `h-` override rule.
  if (LAYOUT.some((pattern) => pattern.test(base))) return 'layout';
  if (OVERRIDE.some((pattern) => pattern.test(base))) return 'override';
  return 'unknown';
}

/**
 * The leftmost identifier of a tag name (`Panel.Body` -> `Panel`), used to
 * resolve the import, plus the full path used as the reported name. Slots are
 * reported separately because the same class means different things on each:
 * `rounded-xl` on `Panel` is a reskin, `p-3` on `Panel.Body` is content
 * spacing the caller owns.
 */
function tagNames(
  tag: ts.JsxTagNameExpression
): { root: string; full: string } | undefined {
  if (ts.isIdentifier(tag)) return { root: tag.text, full: tag.text };
  if (ts.isPropertyAccessExpression(tag)) {
    const parts: string[] = [];
    let current: ts.Expression = tag;
    while (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text);
      current = current.expression;
    }
    if (!ts.isIdentifier(current)) return undefined;
    parts.unshift(current.text);
    return { root: current.text, full: parts.join('.') };
  }
  return undefined;
}

/** Every string literal reachable from a class attribute, so `cn('a', x && 'b')` is covered. */
function classStrings(attributes: ts.JsxAttributes): string[] {
  const found: string[] = [];

  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    const name = ts.isIdentifier(attribute.name)
      ? attribute.name.text
      : attribute.name.getText();
    if (name !== 'class' && name !== 'className') continue;

    const initializer = attribute.initializer;
    if (!initializer) continue;
    if (ts.isStringLiteral(initializer)) {
      found.push(initializer.text);
      continue;
    }
    if (ts.isJsxExpression(initializer) && initializer.expression) {
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          found.push(node.text);
        } else if (ts.isTemplateExpression(node)) {
          found.push(node.head.text);
          for (const span of node.templateSpans) found.push(span.literal.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(initializer.expression);
    }
  }

  return found;
}

function scan(file: string) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  scannedFiles++;

  /** Local binding name -> canonical `@ui` export. */
  const localToCanonical = new Map<string, string>();

  const collectImports = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const module = node.moduleSpecifier.text;
      if (module === '@ui' || module.startsWith('@ui/components/')) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const canonical = (element.propertyName ?? element.name).text;
            localToCanonical.set(element.name.text, canonical);
          }
        }
      }
    }
    ts.forEachChild(node, collectImports);
  };
  collectImports(source);

  // `cn` and friends are utilities, not components.
  for (const helper of ['cn', 'buttonClasses', 'badgeClasses', 'badgeTriggerClasses']) {
    localToCanonical.delete(helper);
  }

  const lineOf = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const record = (
    tag: { root: string; full: string },
    attributes: ts.JsxAttributes,
    node: ts.Node
  ) => {
    const line = lineOf(node);

    if (tag.root === tag.root.toLowerCase() && tag.root in HAND_ROLLED) {
      let stat = handRolled.get(tag.root);
      if (!stat) {
        stat = {
          element: tag.root,
          suggested: HAND_ROLLED[tag.root] ?? null,
          usages: 0,
          files: new Set(),
          sites: [],
        };
        handRolled.set(tag.root, stat);
      }
      stat.usages++;
      stat.files.add(file);
      stat.sites.push({ file, line, classes: classStrings(attributes).join(' ') });
      return;
    }

    const canonical = localToCanonical.get(tag.root);
    if (!canonical) return;

    // Report under the slot actually used, with the import's canonical name as
    // the root so a renamed import still lands on the right component.
    const reported =
      tag.full === tag.root
        ? canonical
        : `${canonical}.${tag.full.split('.').slice(1).join('.')}`;
    const stat = statFor(reported);
    stat.usages++;
    stat.files.add(file);

    const classes = classStrings(attributes).join(' ').trim();
    if (!classes) return;
    stat.withClass++;

    const tokens = classes.split(/\s+/).filter(Boolean);
    const overrides: string[] = [];
    for (const token of tokens) {
      const kind = classifyToken(token);
      if (kind === 'override') overrides.push(baseUtility(token));
      else if (kind === 'unknown') {
        unclassified.set(
          baseUtility(token),
          (unclassified.get(baseUtility(token)) ?? 0) + 1
        );
      }
    }

    if (overrides.length > 0) {
      stat.withOverride++;
      stat.sites.push({ file, line, classes });
      for (const token of overrides) {
        stat.overrideTokens.set(token, (stat.overrideTokens.get(token) ?? 0) + 1);
      }
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = tagNames(node.tagName);
      if (tag) record(tag, node.attributes, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

// --- report -----------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const jsonIndex = args.indexOf('--json');
  const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : undefined;
  const explain = args.includes('--explain');
  const SITE_LIMIT = 25;
  
  for (const file of collectFiles(SRC)) scan(file);
  
  const ranked = [...components.values()].sort((a, b) => b.usages - a.usages);
  const rate = (stat: ComponentStat) =>
    stat.usages === 0 ? 0 : stat.withOverride / stat.usages;
  
  const pad = (value: string, width: number) => value.padEnd(width);
  const padStart = (value: string | number, width: number) =>
    String(value).padStart(width);
  
  console.log(`\nScanned ${scannedFiles} files under apps/web/${SRC} (library itself excluded)\n`);
  
  console.log(pad('COMPONENT', 22) + padStart('files', 6) + padStart('uses', 6) +
    padStart('class', 7) + padStart('over', 6) + padStart('rate', 7) + '  top overrides');
  console.log('─'.repeat(94));
  for (const stat of ranked) {
    const top = [...stat.overrideTokens.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([token, count]) => `${token}×${count}`)
      .join(' ');
    console.log(
      pad(stat.name, 22) +
        padStart(stat.files.size, 6) +
        padStart(stat.usages, 6) +
        padStart(stat.withClass, 7) +
        padStart(stat.withOverride, 6) +
        padStart(`${Math.round(rate(stat) * 100)}%`, 7) +
        '  ' + top
    );
  }
  
  const totalUsages = ranked.reduce((sum, stat) => sum + stat.usages, 0);
  const totalOverride = ranked.reduce((sum, stat) => sum + stat.withOverride, 0);
  console.log('─'.repeat(94));
  console.log(
    pad('TOTAL', 22) + padStart('', 6) + padStart(totalUsages, 6) +
      padStart(ranked.reduce((s, x) => s + x.withClass, 0), 7) +
      padStart(totalOverride, 6) +
      padStart(`${Math.round((totalOverride / Math.max(totalUsages, 1)) * 100)}%`, 7)
  );
  
  console.log('\nHAND-ROLLED PRIMITIVES\n' + '─'.repeat(94));
  for (const stat of [...handRolled.values()].sort((a, b) => b.usages - a.usages)) {
    if (!stat.suggested) {
      console.log(
        pad(`<${stat.element}>`, 22) +
          padStart(stat.usages, 6) +
          `  across ${stat.files.size} files` +
          '   — no library component exists yet'
      );
      continue;
    }
    const libraryUses = components.get(stat.suggested)?.usages ?? 0;
    const share = Math.round(
      (stat.usages / Math.max(stat.usages + libraryUses, 1)) * 100
    );
    console.log(
      pad(`<${stat.element}>`, 22) +
        padStart(stat.usages, 6) +
        `  vs ${padStart(libraryUses, 4)} <${stat.suggested}>` +
        `   ${share}% hand-rolled, across ${stat.files.size} files`
    );
  }
  
  if (explain) {
    console.log('\nUNCLASSIFIED CLASS TOKENS (tune OVERRIDE / LAYOUT with these)\n' + '─'.repeat(94));
    for (const [token, count] of [...unclassified.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)) {
      console.log(pad(token, 34) + padStart(count, 5));
    }
  }
  
  if (jsonPath) {
    const report = {
      generatedAt: new Date().toISOString(),
      scannedFiles,
      components: ranked.map((stat) => ({
        name: stat.name,
        files: stat.files.size,
        usages: stat.usages,
        withClass: stat.withClass,
        withOverride: stat.withOverride,
        overrideRate: Number(rate(stat).toFixed(3)),
        topOverrides: [...stat.overrideTokens.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([token, count]) => ({ token, count })),
        sites: stat.sites
          .slice(0, SITE_LIMIT)
          .map((site) => ({ ...site, file: relative(SRC, site.file) })),
        truncatedSites: Math.max(0, stat.sites.length - SITE_LIMIT),
      })),
      handRolled: [...handRolled.values()]
        .sort((a, b) => b.usages - a.usages)
        .map((stat) => ({
          element: stat.element,
          suggested: stat.suggested,
          usages: stat.usages,
          files: stat.files.size,
          libraryUsages: stat.suggested
            ? (components.get(stat.suggested)?.usages ?? 0)
            : null,
          sites: stat.sites
            .slice(0, SITE_LIMIT)
            .map((site) => ({ file: relative(SRC, site.file), line: site.line })),
          truncatedSites: Math.max(0, stat.sites.length - SITE_LIMIT),
        })),
    };
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nWrote ${jsonPath}`);
  }
}
