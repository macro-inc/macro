import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversion,
  type DOMConversionMap,
  type EditorConfig,
  type EditorThemeClasses,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';

const VERSION = 1;

export type BookingLinkMentionInfo = {
  /** The profile ID from the booking URL (e.g., the UUID or profile slug). */
  profileId: string;
  /** The event type slug from the booking URL (optional). */
  slug?: string;
  /** The display label for the booking link. */
  label?: string;
  /** The booking link URL. */
  url: string;
};

/** Pattern to match Macro booking URLs: /app/book/:profile/:slug? */
const MACRO_BOOKING_URL_PATTERN =
  /^https?:\/\/(?:www\.)?(?:macro\.com|localhost:\d+|dev\.macro\.com|staging\.macro\.com)\/app\/book\/([^/?#]+)(?:\/([^/?#]+))?(?:[?#].*)?$/;

/** Check whether a URL is a valid Macro booking link. */
export function isMacroBookingUrl(url: string): boolean {
  return MACRO_BOOKING_URL_PATTERN.test(url);
}

/** Parse a booking URL into its parts. */
export function parseBookingUrl(
  url: string
): { profileId: string; slug?: string } | null {
  const match = url.match(MACRO_BOOKING_URL_PATTERN);
  if (!match) return null;
  const profileId = decodeURIComponent(match[1]);
  const slug = match[2] ? decodeURIComponent(match[2]) : undefined;
  return { profileId, slug };
}

export type SerializedBookingLinkMentionNode = Spread<
  BookingLinkMentionInfo,
  SerializedLexicalNode
>;

export type BookingLinkMentionDecoratorProps = BookingLinkMentionInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class BookingLinkMentionNode extends DecoratorNode<
  DecoratorComponent<BookingLinkMentionDecoratorProps> | undefined
> {
  __profileId: string;
  __slug: string | undefined;
  __label: string | undefined;
  __url: string;

  static getType() {
    return 'booking-link-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: BookingLinkMentionNode) {
    return new BookingLinkMentionNode(
      node.__profileId,
      node.__slug,
      node.__label,
      node.__url,
      node.__key
    );
  }

  constructor(
    profileId: string,
    slug?: string,
    label?: string,
    url?: string,
    key?: NodeKey
  ) {
    super(key);
    this.__profileId = profileId;
    this.__slug = slug;
    this.__label = label;
    this.__url =
      url ||
      buildBookingUrl(profileId, slug) ||
      `https://macro.com/app/book/${profileId}`;
  }

  static importJSON(serializedNode: SerializedBookingLinkMentionNode) {
    const node = $createBookingLinkMentionNode({
      profileId: serializedNode.profileId,
      slug: serializedNode.slug,
      label: serializedNode.label,
      url: serializedNode.url,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedBookingLinkMentionNode {
    return {
      ...super.exportJSON(),
      profileId: this.__profileId,
      slug: this.__slug,
      label: this.__label,
      url: this.__url,
      type: BookingLinkMentionNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): BookingLinkMentionInfo {
    return {
      profileId: this.__profileId,
      slug: this.__slug,
      label: this.__label,
      url: this.__url,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.setAttribute('data-booking-link-mention', 'true');
    return span;
  }

  updateDOM(_prevNode: BookingLinkMentionNode, _dom: HTMLElement): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    const convert = (domNode: HTMLElement) => {
      const profileId = domNode.getAttribute('data-booking-profile-id');
      const slug = domNode.getAttribute('data-booking-slug') || undefined;
      const label = domNode.getAttribute('data-booking-label') || undefined;
      const url = domNode.getAttribute('data-booking-url') || undefined;

      if (profileId && url) {
        return {
          node: $createBookingLinkMentionNode({
            profileId,
            slug,
            label,
            url,
          }),
        };
      }

      return null;
    };

    const wrapInCheck = (conversion: DOMConversion) => {
      return (node: HTMLElement) =>
        node.hasAttribute('data-booking-link-mention') ? conversion : null;
    };

    return {
      span: wrapInCheck({ conversion: convert, priority: 1 }),
      a: wrapInCheck({ conversion: convert, priority: 1 }),
    };
  }

  getDataAttrs(): Record<string, string> {
    return {
      'data-booking-link-mention': 'true',
      'data-booking-profile-id': this.__profileId,
      'data-booking-slug': this.__slug || '',
      'data-booking-label': this.__label || '',
      'data-booking-url': this.__url,
    };
  }

  exportDOM() {
    const element = document.createElement('span');
    const attrs = this.getDataAttrs();
    for (const [k, v] of Object.entries(attrs)) {
      if (v) {
        element.setAttribute(k, v);
      }
    }
    element.textContent = this.getTextContent();
    return { element };
  }

  getTextContent(): string {
    return this.__label || this.__slug || 'Booking link';
  }

  getSearchText(): string {
    return this.getTextContent();
  }

  getProfileId(): string {
    return this.__profileId;
  }

  getSlug(): string | undefined {
    return this.__slug;
  }

  getLabel(): string | undefined {
    return this.__label;
  }

  getUrl(): string {
    return this.__url;
  }

  setLabel(label: string | undefined) {
    const self = this.getWritable();
    self.__label = label;
  }

  setUrl(url: string) {
    const self = this.getWritable();
    self.__url = url;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const Component = getDecorator<BookingLinkMentionDecoratorProps>(
      BookingLinkMentionNode
    );

    if (!Component) return undefined;

    return () =>
      Component({
        ...this.exportComponentProps(),
        key: this.getKey(),
        theme: config.theme,
      });
  }
}

function buildBookingUrl(profileId: string, slug?: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const hostname = window.location.hostname;
  const cleanHost =
    hostname === 'localhost' ? 'dev.macro.com' : hostname.replace('www.', '');
  const path = slug
    ? `/app/book/${encodeURIComponent(profileId)}/${encodeURIComponent(slug)}`
    : `/app/book/${encodeURIComponent(profileId)}`;
  return `https://${cleanHost}${path}`;
}

export function $createBookingLinkMentionNode(params: BookingLinkMentionInfo) {
  const node = new BookingLinkMentionNode(
    params.profileId,
    params.slug,
    params.label,
    params.url
  );
  return $applyNodeReplacement(node);
}

export function $isBookingLinkMentionNode(
  node: BookingLinkMentionNode | LexicalNode | null | undefined
): node is BookingLinkMentionNode {
  return node instanceof BookingLinkMentionNode;
}
