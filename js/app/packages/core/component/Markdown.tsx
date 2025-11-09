import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { urlAttributes } from 'html-url-attributes';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
/** This file is a port of `react-markdown` to SolidJS
 *https://github.com/remarkjs/react-markdown/blob/main/lib/index.js
 */
import { type Component, createMemo, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { VFile } from 'vfile';

type AllowElement = (
  element: any,
  index: number,
  parent: any
) => boolean | null | undefined;
type Components = Partial<Record<string, Component<any>>>;
type Options = {
  allowElement?: AllowElement;
  allowedElements?: ReadonlyArray<string>;
  children?: string;
  className?: string;
  components?: Components;
  disallowedElements?: ReadonlyArray<string>;
  rehypePlugins?: any[];
  remarkPlugins?: any[];
  remarkRehypeOptions?: any;
  skipHtml?: boolean;
  unwrapDisallowed?: boolean;
  urlTransform?: (url: string, key: string, node: any) => string;
};

const emptyPlugins: any[] = [];
const emptyRemarkRehypeOptions = { allowDangerousHtml: true };
const safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i;

export function Markdown(props: Options) {
  const [state, setState] = createStore({
    content: null as JSX.Element | null,
  });

  const processor = unified()
    .use(remarkParse)
    .use(props.remarkPlugins || emptyPlugins)
    // ignore single dollar text math e.g. $x$ - very important formatting fix @jbecke
    .use(remarkMath, { singleDollarTextMath: false }) // this parses the latex e.g. $$ to `math` or `math-inline for rehypeKatex to render
    .use(remarkRehype, props.remarkRehypeOptions || emptyRemarkRehypeOptions)
    .use(props.rehypePlugins || emptyPlugins);

  const renderMarkdown = createMemo(() => {
    const file = new VFile();
    file.value = props.children || '';

    if (props.allowedElements && props.disallowedElements) {
      throw new Error('Cannot combine allowedElements and disallowedElements');
    }

    const mdastTree = processor.parse(file);
    let hastTree = processor.runSync(mdastTree, file) as any;

    if (props.className) {
      hastTree = {
        type: 'element',
        tagName: 'div',
        properties: { className: props.className },
        children: hastTree.type === 'root' ? hastTree.children : [hastTree],
      };
    }

    visit(hastTree, transform);

    const jsxElements = toJsxRuntime(hastTree, {
      Fragment: (props: any) => props.children,
      components: props.components,
      ignoreInvalidStyle: true,
      jsx: (type: any, props: any) => {
        if (typeof type === 'string') {
          return <Dynamic component={type} {...props} />;
        }
        return type(props);
      },
      jsxs: (type, props) => {
        if (typeof type === 'string') {
          return <Dynamic component={type} {...props} />;
        }
        // @ts-ignore
        return type(props);
      },
      passKeys: true,
      passNode: true,
    }) as unknown as JSX.Element;

    setState({ content: jsxElements });
  });

  function transform(node: any, index: number | undefined, parent: any) {
    if (node.type === 'raw' && parent && typeof index === 'number') {
      if (props.skipHtml) {
        parent.children.splice(index, 1);
      } else {
        parent.children[index] = { type: 'text', value: node.value };
      }
      return index;
    }
    // :)
    if (
      node.type === 'text' &&
      (node.value === '<br>' || node.value === '<br />')
    ) {
      const br = { type: 'element', value: '', tagName: 'br', children: [] };
      parent.children.splice(index, 1, br);
      return;
    }
    if (node.type === 'element') {
      for (const key in urlAttributes) {
        if (
          Object.prototype.hasOwnProperty.call(urlAttributes, key) &&
          Object.prototype.hasOwnProperty.call(node.properties, key)
        ) {
          const value = node.properties[key];
          const test = urlAttributes[key];
          if (test === null || test.includes(node.tagName)) {
            node.properties[key] = props.urlTransform
              ? props.urlTransform(String(value || ''), key, node)
              : defaultUrlTransform(String(value || ''));
          }
        }
      }

      let remove = props.allowedElements
        ? !props.allowedElements.includes(node.tagName)
        : props.disallowedElements
          ? props.disallowedElements.includes(node.tagName)
          : false;

      if (!remove && props.allowElement && typeof index === 'number') {
        remove = !props.allowElement(node, index, parent);
      }

      if (remove && parent && typeof index === 'number') {
        if (props.unwrapDisallowed && node.children) {
          parent.children.splice(index, 1, ...node.children);
        } else {
          parent.children.splice(index, 1);
        }
        return index;
      }
    }
  }
  renderMarkdown();

  return <>{state.content}</>;
}

export function defaultUrlTransform(value: string): string {
  const colon = value.indexOf(':');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  const slash = value.indexOf('/');

  if (
    colon < 0 ||
    (slash > -1 && colon > slash) ||
    (questionMark > -1 && colon > questionMark) ||
    (numberSign > -1 && colon > numberSign) ||
    safeProtocol.test(value.slice(0, colon))
  ) {
    return value;
  }

  return '';
}
