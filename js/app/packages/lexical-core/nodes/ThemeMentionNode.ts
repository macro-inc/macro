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

const THEME_V1_TOKEN_KEYS = [
  'a0',
  'a1',
  'a2',
  'a3',
  'a4',
  'b0',
  'b1',
  'b2',
  'b3',
  'b4',
  'c0',
  'c1',
  'c2',
  'c3',
  'c4',
] as const;

type ThemeV1TokenKey = (typeof THEME_V1_TOKEN_KEYS)[number];

type ThemeV1TokenValue = { l: number; c: number; h: number };

type ThemeV1Tokens = Record<ThemeV1TokenKey, ThemeV1TokenValue>;

export type ThemeV1 = {
  id: string;
  name: string;
  version: number;
  tokens: ThemeV1Tokens;
};

function isThemeV1TokenValue(val: unknown): val is ThemeV1TokenValue {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.l === 'number' &&
    typeof obj.c === 'number' &&
    typeof obj.h === 'number'
  );
}

export function isThemeV1Json(text: string): ThemeV1 | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;

    if (typeof obj.id !== 'string') return null;
    if (typeof obj.name !== 'string') return null;
    if (typeof obj.version !== 'number') return null;
    if (typeof obj.tokens !== 'object' || obj.tokens === null) return null;

    const tokens = obj.tokens as Record<string, unknown>;
    for (const key of THEME_V1_TOKEN_KEYS) {
      if (!isThemeV1TokenValue(tokens[key])) return null;
    }

    return parsed as ThemeV1;
  } catch {
    return null;
  }
}

export type ThemeMentionInfo = {
  id: string;
  name: string;
  version: number;
  tokens: ThemeV1Tokens;
};

export type SerializedThemeMentionNode = Spread<
  ThemeMentionInfo,
  SerializedLexicalNode
>;

export type ThemeMentionDecoratorProps = ThemeMentionInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class ThemeMentionNode extends DecoratorNode<
  DecoratorComponent<ThemeMentionDecoratorProps> | undefined
> {
  __themeId: string;
  __themeName: string;
  __version: number;
  __tokens: ThemeV1Tokens;

  static getType() {
    return 'theme-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: ThemeMentionNode) {
    return new ThemeMentionNode(
      node.__themeId,
      node.__themeName,
      node.__version,
      node.__tokens,
      node.__key
    );
  }

  constructor(
    themeId: string,
    themeName: string,
    version: number,
    tokens: ThemeV1Tokens,
    key?: NodeKey
  ) {
    super(key);
    this.__themeId = themeId;
    this.__themeName = themeName;
    this.__version = version;
    this.__tokens = tokens;
  }

  static importJSON(serializedNode: SerializedThemeMentionNode) {
    const node = $createThemeMentionNode({
      id: serializedNode.id,
      name: serializedNode.name,
      version: serializedNode.version,
      tokens: serializedNode.tokens,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedThemeMentionNode {
    return {
      ...super.exportJSON(),
      id: this.__themeId,
      name: this.__themeName,
      tokens: this.__tokens,
      type: ThemeMentionNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): ThemeMentionInfo {
    return {
      id: this.__themeId,
      name: this.__themeName,
      version: this.__version,
      tokens: this.__tokens,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.setAttribute('data-theme-mention', 'true');
    return span;
  }

  updateDOM(_prevNode: ThemeMentionNode, _dom: HTMLElement): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    const convert = (domNode: HTMLElement) => {
      const themeJson = domNode.getAttribute('data-theme-json');
      if (!themeJson) return null;

      const theme = isThemeV1Json(themeJson);
      if (!theme) return null;

      const node = $createThemeMentionNode(theme);
      return { node };
    };

    const wrapInCheck = (conversion: DOMConversion) => {
      return (node: HTMLElement) =>
        node.hasAttribute('data-theme-mention') ? conversion : null;
    };

    return {
      span: wrapInCheck({ conversion: convert, priority: 1 }),
    };
  }

  exportDOM() {
    const element = document.createElement('span');
    element.setAttribute('data-theme-mention', 'true');
    element.setAttribute(
      'data-theme-json',
      JSON.stringify({
        id: this.__themeId,
        name: this.__themeName,
        version: this.__version,
        tokens: this.__tokens,
      })
    );
    element.textContent = this.__themeName;
    return { element };
  }

  getTextContent(): string {
    return this.__themeName;
  }

  getThemeId(): string {
    return this.__themeId;
  }

  getThemeName(): string {
    return this.__themeName;
  }

  getVersion(): number {
    return this.__version;
  }

  getTokens(): ThemeV1Tokens {
    return this.__tokens;
  }

  getThemeV1(): ThemeV1 {
    return {
      id: this.__themeId,
      name: this.__themeName,
      version: this.__version,
      tokens: this.__tokens,
    };
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<ThemeMentionNode>(ThemeMentionNode);
    if (decorator) {
      return () =>
        decorator({
          id: this.__themeId,
          name: this.__themeName,
          version: this.__version,
          tokens: this.__tokens,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createThemeMentionNode(theme: ThemeV1): ThemeMentionNode {
  const node = new ThemeMentionNode(
    theme.id,
    theme.name,
    theme.version,
    theme.tokens
  );
  return $applyNodeReplacement(node);
}

export function $isThemeMentionNode(
  node: ThemeMentionNode | LexicalNode | null | undefined
): node is ThemeMentionNode {
  return node instanceof ThemeMentionNode;
}
