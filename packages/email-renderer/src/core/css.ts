import {
  type CssNode,
  generate,
  ident,
  type List,
  type ListItem,
  parse,
  walk,
} from 'css-tree';
import { type ImagePolicy, imageUrl } from './resource-policy';

interface CssOptions {
  stripColorScheme?: boolean;
}

/** Sanitize CSS without applying the reader's theme policy to outgoing HTML. */
export function prepareCss(
  css: string,
  inline: boolean,
  images: ImagePolicy,
  options: CssOptions = {}
): string {
  try {
    const ast = parse(css, {
      context: inline ? 'declarationList' : 'stylesheet',
      parseCustomProperty: true,
    });
    // Match the existing reader: only root-level media rules are theme
    // overrides. Nested rules remain part of the sender's stylesheet.
    if (options.stripColorScheme && ast.type === 'StyleSheet') {
      ast.children.forEach((node, item, list) => {
        if (
          node.type === 'Atrule' &&
          ident.decode(node.name).toLowerCase() === 'media' &&
          node.prelude &&
          /prefers-color-scheme/i.test(ident.decode(generate(node.prelude)))
        )
          list.remove(item);
      });
    }
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

export function stripColorSchemeMediaQueries(css: string): string {
  return prepareCss(
    css,
    false,
    { remote: 'allow' },
    { stripColorScheme: true }
  );
}
