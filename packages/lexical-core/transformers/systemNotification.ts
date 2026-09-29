import type { MultilineElementTransformer } from '@lexical/markdown';
import type { LexicalNode } from 'lexical';
import {
  $createSystemNotificationNode,
  $isSystemNotificationNode,
  SYSTEM_NOTIFICATION_TAG,
  type SystemNotificationData,
  SystemNotificationNode,
} from '../nodes/SystemNotificationNode';

// Attributes are quoted `name="value"` pairs; the quotes are what let a value
// carry `>` without ending the tag. An autolinked `<m-link>` payload inside a
// value carries quotes of its own, so it is consumed whole.
const ATTRIBUTE_SOURCE = String.raw`([A-Za-z_\\][\w.:\\-]*)\s*=\s*"((?:<m-link>.*?</m-link>|[^"])*)"`;
// The opening tag, and nothing past it: what follows on the same line is
// body, so a one-line notification still finds its closing tag. The `\\?_`
// tolerates the `\_` a markdown exporter leaves behind when the tag has been
// through an editor as plain text.
const OPEN_TAG = new RegExp(
  String.raw`^<system\\?_notification((?:\s+${ATTRIBUTE_SOURCE})*)\s*>`
);
const CLOSE_TAG = /<\/system\\?_notification>\s*$/;
const ATTRIBUTE = new RegExp(ATTRIBUTE_SOURCE, 'g');
const INTERNAL_LINK = /<m-link>(.*?)<\/m-link>/gs;

/** Undo what a markdown pass may have done to a name or value. */
function unescapeAttribute(value: string): string {
  return value
    .replaceAll('\\_', '_')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replace(INTERNAL_LINK, (whole, json: string) => {
      // A bare `github.com/org/repo` autolinks in an editor and exports as an
      // internal link tag; the value the notification carried is its text.
      try {
        const link: unknown = JSON.parse(json);
        if (link && typeof link === 'object') {
          const { text, url } = link as Record<string, unknown>;
          if (typeof text === 'string' && text) return text;
          if (typeof url === 'string') return url;
        }
      } catch {
        // Not a link payload after all: leave it as it was written.
      }
      return whole;
    });
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

/** The attributes on an opening tag, in the order written. */
export function parseSystemNotificationAttributes(
  tag: string
): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, name, value] of tag.matchAll(ATTRIBUTE)) {
    attributes[unescapeAttribute(name!)] = unescapeAttribute(value!);
  }
  return attributes;
}

/** The notification a tag and its body describe, or `undefined` when the tag names no source. */
export function readSystemNotification(
  openingTag: string,
  body: string
): SystemNotificationData | undefined {
  const { source, ...attributes } =
    parseSystemNotificationAttributes(openingTag);
  if (!source) return undefined;
  return { source, attributes, text: body.trim() };
}

/** The tag as Cursor writes it, so a notification survives a save unchanged. */
export function buildSystemNotificationMarkdown(
  data: SystemNotificationData
): string {
  const attributes = Object.entries({ source: data.source, ...data.attributes })
    .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
    .join(' ');
  return `<${SYSTEM_NOTIFICATION_TAG} ${attributes}>\n${data.text}\n</${SYSTEM_NOTIFICATION_TAG}>`;
}

/**
 * Internal markdown transformer for the event notifications Cursor's cloud
 * agents receive (see {@link SystemNotificationNode}).
 *
 * A tag with no `source`, or with no closing tag, is left as the text it was:
 * the format is Cursor's, and anything else spelled like it is more likely
 * someone writing about the format than an event.
 */
export const I_SYSTEM_NOTIFICATION: MultilineElementTransformer = {
  dependencies: [SystemNotificationNode],
  type: 'multiline-element',
  regExpStart: OPEN_TAG,
  regExpEnd: CLOSE_TAG,
  export: (node: LexicalNode) => {
    if (!$isSystemNotificationNode(node)) return null;
    return buildSystemNotificationMarkdown(node.exportComponentProps());
  },
  replace: (rootNode, children, startMatch, _endMatch, linesInBetween) => {
    if ((children?.length ?? 0) > 0) return false;
    const data = readSystemNotification(
      startMatch[1] ?? '',
      linesInBetween?.join('\n') ?? ''
    );
    if (!data) return false;
    rootNode.append($createSystemNotificationNode(data));
  },
};
