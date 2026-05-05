/**
 * This is a manual tree walk renderer for the LexicalEditor synced markdown. It renders
 * the markdown features that are supported by our LexicalEngine.
 */

import type { CodeNode } from '@lexical/code';
import { PrismTokenizer } from '@lexical/code';
import { cn } from '@ui/utils/classname';
import type { LinkNode } from '@lexical/link';
import { $getListDepth, type ListItemNode, type ListNode } from '@lexical/list';
import type { HeadingNode, QuoteNode } from '@lexical/rich-text';
import type { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import {
  $isClassedBlockNode,
  type ClassedBlockNode,
  type ContactMentionNode,
  type DateMentionNode,
  DEFAULT_LANGUAGE,
  type DocumentCardNode,
  type DocumentMentionNode,
  type EquationNode,
  type SnapshotNode,
  type GroupMentionNode,
  type HorizontalRuleNode,
  type ImageNode,
  type ThemeMentionNode,
  type UnknownMentionNode,
  isSupportedLanguage,
  normalizedLanguage,
  SupportedNodeTypes,
  type UserMentionNode,
  type VideoNode,
  type WatermarkNode,
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
import {
  ENABLE_STATIC_DOCUMENT_CARDS,
  ENABLE_SVG_PREVIEW,
} from '@core/constant/featureFlags';
import type { MarkNode } from '@lexical/mark';
import type { SearchMatchNode } from '@lexical-core/nodes/SearchMatchNode';
import { theme as baseTheme, createTheme } from '../../theme';
import { forceSingleLine, setEditorStateFromMarkdown } from '../../utils';
import { StaticCodeBoxAccessory } from '../accessory/CodeBoxAccessory';
import { ContactMention as ContactMentionDecorator } from '../decorator/ContactMention';
import { DateMention as DateMentionDecorator } from '../decorator/DateMention';
import { DocumentCard as DocumentCardDecorator } from '../decorator/DocumentCard';
import { DocumentMention as DocumentMentionDecorator } from '../decorator/DocumentMention';
import { Snapshot as SnapshotDecorator } from '../decorator/Snapshot';
import { GroupMention as GroupMentionDecorator } from '../decorator/GroupMention';
import { Equation as EquationDecorator } from '../decorator/Equation';
import { MarkdownImage as ImageDecorator } from '../decorator/MarkdownImage';
import { MarkdownVideo as VideoDecorator } from '../decorator/MarkdownVideo';
import { UserMention as UserMentionDecorator } from '../decorator/UserMention';
import { ThemeMention as ThemeMentionDecorator } from '../decorator/ThemeMention';
import { UnknownMention as UnknownMentionDecorator } from '../decorator/UnknownMention';
import { Watermark as WatermarkDecorator } from '../decorator/Watermark';
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
    | DateMentionNode
    | WatermarkNode,
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

const ThemeMention: RenderableEntity<ThemeMentionNode> = {
  guard: (node: LexicalNode): node is ThemeMentionNode =>
    node.__type === 'theme-mention',
  render: (props) => (
    <span>
      {ThemeMentionDecorator({
        ...props.node.exportComponentProps(),
        key: props.node.getKey(),
        theme: props.theme,
      })}
    </span>
  ),
};

const Watermark: RenderableEntity<WatermarkNode> = {
  guard: (node: LexicalNode): node is WatermarkNode =>
    node.__type === 'watermark',
  render: (props) => (
    <span class={getTextClassName(props.node, props.theme)}>
      {WatermarkDecorator({
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

const GroupMention: RenderableEntity<GroupMentionNode> = {
  guard: (node: LexicalNode): node is GroupMentionNode =>
    node.__type === 'group-mention',
  render: (props) => (
    <span>
      {GroupMentionDecorator({
        ...props.node.exportComponentProps(),
        key: props.node.getKey(),
        theme: props.theme,
      })}
    </span>
  ),
};

const Snapshot: RenderableEntity<SnapshotNode> = {
  guard: (node: LexicalNode): node is SnapshotNode =>
    node.__type === 'snapshot',
  render: (props) => (
    <span>
      {SnapshotDecorator({
        ...props.node.exportComponentProps(),
        key: props.node.getKey(),
        theme: props.theme,
      })}
    </span>
  ),
};

const UnknownMention: RenderableEntity<UnknownMentionNode> = {
  guard: (node: LexicalNode): node is UnknownMentionNode =>
    node.__type === 'unknown-mention',
  render: (props) => (
    <span>
      {UnknownMentionDecorator({
        ...props.node.exportComponentProps(),
        key: props.node.getKey(),
        theme: props.theme,
      })}
    </span>
  ),
};

const Image: RenderableEntity<ImageNode> = {
  guard: (node: LexicalNode): node is ImageNode => node.__type === 'image',
  render: (props) => ImageDecorator(props.node.exportComponentProps()),
};

const Video: RenderableEntity<VideoNode> = {
  guard: (node: LexicalNode): node is VideoNode => node.__type === 'video',
  render: (props) => VideoDecorator(props.node.exportComponentProps()),
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
        <ul class={cn(props.theme.list?.ul, props.theme.list?.checklist)}>
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
    const children = props.node.getChildren();
    const nested = children.some((child) => child.__type === 'list');

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

const DocumentCard: RenderableEntity<DocumentCardNode> = {
  guard: (node: LexicalNode): node is DocumentCardNode =>
    node.__type === 'document-card',
  render: (props) => {
    if (ENABLE_STATIC_DOCUMENT_CARDS) {
      return DocumentCardDecorator({
        ...props.node.exportComponentProps(),
        key: props.node.getKey(),
        theme: props.theme,
      });
    }
    // TODO (seamus) : temp fix to make existing doc cards in dev look right.
    return (
      <p class="my-1.5">
        {DocumentMentionDecorator({
          ...props.node.exportComponentProps(),
          key: props.node.getKey(),
          theme: props.theme,
        })}
      </p>
    );
  },
};

// Table rendering components for Lexical tables
const Table: RenderableElement<TableNode> = {
  guard: (node: LexicalNode): node is TableNode => node.__type === 'table',
  render: (props) => (
    <div class={cn(props.theme?.static?.['table-container'])}>
      <table
        class={cn(props.theme.table, 'min-w-full table-auto')}
        style="width: max-content;"
      >
        {props.children}
      </table>
    </div>
  ),
};

const TableRow: RenderableElement<TableRowNode> = {
  guard: (node: LexicalNode): node is TableRowNode =>
    node.__type === 'tablerow',
  render: (props) => {
    const isFirstRow = props.node.getIndexWithinParent() === 0;
    return (
      <tr class={cn(props.theme.tableRow, isFirstRow && 'font-bold')}>
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
        class={cn(props.theme.tableCell, 'min-w-[100px] max-w-[350px]')}
        colspan={props.node.__colSpan}
        rowspan={props.node.__rowSpan}
      >
        {props.children}
      </Dynamic>
    );
  },
};

const ClassedBlock: RenderableElement<ClassedBlockNode> = {
  guard: (node: LexicalNode): node is ClassedBlockNode =>
    $isClassedBlockNode(node),
  render: (props) => {
    const tag = props.node.__tag;
    const classes = props.node.__classes.join(' ');
    return (
      <Dynamic
        component={tag}
        class={classes}
        data-classed-block="true"
        {...props.node.__attributes}
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
  DocumentCard,
  ContactMention,
  DateMention,
  GroupMention,
  Snapshot,
  Image,
  Video,
  HorizontalRule,
  Equation,
  ThemeMention,
  UnknownMention,
  Watermark,
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
  ClassedBlock,
] as const;

function Render(props: NodeComponent | ElementNodeComponent) {
  let entity = InlineEntities.find((entity) => entity.guard(props.node));
  if (entity) {
    return entity.render({
      ...props,
      theme: props.theme,
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
      }),
      theme: props.theme,
    });
  }

  console.error('Static Markdown: no render found for node', props.node);
  return '';
}

function MapRender(props: {
  children: LexicalNode[];
  theme: EditorThemeClasses;
}) {
  return props.children.map((child) => (
    <Render node={child} theme={props.theme} />
  ));
}

function Document(props: {
  rootNode: RootNode;
  theme: EditorThemeClasses;
  rootRef?: (ref: HTMLDivElement) => void;
  singleLine?: boolean;
}): JSX.Element {
  return (
    <div
      class={cn(
        'markdown-content',
        props.theme.root,
        'wrap-break-word max-w-full'
      )}
      ref={props.rootRef}
    >
      <MapRender children={props.rootNode.getChildren()} theme={props.theme} />
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
  singleLine?: boolean;
}) {
  let { editor: contextEditor, theme: parentTheme } = useContext(context);
  let [editorState, setEditorState] = createSignal<EditorState | null>(null);

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

  createEffect(() => {
    const editor = currentEditor();
    if (!editor) {
      setEditorState(null);
      return;
    }

    setEditorStateFromMarkdown(editor, props.markdown, props.target);
    if (props.singleLine) {
      forceSingleLine(editor);
    }
    setEditorState(editor.getEditorState());
  });

  // TODO: Move citations to bulk query when built in backend
  createEffect(() => {
    const editor = currentEditor();

    // Handle citations without affecting mentions
    replaceCitations(props.markdown).then((content: string) => {
      setEditorStateFromMarkdown(editor, content, props.target);
      if (props.singleLine) {
        forceSingleLine(editor);
      }
      setEditorState(editor.getEditorState());
    });
  });

  const domTree = createMemo(() => {
    return editorState()?.read(() => {
      return Document({
        rootNode: $getRoot(),
        theme: mergedTheme(),
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
