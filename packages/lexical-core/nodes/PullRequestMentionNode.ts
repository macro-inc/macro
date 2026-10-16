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

export type PullRequestMentionInfo = {
  /**
   * The Macro foreign entity id. Empty when the mention was authored from a
   * GitHub URL alone; the decorator then resolves the PR from `url`.
   */
  id: string;
  label?: string;
  mentionUuid?: string;
  /** The pull request's github.com URL. */
  url?: string;
};

const GITHUB_PR_URL_PATTERN =
  /^https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/pull\/[1-9][0-9]*(?:[/?#]\S*)?$/;

/** Whether `url` is a github.com pull request URL a PR mention can carry. */
export function isGithubPullRequestUrl(url: string): boolean {
  return GITHUB_PR_URL_PATTERN.test(url);
}

export type SerializedPullRequestMentionNode = Spread<
  PullRequestMentionInfo,
  SerializedLexicalNode
>;

export type PullRequestMentionDecoratorProps = PullRequestMentionInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class PullRequestMentionNode extends DecoratorNode<
  DecoratorComponent<PullRequestMentionDecoratorProps> | undefined
> {
  __id: string;
  __label: string | undefined;
  __mentionUuid: string | undefined;
  __url: string | undefined;

  static getType() {
    return 'pr-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: PullRequestMentionNode) {
    return new PullRequestMentionNode(
      node.__id,
      node.__label,
      node.__mentionUuid,
      node.__url,
      node.__key
    );
  }

  constructor(
    id: string,
    label?: string,
    mentionUuid?: string,
    url?: string,
    key?: NodeKey
  ) {
    super(key);
    // Agents sometimes put the PR's GitHub URL in `id`. It is not a Macro id,
    // so treat it as the mention's URL.
    const idIsUrl = isGithubPullRequestUrl(id);
    this.__id = idIsUrl ? '' : id;
    this.__label = label;
    this.__mentionUuid = mentionUuid;
    this.__url = url || (idIsUrl ? id : undefined);
  }

  static importJSON(serializedNode: SerializedPullRequestMentionNode) {
    const node = $createPullRequestMentionNode({
      id: serializedNode.id,
      label: serializedNode.label,
      mentionUuid: serializedNode.mentionUuid,
      url: serializedNode.url,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedPullRequestMentionNode {
    return {
      ...super.exportJSON(),
      id: this.__id,
      label: this.__label,
      mentionUuid: this.__mentionUuid,
      url: this.__url,
      type: PullRequestMentionNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): PullRequestMentionInfo {
    return {
      id: this.__id,
      label: this.__label,
      mentionUuid: this.__mentionUuid,
      url: this.__url,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.setAttribute('data-pr-mention', 'true');
    return span;
  }

  updateDOM(_prevNode: PullRequestMentionNode, _dom: HTMLElement): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    const convert = (domNode: HTMLElement) => {
      const id = domNode.getAttribute('data-pr-id');
      const label = domNode.getAttribute('data-pr-label') || undefined;
      const mentionUuid =
        domNode.getAttribute('data-mention-uuid') || undefined;
      const url = domNode.getAttribute('data-pr-url') || undefined;

      if (id || (url && isGithubPullRequestUrl(url))) {
        return {
          node: $createPullRequestMentionNode({
            id: id ?? '',
            label,
            mentionUuid,
            url,
          }),
        };
      }

      return null;
    };

    const wrapInCheck = (conversion: DOMConversion) => {
      return (node: HTMLElement) =>
        node.hasAttribute('data-pr-mention') ? conversion : null;
    };

    return {
      span: wrapInCheck({ conversion: convert, priority: 1 }),
      a: wrapInCheck({ conversion: convert, priority: 1 }),
    };
  }

  getDataAttrs(): Record<string, string> {
    return {
      'data-pr-mention': 'true',
      'data-pr-id': this.__id,
      'data-pr-label': this.__label || '',
      'data-mention-uuid': this.__mentionUuid || '',
      'data-pr-url': this.__url || '',
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
    return this.__label || 'Pull request';
  }

  getSearchText(): string {
    return this.getTextContent();
  }

  getId(): string {
    return this.__id;
  }

  getLabel(): string | undefined {
    return this.__label;
  }

  getUrl(): string | undefined {
    return this.__url;
  }

  setUrl(url: string | undefined) {
    const self = this.getWritable();
    self.__url = url;
  }

  setLabel(label: string | undefined) {
    const self = this.getWritable();
    self.__label = label;
  }

  getMentionUuid(): string | undefined {
    return this.__mentionUuid;
  }

  setMentionUuid(mentionUuid: string | undefined) {
    const self = this.getWritable();
    self.__mentionUuid = mentionUuid;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const Component = getDecorator<PullRequestMentionDecoratorProps>(
      PullRequestMentionNode
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

export function $createPullRequestMentionNode(params: PullRequestMentionInfo) {
  const node = new PullRequestMentionNode(
    params.id,
    params.label,
    params.mentionUuid,
    params.url
  );
  return $applyNodeReplacement(node);
}

export function $isPullRequestMentionNode(
  node: PullRequestMentionNode | LexicalNode | null | undefined
): node is PullRequestMentionNode {
  return node instanceof PullRequestMentionNode;
}
