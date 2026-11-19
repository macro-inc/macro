import {
  type CssNode,
  generate,
  ident,
  List,
  type ListItem,
  type MediaFeature,
  type MediaQuery,
  parse,
  walk,
} from 'css-tree';
import { type ImagePolicy, imageUrl } from './resource-policy';

/** Sanitize CSS without applying the reader's theme policy to outgoing HTML. */
export function prepareCss(
  css: string,
  inline: boolean,
  images: ImagePolicy
): string {
  try {
    const ast = parse(css, {
      context: inline ? 'declarationList' : 'stylesheet',
      parseCustomProperty: true,
    });
    walk(ast, {
      enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
        // CSS parsers recover at declaration/rule boundaries. Discard only the
        // unparsed construct so one sender typo cannot erase the whole sheet.
        if (node.type === 'Raw' && list) {
          list.remove(item);
          return walk.skip;
        }
        if (node.type === 'Atrule') {
          const name = ident.decode(node.name).toLowerCase();
          if (
            ![
              'media',
              'supports',
              'layer',
              'scope',
              'namespace',
              'container',
              'page',
            ].includes(name) ||
            (name === 'scope' &&
              node.prelude &&
              /:host|::slotted|:global/i.test(
                ident.decode(generate(node.prelude))
              ))
          ) {
            list.remove(item);
            return walk.skip;
          }
        }
        if (
          node.type === 'Rule' &&
          (node.prelude.type === 'Raw' ||
            /:host|::slotted|:global/i.test(
              ident.decode(generate(node.prelude))
            ))
        ) {
          list.remove(item);
          return walk.skip;
        }
        if (node.type === 'Declaration') {
          let unsafe = /^(?:behavior|-moz-binding|animation|transition)/i.test(
            ident.decode(node.property)
          );
          walk(node.value, (value) => {
            if (value.type === 'Raw') unsafe = true;
            if (
              value.type === 'Function' &&
              /^(?:expression|url)$/i.test(ident.decode(value.name))
            )
              unsafe = true;
            if (
              value.type === 'Function' &&
              /^(?:-webkit-)?image-set$/i.test(ident.decode(value.name))
            ) {
              // image-set also accepts bare CSS strings as URLs. Unlike type()
              // MIME strings, these direct children can initiate image loads.
              value.children.forEach((candidate) => {
                if (candidate.type === 'String') {
                  const url = imageUrl(candidate.value, {
                    remote: images.remote,
                  });
                  if (!url || /^cid:/i.test(url)) unsafe = true;
                  else candidate.value = url;
                }
              });
              // Functions such as var()/env() can expand strings into URLs.
              // The blocked policy excludes image-set rather than trying to
              // reproduce the browser's dynamic CSS value evaluation.
              if (images.remote === 'block') unsafe = true;
            }
            if (
              value.type === 'Function' &&
              ident.decode(value.name).toLowerCase() === 'var'
            ) {
              // Preserve browser cascade semantics in the normal reader.
              // The opt-in blocked policy cannot trust inherited variable
              // values to be free of resource URLs.
              if (images.remote === 'block') unsafe = true;
            }
            if (value.type === 'Url') {
              const url = imageUrl(value.value, { remote: images.remote });
              if (!url || /^cid:/i.test(url)) unsafe = true;
              else value.value = url;
            }
          });
          if (unsafe) {
            list.remove(item);
            return walk.skip;
          }
        }
      },
    });
    // Keep style text safe when embedded into HTML, including CSS strings.
    return generate(ast).replace(/</g, '\\3c ');
  } catch {
    return '';
  }
}

export type ColorScheme = 'light' | 'dark';

export interface SchemeStylesheet {
  css: string;
  /** The sender wrote rules for a dark color scheme. */
  hasDarkRules: boolean;
}

/**
 * Evaluate the sender's `prefers-color-scheme` media queries against the
 * app's theme instead of the operating system's. A query for the other
 * scheme drops out; a matching one keeps its remaining conditions.
 */
export function applyColorScheme(
  css: string,
  scheme: ColorScheme
): SchemeStylesheet {
  let hasDarkRules = false;
  try {
    const ast = parse(css, {
      context: 'stylesheet',
      parseCustomProperty: true,
    });
    walk(ast, {
      visit: 'Atrule',
      enter(node, item, list) {
        if (
          ident.decode(node.name).toLowerCase() !== 'media' ||
          !node.prelude ||
          !/prefers-color-scheme/i.test(ident.decode(generate(node.prelude)))
        )
          return;
        // Unparsed preludes (e.g. `(not (prefers-color-scheme: dark))`) can't
        // be evaluated, so the rule can't be applied for either scheme.
        if (node.prelude.type !== 'AtrulePrelude') {
          list.remove(item);
          return walk.skip;
        }
        const queryList = node.prelude.children.first;
        if (queryList?.type !== 'MediaQueryList') {
          list.remove(item);
          return walk.skip;
        }
        const queries: CssNode[] = [];
        queryList.children.forEach((query) => {
          if (query.type !== 'MediaQuery') return;
          const evaluated = evaluateSchemeQuery(query, scheme);
          if (evaluated.hasDarkFeature) hasDarkRules = true;
          if (evaluated.query) queries.push(evaluated.query);
        });
        if (!queries.length) {
          list.remove(item);
          return walk.skip;
        }
        queryList.children = new List<CssNode>().fromArray(queries);
      },
    });
    return { css: generate(ast), hasDarkRules };
  } catch {
    // The input is already sanitized; leave it as it was.
    return { css, hasDarkRules: false };
  }
}

/** One media query with its color-scheme features resolved: null when it
 *  can't match the scheme, otherwise the query without those features. */
function evaluateSchemeQuery(
  query: MediaQuery,
  scheme: ColorScheme
): { query: MediaQuery | null; hasDarkFeature: boolean } {
  const tokens = query.children.toArray();
  let hasDarkFeature = false;
  let matches = true;
  for (const token of tokens) {
    if (!isSchemeFeature(token)) continue;
    const value =
      token.value?.type === 'Identifier'
        ? token.value.name.toLowerCase()
        : undefined;
    if (value === 'dark') hasDarkFeature = true;
    if (value !== undefined && value !== scheme) matches = false;
  }
  // `not` negates the whole query; resolving one feature inside it would
  // need the rest evaluated too, so the query never applies.
  const negated = tokens.some(
    (token) => token.type === 'Identifier' && token.name.toLowerCase() === 'not'
  );
  if (!matches || negated) return { query: null, hasDarkFeature };

  // Drop the resolved features and the `and` that joined each one.
  const remaining: CssNode[] = [];
  for (const token of tokens) {
    if (isSchemeFeature(token)) {
      if (isAndNode(remaining.at(-1))) remaining.pop();
      continue;
    }
    if (isAndNode(token) && (!remaining.length || isAndNode(remaining.at(-1))))
      continue;
    remaining.push(token);
  }
  if (!remaining.length) remaining.push({ type: 'Identifier', name: 'all' });
  return {
    query: { ...query, children: new List<CssNode>().fromArray(remaining) },
    hasDarkFeature,
  };
}

function isSchemeFeature(node: CssNode): node is MediaFeature {
  return (
    node.type === 'MediaFeature' &&
    node.name.toLowerCase() === 'prefers-color-scheme'
  );
}

function isAndNode(node: CssNode | undefined): boolean {
  return node?.type === 'Identifier' && node.name.toLowerCase() === 'and';
}
