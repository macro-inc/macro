import {
  type CssNode,
  type Declaration,
  generate,
  ident,
  type List,
  type ListItem,
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

/**
 * Evaluate the sender's `prefers-color-scheme` media queries against the
 * app's theme instead of the operating system's. A query for the other
 * scheme drops out; in a matching one the scheme condition becomes always
 * true. `darkBackground` reports whether rules written for a dark scheme now
 * apply and paint a background: the sender designed a dark version, not
 * just a few dark-mode tweaks. `mediaMatches` evaluates a rule's remaining
 * conditions (print, width); core has no media environment of its own.
 */
export function applyColorScheme(
  css: string,
  scheme: ColorScheme,
  mediaMatches: (query: string) => boolean = () => true
): { css: string; darkBackground: boolean } {
  let darkBackground = false;
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
        const queryList =
          node.prelude.type === 'AtrulePrelude'
            ? node.prelude.children.first
            : null;
        if (queryList?.type !== 'MediaQueryList') {
          list.remove(item);
          return walk.skip;
        }
        let appliesDark = false;
        queryList.children.forEach((query, queryItem, queries) => {
          const resolved =
            query.type === 'MediaQuery'
              ? resolveSchemeQuery(query, scheme)
              : null;
          if (resolved === null) queries.remove(queryItem);
          else if (resolved && scheme === 'dark') appliesDark = true;
        });
        if (queryList.children.isEmpty) {
          list.remove(item);
          return walk.skip;
        }
        if (appliesDark && node.block && mediaMatches(generate(queryList)))
          walk(node.block, (child) => {
            // Nested color-scheme rules are resolved on their own visit.
            if (
              child.type === 'Atrule' &&
              child.prelude &&
              /prefers-color-scheme/i.test(generate(child.prelude))
            )
              return walk.skip;
            if (child.type === 'Declaration' && paintsBackground(child))
              darkBackground = true;
          });
      },
    });
    return { css: generate(ast), darkBackground };
  } catch {
    // The input is already sanitized; leave it as it was.
    return { css, darkBackground: false };
  }
}

const BACKGROUND_PROPERTY = /^background(?:-color|-image)?$/i;
// A color, gradient or custom property (usually the design's surface
// color); an image (a dark-mode logo swap) or a reset doesn't make a dark
// design.
const BACKGROUND_PAINT =
  /#[0-9a-f]{3,8}\b|\b(?:var|rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|(?:repeating-)?(?:linear|radial|conic)-gradient)\(|^(?!transparent|none|inherit|initial|unset|revert|currentcolor)[a-z]+$/i;

function paintsBackground(declaration: Declaration): boolean {
  return (
    BACKGROUND_PROPERTY.test(declaration.property) &&
    BACKGROUND_PAINT.test(generate(declaration.value))
  );
}

/** Resolve one media query's color-scheme features against the scheme:
 *  null when the query can't match, true when it matched one (now always
 *  true), false when it has none. */
function resolveSchemeQuery(
  query: MediaQuery,
  scheme: ColorScheme
): boolean | null {
  let usesScheme = false;
  let matches = true;
  let negated = false;
  query.children.forEach((token) => {
    if (token.type === 'Identifier' && token.name.toLowerCase() === 'not')
      negated = true;
    if (token.type !== 'MediaFeature') return;
    if (token.name.toLowerCase() !== 'prefers-color-scheme') return;
    usesScheme = true;
    if (
      token.value?.type === 'Identifier' &&
      token.value.name.toLowerCase() !== scheme
    )
      matches = false;
    token.name = 'min-width';
    token.value = { type: 'Number', value: '0' };
  });
  if (!usesScheme) return false;
  // `not` negates the whole query; resolving one feature inside it would
  // need the rest evaluated too, so the query never applies.
  return matches && !negated ? true : null;
}
