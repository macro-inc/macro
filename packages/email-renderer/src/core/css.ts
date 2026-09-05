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

/** Parse CSS without CSSOM. Reject unparsed constructs and implicit loads. */
export function prepareCss(
  css: string,
  inline: boolean,
  images: ImagePolicy
): string {
  try {
    const ast = parse(css, {
      context: inline ? 'declarationList' : 'stylesheet',
      onParseError(error) {
        throw error;
      },
    });
    walk(ast, {
      enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
        if (node.type === 'Atrule') {
          const name = ident.decode(node.name).toLowerCase();
          if (
            !['media', 'supports'].includes(name) ||
            (node.prelude &&
              /prefers-color-scheme/i.test(
                ident.decode(generate(node.prelude))
              ))
          ) {
            list.remove(item);
            return walk.skip;
          }
        }
        if (
          node.type === 'Rule' &&
          /:host|::slotted|:global/i.test(ident.decode(generate(node.prelude)))
        ) {
          list.remove(item);
          return walk.skip;
        }
        if (node.type === 'Declaration') {
          let unsafe =
            /^(?:behavior|-moz-binding|animation|transition)/i.test(
              ident.decode(node.property)
            ) || ident.decode(node.property).startsWith('--');
          walk(node.value, (value) => {
            if (value.type === 'Raw') unsafe = true;
            if (
              value.type === 'Function' &&
              /^(?:expression|var|url|(?:-webkit-)?image-set)$/i.test(
                ident.decode(value.name)
              )
            )
              unsafe = true;
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
  return prepareCss(css, false, { remote: 'allow' });
}
