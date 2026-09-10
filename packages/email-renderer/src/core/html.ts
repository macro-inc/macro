import {
  type DefaultTreeAdapterMap,
  defaultTreeAdapter,
  html as htmlConstants,
  parse,
  serialize,
  serializeOuter,
} from 'parse5';
import { prepareCss } from './css';
import { type ImagePolicy, imageUrl, linkUrl } from './resource-policy';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type Parent = DefaultTreeAdapterMap['parentNode'];
const ACTIVE = new Set(
  'script iframe frame frameset object embed applet base meta link noscript template svg math form input button select textarea audio video source track'.split(
    ' '
  )
);
const IMAGES_ALLOWED: ImagePolicy = { remote: 'allow' };

interface ScrubOptions {
  stripColorScheme?: boolean;
  preserveDataAttributes?: boolean;
}

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}
function elements(root: Parent): Element[] {
  const result: Element[] = [];
  const pending = [...root.childNodes].reverse();
  while (pending.length) {
    const child = pending.pop()!;
    if (isElement(child)) {
      result.push(child);
      for (let index = child.childNodes.length - 1; index >= 0; index--)
        pending.push(child.childNodes[index]);
    }
  }
  return result;
}
function remove(node: Element) {
  if (node.parentNode)
    node.parentNode.childNodes = node.parentNode.childNodes.filter(
      (child) => child !== node
    );
}
function hasClass(node: Element, name: string) {
  return node.attrs
    .find((attr) => attr.name === 'class')
    ?.value.split(/[\t\n\f\r ]+/)
    .includes(name);
}
function scrub(root: Parent, images: ImagePolicy, options: ScrubOptions = {}) {
  for (const node of elements(root)) {
    if (
      ACTIVE.has(node.tagName) ||
      node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
    ) {
      remove(node);
      continue;
    }
    node.attrs = node.attrs.flatMap((attr) => {
      const name = attr.name.toLowerCase();
      if (
        attr.namespace ||
        attr.prefix ||
        name.startsWith('on') ||
        [
          'srcdoc',
          'srcset',
          'action',
          'formaction',
          'ping',
          'poster',
          'autofocus',
          'contenteditable',
          'is',
          'slot',
          // The editor interprets this legacy attribute as unsanitized HTML.
          // Its current exporter uses child markup, which we scrub normally.
          'data-html',
        ].includes(name) ||
        (name.startsWith('data-') && !options.preserveDataAttributes)
      )
        return [];
      if (name === 'href') {
        const value = ['a', 'area'].includes(node.tagName)
          ? linkUrl(attr.value)
          : undefined;
        return value ? [{ ...attr, value }] : [];
      }
      if (name === 'src' || name === 'background') {
        const value =
          name === 'background' || node.tagName === 'img'
            ? imageUrl(
                attr.value,
                name === 'background' ? { remote: images.remote } : images
              )
            : undefined;
        return value ? [{ ...attr, value }] : [];
      }
      if (name === 'style') {
        const value = prepareCss(attr.value, true, images, options);
        return value ? [{ ...attr, value }] : [];
      }
      return [attr];
    });
    if (node.tagName === 'style') {
      const css = node.childNodes
        .map((child) =>
          child.nodeName === '#text'
            ? (child as DefaultTreeAdapterMap['textNode']).value
            : ''
        )
        .join('');
      node.childNodes = [
        {
          nodeName: '#text',
          value: prepareCss(css, false, images, {
            stripColorScheme:
              options.stripColorScheme && node.parentNode?.nodeName === 'head',
          }),
          parentNode: node,
        },
      ];
    }
  }
}

// Native HTML parsing bounds nesting at roughly 512 levels. parse5 does not,
// and its serializer recurses. Unwrap excessive containers after sanitization
// so readable content keeps its order without exposing discarded active markup.
function boundNesting(root: Parent) {
  const pending = [{ node: root, depth: 0 }];
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (depth < 512) {
      for (const child of node.childNodes)
        if (isElement(child)) pending.push({ node: child, depth: depth + 1 });
      continue;
    }
    const flattened: typeof node.childNodes = [];
    const descendants = [...node.childNodes].reverse();
    while (descendants.length) {
      const child = descendants.pop()!;
      if (isElement(child) && child.childNodes.some(isElement)) {
        for (let index = child.childNodes.length - 1; index >= 0; index--)
          descendants.push(child.childNodes[index]);
      } else {
        child.parentNode = node;
        flattened.push(child);
      }
    }
    node.childNodes = flattened;
  }
}

function documentParts(
  html: string,
  images: ImagePolicy,
  options?: ScrubOptions
) {
  const document = parse(html);
  scrub(document, images, options);
  boundNesting(document);
  const nodes = elements(document);
  let body = nodes.find((node) => node.tagName === 'body');
  if (!body) {
    // A frameset document has no body; active markup was removed above.
    body = defaultTreeAdapter.createElement('body', htmlConstants.NS.HTML, []);
    defaultTreeAdapter.appendChild(
      nodes.find((node) => node.tagName === 'html')!,
      body
    );
  }
  const head = nodes.find((node) => node.tagName === 'head')!;
  const styles = elements(head)
    .filter((node) => node.tagName === 'style')
    .map((node) => serializeOuter(node))
    .join('\n');
  return { document, body, styles };
}

function trim(root: Parent) {
  while (root.childNodes.length) {
    const last = root.childNodes[root.childNodes.length - 1];
    if (last.nodeName === '#text') {
      if ((last as DefaultTreeAdapterMap['textNode']).value.trim()) return;
    } else if (isElement(last)) {
      if (last.tagName === 'img') return;
      if (last.tagName !== 'br') {
        trim(last);
        if (last.childNodes.length) return;
      }
    } else return;
    root.childNodes.pop();
  }
}

export function sanitizeEmailHtml(
  html: string,
  images: ImagePolicy = IMAGES_ALLOWED
): string {
  // Outgoing quoted HTML round-trips through the editor using inert data
  // attributes (mentions, indentation and embedded HTML). Reader preparation
  // strips these separately before mounting application-visible content.
  const { document } = documentParts(html, images, {
    preserveDataAttributes: true,
  });
  return serialize(elements(document).find((node) => node.tagName === 'html')!);
}

function parseEmailContent(
  html: string,
  images: ImagePolicy,
  showQuotedContent = false
) {
  const { body, styles } = documentParts(html, images, {
    stripColorScheme: true,
  });
  const nodes = elements(body);
  const hasTable = nodes.some((node) => node.tagName === 'table');
  const signatureNode = nodes.find(
    (node) =>
      hasClass(node, 'gmail_signature') ||
      hasClass(node, 'macro-email-signature')
  );
  if (!showQuotedContent) {
    if (signatureNode) {
      remove(signatureNode);
      const prefix = nodes.find((node) =>
        hasClass(node, 'gmail_signature_prefix')
      );
      if (prefix) remove(prefix);
    }
    trim(body);
  }
  return {
    mainContent: styles + (styles ? '\n' : '') + serialize(body),
    hasSignature: !!signatureNode,
    hasTable,
  };
}

/** Narrow content input, independent of a message DTO, thread, or framework. */
export interface EmailBodyInput {
  html?: string | null;
  replylessHtml?: string | null;
  text?: string | null;
}
export interface BodyOptions {
  showQuotedContent?: boolean;
  showFullContent?: boolean;
  images?: ImagePolicy;
}
export interface PreparedEmailBody {
  readonly html: string;
  readonly kind: 'html' | 'text';
  readonly hasTable: boolean;
  readonly hasHiddenContent: boolean;
}
export function prepareEmailBody(
  input: EmailBodyInput,
  options: BodyOptions = {}
): PreparedEmailBody {
  if (!input.html) {
    const escaped = (input.text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return {
      html: `<div style="white-space:pre-wrap;overflow-wrap:anywhere">${escaped}</div>`,
      kind: 'text',
      hasTable: false,
      hasHiddenContent: false,
    };
  }
  const images = options.images ?? IMAGES_ALLOWED;
  const { body, styles } = documentParts(input.html, IMAGES_ALLOWED);
  const quote = elements(body).find((node) => hasClass(node, 'macro_quote'));
  if (quote) remove(quote);
  // Missing replyless data must still display a newly received/sent message.
  const replyless =
    input.replylessHtml || (quote ? styles + serialize(body) : input.html);
  const full = !!(options.showQuotedContent || options.showFullContent);
  const shortened = parseEmailContent(replyless, images);
  const parsed = full
    ? parseEmailContent(input.html, images, options.showQuotedContent)
    : shortened;
  return {
    html: parsed.mainContent,
    kind: 'html',
    hasTable: parsed.hasTable,
    hasHiddenContent:
      !!quote ||
      shortened.hasSignature ||
      replyless.replace(/\s+/g, '') !== input.html.replace(/\s+/g, ''),
  };
}
