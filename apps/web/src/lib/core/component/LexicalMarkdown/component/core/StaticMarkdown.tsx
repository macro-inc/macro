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
  $isClassedBlockNode,
  type AgentContextNode,
  type AwaitNode,
  type ClassedBlockNode,
  type ContactMentionNode,
  type DateMentionNode,
  DEFAULT_LANGUAGE,
  type DocumentCardNode,
  type DocumentMentionNode,
  type EquationNode,
  type GroupMentionNode,
  type HorizontalRuleNode,
  type ImageNode,
  isSupportedLanguage,
  type MagicChipNode,
  normalizedLanguage,
  type PasteNode,
  type SnapshotNode,
  SupportedNodeTypes,
  type TagMentionNode,
  type ThemeMentionNode,
  type UnknownMentionNode,
  type UserMentionNode,
  type VideoNode,
  type WatermarkNode,
} from '@macro-inc/lexical-core';
import { cn } from '@ui';
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
  onCleanup,
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
import type { SearchMatchNode } from '@macro-inc/lexical-core/nodes/SearchMatchNode';
import { getCachedItemPreview } from '@queries/preview';
import { theme as baseTheme, createTheme } from '../../theme';
import { forceSingleLine, setEditorStateFromMarkdown } from '../../utils';
import { StaticCodeBoxAccessory } from '../accessory/CodeBoxAccessory';
import { AgentContext as AgentContextDecorator } from '../decorator/AgentContext';
import { Await as AwaitDecorator } from '../decorator/Await';
import { ContactMention as ContactMentionDecorator } from '../decorator/ContactMention';
import { DateMention as DateMentionDecorator } from '../decorator/DateMention';
import { DocumentCard as DocumentCardDecorator } from '../decorator/DocumentCard';
import { DocumentMention as DocumentMentionDecorator } from '../decorator/DocumentMention';
import { Equation as EquationDecorator } from '../decorator/Equation';
import { GroupMention as GroupMentionDecorator } from '../decorator/GroupMention';
import { LazyDecorator } from '../decorator/LazyDecorator';
import { MagicChip as MagicChipDecorator } from '../decorator/MagicChip';
import { MarkdownImage as ImageDecorator } from '../decorator/MarkdownImage';
import { MarkdownVideo as VideoDecorator } from '../decorator/MarkdownVideo';
import { PasteNode as PasteNodeDecorator } from '../decorator/PasteNode';
import { Snapshot as SnapshotDecorator } from '../decorator/Snapshot';
import { TagMention as TagMentionDecorator } from '../decorator/TagMention';
import { ThemeMention as ThemeMentionDecorator } from '../decorator/ThemeMention';
import { UnknownMention as UnknownMentionDecorator } from '../decorator/UnknownMention';
import { UserMention as UserMentionDecorator } from '../decorator/UserMention';
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
  createEmptyLinePlaceholder: (): Node => {
    const spanNode = document.createElement('span');
    spanNode.classList.add('md-code-empty-line');
    spanNode.setAttribute('aria-hidden', 'true');
    spanNode.innerText = '\u200B';
    return spanNode;
  },

  /**
   * Get highlight spans from the Prism tokens.
   */
  getHighlights: (
    tokens: Array<string | Token>,
    type: string | null,
    theme: EditorThemeClasses
  ): Node[] => {
    const nodes: Node[] = [];
    let atLineStart = true;
    for (const token of tokens) {
      if (typeof token === 'string') {
        const partials = token.split(/(\n|\t)/);
        const partialsLength = partials.length;
        for (let i = 0; i < partialsLength; i++) {
          const part = partials[i];
          if (part === '\n' || part === '\r\n') {
            if (atLineStart) {
              nodes.push(CodeHighlightShim.createEmptyLinePlaceholder());
            }
            nodes.push(document.createElement('br'));
            atLineStart = true;
          } else if (part === '\t') {
            const tabNode = document.createElement('span');
            const className = theme.tab;
            if (className) tabNode.classList.add(className);
            nodes.push(tabNode);
            atLineStart = false;
          } else if (part.length > 0) {
            const spanNode = document.createElement('span');
            const className = type
              ? (theme?.codeHighlight?.[type!] ?? null)
              : null;
            if (className) spanNode.classList.add(className);
            spanNode.innerText = part;
            nodes.push(spanNode);
            atLineStart = false;
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
    if (nodes.length === 0) {
      nodes.push(CodeHighlightShim.createEmptyLinePlaceholder());
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

type StaticRenderOptions = {
  lazy: boolean;
};

type TypedRenderableEntity<T extends LexicalNode> = {
  guard: (node: LexicalNode) => node is T;
  render: (
    props: NodeComponent<T>,
    options: StaticRenderOptions
  ) => JSX.Element;
};

type RenderableEntity = {
  guard: (node: LexicalNode) => boolean;
  render: (props: NodeComponent, options: StaticRenderOptions) => JSX.Element;
};

function eraseRenderableEntity<T extends LexicalNode>(
  entity: TypedRenderableEntity<T>
): RenderableEntity {
  return {
    guard: entity.guard,
    render: (props, options) => {
      if (!entity.guard(props.node)) {
        throw new Error('Static entity renderer received an unsupported node');
      }
      return entity.render({ node: props.node, theme: props.theme }, options);
    },
  };
}

type TypedRenderableElement<T extends ElementNode> = {
  guard: (node: LexicalNode) => node is T;
  render: (
    props: ElementNodeComponent<T>,
    options: StaticRenderOptions
  ) => JSX.Element;
};

type RenderableElement = {
  guard: (node: LexicalNode) => boolean;
  render: (
    props: ElementNodeComponent,
    options: StaticRenderOptions
  ) => JSX.Element;
};

function eraseRenderableElement<T extends ElementNode>(
  element: TypedRenderableElement<T>
): RenderableElement {
  return {
    guard: element.guard,
    render: (props, options) => {
      if (!element.guard(props.node)) {
        throw new Error('Static element renderer received an unsupported node');
      }
      return element.render(
        {
          node: props.node,
          children: props.children,
          theme: props.theme,
        },
        options
      );
    },
  };
}

const Text: TypedRenderableEntity<TextNode> = {
  guard: (node: LexicalNode): node is TextNode => node.__type === 'text',
  render: (props) => {
    return (
      <span class={getTextClassName(props.node, props.theme)}>
        {props.node.__text}
      </span>
    );
  },
};

const LineBreak: TypedRenderableEntity<LineBreakNode> = {
  guard: (node: LexicalNode): node is LineBreakNode =>
    node.__type === 'linebreak',
  render: () => <br />,
};

const UserMention: TypedRenderableEntity<UserMentionNode> = {
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

const MentionPlaceholder = () => (
  <span class="pointer-events-none inline-block align-baseline opacity-60">
    <span class="relative top-[0.125em] size-[1em] inline-block mx-1 bg-current/15 rounded-xs" />
    <span class="inline-block w-12 h-[0.9em] align-baseline bg-current/10 rounded-sm" />
  </span>
);

const DocumentMention: TypedRenderableEntity<DocumentMentionNode> = {
  guard: (node: LexicalNode): node is DocumentMentionNode =>
    node.__type === 'document-mention',
  render: (props, options) => {
    const componentProps = props.node.exportComponentProps();
    const key = props.node.getKey();
    const mention = () =>
      DocumentMentionDecorator({
        ...componentProps,
        key,
        theme: props.theme,
      });
    const shouldRenderLazy =
      options.lazy &&
      getCachedItemPreview(componentProps.documentId) === undefined;

    return (
      <span class={getTextClassName(props.node, props.theme)}>
        {shouldRenderLazy ? (
          <LazyDecorator
            placeholder={<MentionPlaceholder />}
            render={mention}
          />
        ) : (
          mention()
        )}
      </span>
    );
  },
};

const ThemeMention: TypedRenderableEntity<ThemeMentionNode> = {
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

const TagMention: TypedRenderableEntity<TagMentionNode> = {
  guard: (node: LexicalNode): node is TagMentionNode =>
    node.__type === 'tag-mention',
  render: (props) => (
    <span>
      {TagMentionDecorator({
        ...props.node.exportComponentProps(),
        key: props.node.getKey(),
        theme: props.theme,
      })}
    </span>
  ),
};

const Watermark: TypedRenderableEntity<WatermarkNode> = {
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

const ContactMention: TypedRenderableEntity<ContactMentionNode> = {
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

const DateMention: TypedRenderableEntity<DateMentionNode> = {
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

const GroupMention: TypedRenderableEntity<GroupMentionNode> = {
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

const Await: TypedRenderableEntity<AwaitNode> = {
  guard: (node: LexicalNode): node is AwaitNode => node.__type === 'await',
  render: (props) => {
    const componentProps = props.node.exportComponentProps();
    return (
      <span>
        {AwaitDecorator({
          awaitId: componentProps.awaitId,
          text: componentProps.text,
          inline: componentProps.inline ?? true,
          key: props.node.getKey(),
          theme: props.theme,
        })}
      </span>
    );
  },
};

const AgentContext: TypedRenderableEntity<AgentContextNode> = {
  guard: (node: LexicalNode): node is AgentContextNode =>
    node.__type === 'agent-context',
  render: (props) => (
    <AgentContextDecorator
      {...props.node.exportComponentProps()}
      key={props.node.getKey()}
      theme={props.theme}
    />
  ),
};

const MagicChip: TypedRenderableEntity<MagicChipNode> = {
  guard: (node: LexicalNode): node is MagicChipNode =>
    node.__type === 'magic-chip',
  render: (props) => (
    <div class="max-w-full">
      <MagicChipDecorator
        {...props.node.exportComponentProps()}
        key={props.node.getKey()}
        theme={props.theme}
      />
    </div>
  ),
};

const Snapshot: TypedRenderableEntity<SnapshotNode> = {
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

const UnknownMention: TypedRenderableEntity<UnknownMentionNode> = {
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

const Image: TypedRenderableEntity<ImageNode> = {
  guard: (node: LexicalNode): node is ImageNode => node.__type === 'image',
  render: (props) => ImageDecorator(props.node.exportComponentProps()),
};

const Video: TypedRenderableEntity<VideoNode> = {
  guard: (node: LexicalNode): node is VideoNode => node.__type === 'video',
  render: (props) => VideoDecorator(props.node.exportComponentProps()),
};

const Paragraph: TypedRenderableElement<ParagraphNode> = {
  guard: (node: LexicalNode): node is ParagraphNode =>
    node.__type === 'paragraph',
  render: (props) => <p class={props.theme.paragraph}>{props.children}</p>,
};

const Heading: TypedRenderableElement<HeadingNode> = {
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

const List: TypedRenderableElement<ListNode> = {
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

const ListItem: TypedRenderableElement<ListItemNode> = {
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

const Quote: TypedRenderableElement<QuoteNode> = {
  guard: (node: LexicalNode): node is QuoteNode => node.__type === 'quote',
  render: (props) => (
    <blockquote class={props.theme.quote}>{props.children}</blockquote>
  ),
};

const Code: TypedRenderableElement<CodeNode> = {
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

const HorizontalRule: TypedRenderableEntity<HorizontalRuleNode> = {
  guard: (node: LexicalNode): node is HorizontalRuleNode =>
    node.__type === 'horizontalrule',
  render: (props) => <div class={props.theme.hr} />,
};

const Link: TypedRenderableElement<LinkNode> = {
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

const Mark: TypedRenderableElement<MarkNode> = {
  guard: (node: LexicalNode): node is MarkNode => node.__type === 'mark',
  render: (props) => <span class={props.theme.mark}>{props.children}</span>,
};

const SearchMatch: TypedRenderableElement<SearchMatchNode> = {
  guard: (node: LexicalNode): node is SearchMatchNode =>
    node.__type === 'search-match',
  render: (props) => (
    <span class={props.theme.searchMatch}>{props.children}</span>
  ),
};

const Equation: TypedRenderableEntity<EquationNode> = {
  guard: (node: LexicalNode): node is EquationNode =>
    node.__type === 'equation',
  render: (props) => (
    <EquationDecorator equation={props.node.__equation} inline={true} />
  ),
};

const DocumentCard: TypedRenderableEntity<DocumentCardNode> = {
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

const Paste: TypedRenderableEntity<PasteNode> = {
  guard: (node: LexicalNode): node is PasteNode => node.__type === 'paste',
  render: (props) =>
    PasteNodeDecorator({
      ...props.node.exportComponentProps(),
      key: props.node.getKey(),
      theme: props.theme,
    }),
};

// Table rendering components for Lexical tables
const Table: TypedRenderableElement<TableNode> = {
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

const TableRow: TypedRenderableElement<TableRowNode> = {
  guard: (node: LexicalNode): node is TableRowNode =>
    node.__type === 'tablerow',
  render: (props) => {
    const isFirstRow = props.node.getIndexWithinParent() === 0;
    const height = props.node.getHeight();
    return (
      <tr
        class={cn(props.theme.tableRow, isFirstRow && 'font-bold')}
        style={height ? { height: `${height}px` } : undefined}
      >
        {props.children}
      </tr>
    );
  },
};

const TableCell: TypedRenderableElement<TableCellNode> = {
  guard: (node: LexicalNode): node is TableCellNode =>
    node.__type === 'tablecell',
  render: (props) => {
    return (
      <Dynamic
        component={'td'}
        class={cn(props.theme.tableCell, 'min-w-25 max-w-87.5')}
        colspan={props.node.__colSpan}
        rowspan={props.node.__rowSpan}
      >
        {props.children}
      </Dynamic>
    );
  },
};

const ClassedBlock: TypedRenderableElement<ClassedBlockNode> = {
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
const InlineEntities: RenderableEntity[] = [
  eraseRenderableEntity(Text),
  eraseRenderableEntity(LineBreak),
  eraseRenderableEntity(UserMention),
  eraseRenderableEntity(DocumentMention),
  eraseRenderableEntity(DocumentCard),
  eraseRenderableEntity(ContactMention),
  eraseRenderableEntity(DateMention),
  eraseRenderableEntity(GroupMention),
  eraseRenderableEntity(Await),
  eraseRenderableEntity(AgentContext),
  eraseRenderableEntity(MagicChip),
  eraseRenderableEntity(Snapshot),
  eraseRenderableEntity(Image),
  eraseRenderableEntity(Video),
  eraseRenderableEntity(HorizontalRule),
  eraseRenderableEntity(Equation),
  eraseRenderableEntity(ThemeMention),
  eraseRenderableEntity(TagMention),
  eraseRenderableEntity(UnknownMention),
  eraseRenderableEntity(Watermark),
  eraseRenderableEntity(Paste),
];

const Elements: RenderableElement[] = [
  eraseRenderableElement(Paragraph),
  eraseRenderableElement(Heading),
  eraseRenderableElement(List),
  eraseRenderableElement(ListItem),
  eraseRenderableElement(Quote),
  eraseRenderableElement(Code),
  eraseRenderableElement(Link),
  eraseRenderableElement(Mark),
  eraseRenderableElement(SearchMatch),
  eraseRenderableElement(Table),
  eraseRenderableElement(TableRow),
  eraseRenderableElement(TableCell),
  eraseRenderableElement(ClassedBlock),
];

function Render(
  props: (NodeComponent | ElementNodeComponent) & StaticRenderOptions
) {
  let entity = InlineEntities.find((entity) => entity.guard(props.node));
  if (entity) {
    return entity.render(
      {
        ...props,
        theme: props.theme,
      },
      { lazy: props.lazy }
    );
  }

  const element = Elements.find((entity) => entity.guard(props.node));

  if (element) {
    let elemNode = props.node as ElementNode;
    return element.render(
      {
        node: elemNode,
        children: MapRender({
          children: elemNode.getChildren(),
          theme: props.theme,
          lazy: props.lazy,
        }),
        theme: props.theme,
      },
      { lazy: props.lazy }
    );
  }

  console.error('Static Markdown: no render found for node', props.node);
  return '';
}

function MapRender(
  props: {
    children: LexicalNode[];
    theme: EditorThemeClasses;
  } & StaticRenderOptions
) {
  return props.children.map((child) => (
    <Render node={child} theme={props.theme} lazy={props.lazy} />
  ));
}

function Document(
  props: {
    rootNode: RootNode;
    theme: EditorThemeClasses;
    rootRef?: (ref: HTMLDivElement) => void;
    singleLine?: boolean;
  } & StaticRenderOptions
): JSX.Element {
  return (
    <div
      class={cn(
        'markdown-content',
        props.theme.root,
        'wrap-break-word max-w-full'
      )}
      ref={props.rootRef}
    >
      <MapRender
        children={props.rootNode.getChildren()}
        theme={props.theme}
        lazy={props.lazy}
      />
    </div>
  );
}

const context = createContext<{
  editor: LexicalEditor | null;
  theme: Accessor<EditorThemeClasses>;
  lazy: Accessor<boolean>;
}>({ editor: null, theme: () => baseTheme, lazy: () => true });

export function StaticMarkdown(props: {
  markdown: string;
  parentEditor?: LexicalEditor;
  theme?: EditorThemeClasses;
  setEditorRef?: (editor: LexicalEditor) => void;
  /* Accessor for the parsed state this instance renders. Unlike setEditorRef
     (which may hand back the shared context editor), the state snapshot is
     always this instance's own parse of its markdown. */
  setStateRef?: (
    state: Accessor<EditorState | null> | undefined,
    key?: string
  ) => void;
  stateRefKey?: string;
  rootRef?: (ref: HTMLDivElement) => void;
  target?: 'internal' | 'external' | 'both';
  singleLine?: boolean;
  lazy?: boolean;
}) {
  let {
    editor: contextEditor,
    theme: parentTheme,
    lazy: parentLazy,
  } = useContext(context);
  let [editorState, setEditorState] = createSignal<EditorState | null>(null);
  createEffect(() => {
    const setStateRef = props.setStateRef;
    const key = props.stateRefKey;
    if (!setStateRef) return;
    setStateRef(editorState, key);
    onCleanup(() => setStateRef(undefined, key));
  });

  if (contextEditor === null) {
    console.warn(
      'Calling StaticMarkdown outside of StaticMarkdownContext will create a new LexicalEditor for each StaticMarkdown instance. This might not be what you want.'
    );
  }

  const mergedTheme = () => {
    if (!props.theme) return parentTheme();
    return createTheme(props.theme ?? {}, parentTheme());
  };

  const lazy = () => props.lazy ?? parentLazy();

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
        lazy: lazy(),
        rootRef: props.rootRef,
      });
    });
  });

  return <>{domTree()}</>;
}

export function StaticMarkdownContext(props: {
  children: JSX.Element;
  theme?: EditorThemeClasses;
  lazy?: boolean;
}) {
  const mergedTheme = () => {
    if (!props.theme) return baseTheme;
    return createTheme(props.theme, baseTheme, { join: true });
  };

  const editor = createMemo(() =>
    newStaticRenderingEditor({ theme: mergedTheme() })
  );

  return (
    <context.Provider
      value={{
        editor: editor(),
        theme: mergedTheme,
        lazy: () => props.lazy ?? true,
      }}
    >
      {props.children}
    </context.Provider>
  );
}
