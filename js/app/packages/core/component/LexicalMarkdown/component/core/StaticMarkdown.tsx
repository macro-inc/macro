/**
 * This is a manual tree walk renderer for the LexicalEditor synced markdown. It renders
 * the markdown features that are supported by our LexicalEngine.
 */

import type { CodeNode } from '@lexical/code';
import { PrismTokenizer } from '@lexical/code';
import type { LinkNode } from '@lexical/link';
import { $getListDepth, type ListItemNode, type ListNode } from '@lexical/list';
import type { HeadingNode, QuoteNode } from '@lexical/rich-text';
import type { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import {
  type ContactMentionNode,
  type DateMentionNode,
  DEFAULT_LANGUAGE,
  type DocumentMentionNode,
  type EquationNode,
  type HorizontalRuleNode,
  isSupportedLanguage,
  normalizedLanguage,
  SupportedNodeTypes,
  type UserMentionNode,
} from '@lexical-core';
import {
  $getRoot,
  createEditor,
  type EditorState,
  type EditorThemeClasses,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type LineBreakNode,
  type ParagraphNode,
  type RootNode,
  TEXT_TYPE_TO_FORMAT,
  type TextFormatType,
  type TextNode,
} from 'lexical';
import type { Accessor, JSX, ParentProps } from 'solid-js';
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  Show,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { replaceCitations } from '../../citationsUtils';
import '../../styles.css';
import { ENABLE_SVG_PREVIEW } from '@core/constant/featureFlags';
import type { MarkNode } from '@lexical/mark';
import type { SearchMatchNode } from '@lexical-core/nodes/SearchMatchNode';
import { theme as baseTheme, createTheme } from '../../theme';
import { setEditorStateFromMarkdown } from '../../utils';
import { StaticCodeBoxAccessory } from '../accessory/CodeBoxAccessory';
import { ContactMention as ContactMentionDecorator } from '../decorator/ContactMention';
import { DateMention as DateMentionDecorator } from '../decorator/DateMention';
import { DocumentMention as DocumentMentionDecorator } from '../decorator/DocumentMention';
import { Equation as EquationDecorator } from '../decorator/Equation';
import { UserMention as UserMentionDecorator } from '../decorator/UserMention';
import { LinkWithPreview } from './LinkWithPreview';

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

// The supported inline formatting options.
const TextFormats: TextFormatType[] = [
  'code',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'highlight',
  'subscript',
  'superscript',
];

type Token = {
  type: string;
  content: string | Token | (string | Token)[];
};

const CodeHighlightShim = {
  /**
   * Get highlight spans from the Prism tokens.
   */
  getHighlights: (
    tokens: Array<string | Token>,
    type: string | null,
    theme: EditorThemeClasses
  ): Node[] => {
    const nodes: Node[] = [];
    for (const token of tokens) {
      if (typeof token === 'string') {
        const partials = token.split(/(\n|\t)/);
        const partialsLength = partials.length;
        for (let i = 0; i < partialsLength; i++) {
          const part = partials[i];
          if (part === '\n' || part === '\r\n') {
            nodes.push(document.createElement('br'));
          } else if (part === '\t') {
            const tabNode = document.createElement('span');
            const className = theme.tab;
            if (className) tabNode.classList.add(className);
            nodes.push(tabNode);
          } else if (part.length > 0) {
            const spanNode = document.createElement('span');
            const className = type
              ? (theme?.codeHighlight?.[type!] ?? null)
              : null;
            if (className) spanNode.classList.add(className);
            spanNode.innerText = part;
            nodes.push(spanNode);
          }
        }
      } else {
        const { content } = token;
        if (typeof content === 'string') {
          nodes.push(
            ...CodeHighlightShim.getHighlights([content], token.type, theme)
          );
        } else if (Array.isArray(content)) {
          nodes.push(
            ...CodeHighlightShim.getHighlights(content, token.type, theme)
          );
        }
      }
    }
    return nodes;
  },

  getLineNumbers: (text: string) => {
    let lineCount = 1;
    let lineNumbers = '1\n';
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        lineCount++;
        lineNumbers += lineCount + '\n';
      }
    }
    return lineNumbers;
  },
};

/**
 * Take the first "line" of a markdown string. Handle the codeblock edge case.
 */
export function firstLineMarkdown(md: string) {
  if (typeof md !== 'string') return '';

  // fix line endings and trim start
  md = md.replace(/\r\n?/g, '\n').replace(/^\s*\n/, '');

  const lines = md.split('\n');
  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

  const fenceMatch = lines[0]?.match(/^\s*(```+|~~~+)\s*([a-zA-Z0-9_-]+)?\s*$/);
  if (fenceMatch) {
    const fence = fenceMatch[1]; // ``` or ~~~ (with count)
    const lang = fenceMatch[2] || ''; // optional
    let firstCode = '';
    for (let i = 1; i < lines.length; i++) {
      // closing fence?
      if (new RegExp(`^\\s*${fence}\\s*$`).test(lines[i])) break;
      if (!firstCode && lines[i].trim().length)
        firstCode = lines[i].replace(/\s+$/, '');
    }
    const out =
      (lang ? '```' + lang : '```') + '\n' + (firstCode || '') + '\n```';
    return out;
  }

  const buf = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*$/.test(lines[i])) break;
    buf.push(lines[i]);
  }
  return collapse(buf.join(' '));
}

function newStaticRenderingEditor(props: {
  parentEditor?: LexicalEditor;
  theme: EditorThemeClasses;
}): LexicalEditor {
  const editor = createEditor({
    parentEditor: props.parentEditor,
    theme: props.theme,
    namespace: 'static-renderer',
    nodes: SupportedNodeTypes,
    onError: console.error,
  });
  return editor;
}

/**
 * Check is a given node format number container the bit flag for a given format type.
 * @param nodeFormat The node format number.
 * @param type The format type to check.
 * @returns True if the node has the format.
 */
function hasFormat(nodeFormat: number, type: TextFormatType): boolean {
  const formatFlag = TEXT_TYPE_TO_FORMAT[type];
  return (nodeFormat & formatFlag) !== 0;
}

/**
 * Get the string class name for a given text node by checking each supported format.
 * @param node The text node.
 * @returns The class name.
 * @TODO: could memoize this to avoid string manip for everytext node class.
 */
function getTextClassName(
  node:
    | TextNode
    | UserMentionNode
    | DocumentMentionNode
    | ContactMentionNode
    | DateMentionNode,
  theme: EditorThemeClasses
): string {
  const base = theme.text?.base ?? '';
  if (!('__format' in node)) {
    return base;
  }

  return TextFormats.reduce((acc, format) => {
    if (hasFormat(node.__format, format)) {
      return `${acc} ${theme.text?.[format]}`;
    }
    return acc;
  }, base);
}

type NodeComponent<T extends LexicalNode = LexicalNode> = {
  node: T;
  theme: EditorThemeClasses;
  isGenerating: Accessor<boolean>;
};

type ElementNodeComponent<T extends ElementNode = ElementNode> = ParentProps &
  NodeComponent<T>;

type RenderableEntity<T extends LexicalNode = LexicalNode> = {
  guard: (node: LexicalNode) => node is T;
  render: (props: NodeComponent<T>) => JSX.Element;
};

type RenderableElement<T extends ElementNode = ElementNode> = {
  guard: (node: LexicalNode) => node is T;
  render: (props: ElementNodeComponent<T>) => JSX.Element;
};

const Text: RenderableEntity<TextNode> = {
  guard: (node: LexicalNode): node is TextNode => node.__type === 'text',
  render: (props) => {
    return (
      <span class={getTextClassName(props.node, props.theme)}>
        {props.node.__text}
      </span>
    );
  },
};

const LineBreak: RenderableEntity<LineBreakNode> = {
  guard: (node: LexicalNode): node is LineBreakNode =>
    node.__type === 'linebreak',
  render: () => <br />,
};

const UserMention: RenderableEntity<UserMentionNode> = {
  guard: (node: LexicalNode): node is UserMentionNode =>
    node.__type === 'user-mention',
  render: (props) => (
    <span class={getTextClassName(props.node, props.theme)}>
      {UserMentionDecorator({
        ...props.node.exportComponentProps(),
        key: props.node.getKey(),
        theme: props.theme,
      })}
    </span>
  ),
};

const DocumentMention: RenderableEntity<DocumentMentionNode> = {
  guard: (node: LexicalNode): node is DocumentMentionNode =>
    node.__type === 'document-mention',
  render: (props) => (
    <span class={getTextClassName(props.node, props.theme)}>
      {DocumentMentionDecorator({
        ...props.node.exportComponentProps(),
        key: props.node.getKey(),
        theme: props.theme,
      })}
    </span>
  ),
};

const ContactMention: RenderableEntity<ContactMentionNode> = {
  guard: (node: LexicalNode): node is ContactMentionNode =>
    node.__type === 'contact-mention',
  render: (props) => (
    <span class={getTextClassName(props.node, props.theme)}>
      {ContactMentionDecorator({
        ...props.node.exportComponentProps(),
        key: props.node.getKey(),
        theme: props.theme,
      })}
    </span>
  ),
};

const DateMention: RenderableEntity<DateMentionNode> = {
  guard: (node: LexicalNode): node is DateMentionNode =>
    node.__type === 'date-mention',
  render: (props) => (
    <span class={getTextClassName(props.node, props.theme)}>
      {DateMentionDecorator({
        ...props.node.exportComponentProps(),
        key: props.node.getKey(),
        theme: props.theme,
      })}
    </span>
  ),
};

const Paragraph: RenderableElement<ParagraphNode> = {
  guard: (node: LexicalNode): node is ParagraphNode =>
    node.__type === 'paragraph',
  render: (props) => <p class={props.theme.paragraph}>{props.children}</p>,
};

const Heading: RenderableElement<HeadingNode> = {
  guard: (node: LexicalNode): node is HeadingNode => node.__type === 'heading',
  render: (props) => {
    const tag = props.node.__tag as HeadingTag;
    return (
      <Dynamic
        component={tag}
        class={props.theme.heading?.[tag]}
        children={props.children}
      />
    );
  },
};

const List: RenderableElement<ListNode> = {
  guard: (node: LexicalNode): node is ListNode => node.__type === 'list',
  render: (props) => {
    const type = props.node.__listType;
    const depth = $getListDepth(props.node);
    const start = props.node.__start;

    if (type === 'bullet') {
      return <ul class={props.theme.list?.ul}>{props.children}</ul>;
    }
    if (type === 'number') {
      return (
        <ol
          class={props.theme.list?.ol + ' static-md'}
          classList={{
            ['depth-' + depth]: true,
          }}
          style={{ 'counter-reset': `static-md-counter-${depth} ${start - 1}` }}
        >
          {props.children}
        </ol>
      );
    }
    if (type === 'check') {
      return (
        <ul class={`${props.theme.list?.ul} ${props.theme.list?.checklist}`}>
          {props.children}
        </ul>
      );
    }
  },
};

const ListItem: RenderableElement<ListItemNode> = {
  guard: (node: LexicalNode): node is ListItemNode =>
    node.__type === 'listitem',
  render: (props) => {
    const checked = props.node.__checked;

    // Get the parent list node
    const _children = props.node.getChildren();
    const nested = _children.some((child) => child.__type === 'list');

    // Build class names
    const classes = [
      props.theme.list?.listitem,
      checked && props.theme.list?.listitemChecked,
      nested && props.theme.list?.nested?.listitem,
    ]
      .filter(Boolean)
      .join(' ');

    return <li class={classes}>{props.children}</li>;
  },
};

const Quote: RenderableElement<QuoteNode> = {
  guard: (node: LexicalNode): node is QuoteNode => node.__type === 'quote',
  render: (props) => (
    <blockquote class={props.theme.quote}>{props.children}</blockquote>
  ),
};

const Code: RenderableElement<CodeNode> = {
  guard: (node: LexicalNode): node is CodeNode => node.__type === 'code',
  render: (props) => {
    let language = props.node.__language ?? DEFAULT_LANGUAGE;
    const text = props.node.getTextContent();

    if (isSupportedLanguage(language)) {
      language = normalizedLanguage(language);
    }

    const tokens = PrismTokenizer.tokenize(text, language);
    const nodes = CodeHighlightShim.getHighlights(
      tokens as Array<Token>,
      null,
      props.theme
    );

    return (
      <StaticCodeContainer
        language={language}
        text={text}
        theme={props.theme}
        tokens={tokens}
        nodes={nodes}
      />
    );
  },
};

function StaticCodeContainer(props: {
  language: string;
  text: string;
  theme: EditorThemeClasses;
  tokens: any;
  nodes: any;
}) {
  const [isPreviewMode, setIsPreviewMode] = createSignal(false);

  const showPreview = () => {
    return (
      ENABLE_SVG_PREVIEW &&
      props.language.toLowerCase() === 'svg' &&
      isPreviewMode()
    );
  };

  return (
    <div
      class={props.theme.static?.['code-container']}
      classList={{
        'md-static-code-container': true,
      }}
      style={{
        position: 'relative',
        'min-height': showPreview() ? '400px' : 'auto',
      }}
    >
      <StaticCodeBoxAccessory
        language={props.language}
        code={props.text}
        theme={props.theme}
        isPreviewMode={isPreviewMode}
        setIsPreviewMode={setIsPreviewMode}
      />
      <Show when={!showPreview()}>
        <pre
          class={props.theme.static?.['code'] ?? props.theme.code}
          data-gutter={CodeHighlightShim.getLineNumbers(props.text)}
        >
          {props.nodes}
        </pre>
      </Show>
    </div>
  );
}

const HorizontalRule: RenderableEntity<HorizontalRuleNode> = {
  guard: (node: LexicalNode): node is HorizontalRuleNode =>
    node.__type === 'horizontalrule',
  render: (props) => <div class={props.theme.hr} />,
};

const Link: RenderableElement<LinkNode> = {
  guard: (node: LexicalNode): node is LinkNode => node.__type === 'link',
  render: (props) => (
    <LinkWithPreview
      url={props.node.__url}
      class={props.theme.link}
      title={props.node.__title ?? props.node.__url}
    >
      {props.children}
    </LinkWithPreview>
  ),
};

const Mark: RenderableElement<MarkNode> = {
  guard: (node: LexicalNode): node is MarkNode => node.__type === 'mark',
  render: (props) => <span class={props.theme.mark}>{props.children}</span>,
};

const SearchMatch: RenderableElement<SearchMatchNode> = {
  guard: (node: LexicalNode): node is SearchMatchNode =>
    node.__type === 'search-match',
  render: (props) => (
    <span class={props.theme.searchMatch}>{props.children}</span>
  ),
};

const Equation: RenderableEntity<EquationNode> = {
  guard: (node: LexicalNode): node is EquationNode =>
    node.__type === 'equation',
  render: (props) => (
    <EquationDecorator equation={props.node.__equation} inline={true} />
  ),
};

// Table rendering components for Lexical tables
const Table: RenderableElement<TableNode> = {
  guard: (node: LexicalNode): node is TableNode => node.__type === 'table',
  render: (props) => (
    <div
      class={`overflow-x-${props.isGenerating() ? 'hidden' : 'auto'} mt-4 mb-4 max-w-full`}
    >
      <table
        {...props}
        class={`${props.theme.table} min-w-full table-auto`}
        style="width: max-content;"
      />
    </div>
  ),
};

const TableRow: RenderableElement<TableRowNode> = {
  guard: (node: LexicalNode): node is TableRowNode =>
    node.__type === 'tablerow',
  render: (props) => {
    const isFirstRow = props.node.getIndexWithinParent() === 0;
    return (
      <tr class={`${props.theme.tableRow} ${isFirstRow ? 'font-bold' : ''}`}>
        {props.children}
      </tr>
    );
  },
};

const TableCell: RenderableElement<TableCellNode> = {
  guard: (node: LexicalNode): node is TableCellNode =>
    node.__type === 'tablecell',
  render: (props) => {
    return (
      <Dynamic
        component={'td'}
        class={`${props.theme.tableCell} min-w-[100px] max-w-[350px]`}
        colspan={props.node.__colSpan}
        rowspan={props.node.__rowSpan}
      >
        {props.children}
      </Dynamic>
    );
  },
};

// The entities that cannot have children.
const InlineEntities: Array<RenderableEntity> = [
  Text,
  LineBreak,
  UserMention,
  DocumentMention,
  ContactMention,
  DateMention,
  HorizontalRule,
  Equation,
] as const;

const Elements: RenderableElement[] = [
  Paragraph,
  Heading,
  List,
  ListItem,
  Quote,
  Code,
  Link,
  Mark,
  SearchMatch,
  Table,
  TableRow,
  TableCell,
] as const;

function Render(props: NodeComponent | ElementNodeComponent) {
  let entity = InlineEntities.find((entity) => entity.guard(props.node));
  if (entity) {
    return entity.render({
      ...props,
      theme: props.theme,
      isGenerating: props.isGenerating,
    });
  }

  const element = Elements.find((entity) => entity.guard(props.node));

  if (element) {
    let elemNode = props.node as ElementNode;
    return element.render({
      node: elemNode,
      children: MapRender({
        children: elemNode.getChildren(),
        theme: props.theme,
        isGenerating: props.isGenerating,
      }),
      theme: props.theme,
      isGenerating: props.isGenerating,
    });
  }

  console.error('Static Markdown: no render found for node', props.node);
  return '';
}

function MapRender(props: {
  children: LexicalNode[];
  theme: EditorThemeClasses;
  isGenerating: Accessor<boolean>;
}) {
  return props.children.map((child) => (
    <Render
      node={child}
      theme={props.theme}
      isGenerating={props.isGenerating}
    />
  ));
}

function Document(props: {
  rootNode: RootNode;
  theme: EditorThemeClasses;
  rootRef?: (ref: HTMLDivElement) => void;
  isGenerating: Accessor<boolean>;
}): JSX.Element {
  return (
    <div
      class={`markdown-content ${props.theme.root ?? ''} break-words max-w-full`}
      ref={props.rootRef}
    >
      <MapRender
        children={props.rootNode.getChildren()}
        theme={props.theme}
        isGenerating={props.isGenerating}
      />
    </div>
  );
}

const context = createContext<{
  editor: LexicalEditor | null;
  theme: Accessor<EditorThemeClasses>;
}>({ editor: null, theme: () => baseTheme });

export function StaticMarkdown(props: {
  markdown: string;
  parentEditor?: LexicalEditor;
  theme?: EditorThemeClasses;
  setEditorRef?: (editor: LexicalEditor) => void;
  rootRef?: (ref: HTMLDivElement) => void;
  target?: 'internal' | 'external' | 'both';
  isGenerating?: Accessor<boolean>;
  singleLine?: boolean;
}) {
  let { editor: contextEditor, theme: parentTheme } = useContext(context);
  let [editorState, setEditorState] = createSignal<EditorState | null>(null);
  const [isGenerating, setIsGenerating] = createSignal<boolean>(false);

  if (contextEditor === null) {
    console.warn(
      'Calling StaticMarkdown outside of StaticMarkdownContext will create a new LexicalEditor for each StaticMarkdown instance. This might not be what you want.'
    );
  }

  const mergedTheme = () => {
    if (!props.theme) return parentTheme();
    return createTheme(props.theme ?? {}, parentTheme());
  };

  const currentEditor = createMemo(() => {
    if (contextEditor) {
      if (props.setEditorRef) props.setEditorRef(contextEditor);
      return contextEditor;
    } else {
      const editor = newStaticRenderingEditor({ theme: mergedTheme() });
      if (props.setEditorRef) props.setEditorRef(editor);
      return editor;
    }
  });

  const content = createMemo(() => {
    if (props.singleLine) {
      return firstLineMarkdown(props.markdown);
    }
    return props.markdown;
  });

  createEffect(() => {
    const editor = currentEditor();
    if (!editor) {
      setEditorState(null);
      return;
    }

    setEditorStateFromMarkdown(editor, content(), props.target);
    setEditorState(editor.getEditorState());
  });

  // TODO: Move citations to bulk query when built in backend
  createEffect(() => {
    const isGenerating = props.isGenerating?.() ?? false;
    if (!isGenerating) {
      const editor = currentEditor();

      // Handle citations without affecting mentions
      replaceCitations(content()).then((content: string) => {
        setEditorStateFromMarkdown(editor, content, props.target);
        setEditorState(editor.getEditorState());
      });
    }
    setIsGenerating(isGenerating);
  });

  const domTree = createMemo(() => {
    return editorState()?.read(() => {
      return Document({
        rootNode: $getRoot(),
        theme: mergedTheme(),
        isGenerating,
      });
    });
  });

  return <>{domTree()}</>;
}

export function StaticMarkdownContext(props: {
  children: JSX.Element;
  theme?: EditorThemeClasses;
}) {
  const mergedTheme = () => {
    if (!props.theme) return baseTheme;
    return createTheme(props.theme, baseTheme, { join: true });
  };

  const editor = createMemo(() =>
    newStaticRenderingEditor({ theme: mergedTheme() })
  );

  return (
    <context.Provider value={{ editor: editor(), theme: mergedTheme }}>
      {props.children}
    </context.Provider>
  );
}
