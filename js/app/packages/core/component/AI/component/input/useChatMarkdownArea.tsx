import { withAnalytics } from '@coparse/analytics';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import type { Attachment } from '@core/component/AI/types';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { ENABLE_SNAPSHOT_NODE } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import type { PortalScope } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import { handleFileFolderDrop } from '@core/util/upload';
import { $isDocumentMentionNode } from '@lexical-core';
import {
  DefaultShortcuts,
  type ItemMention,
  keyboardShortcutsPlugin,
  type NodeTransformType,
  NODE_TRANSFORM,
  type SelectionData,
} from '@core/component/LexicalMarkdown/plugins';
import { tableCellResizerPlugin } from '@core/component/LexicalMarkdown/plugins/tables/tableCellResizerPlugin';
import { tablePlugin } from '@core/component/LexicalMarkdown/plugins/tables/tablePlugin';
import {
  $traverseNodes,
  insertText,
} from '@core/component/LexicalMarkdown/utils';
import {
  FORMAT_TEXT_COMMAND,
  $getRoot,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import {
  type Accessor,
  createSignal,
  type JSXElement,
  onMount,
} from 'solid-js';
import type { IOrganizationUser } from '@core/user';
import type { HistoryItem } from '@queries/history/history';

const { track, TrackingEvents } = withAnalytics();

export type UseChatMarkdown = {
  focus: () => void;
  mentions: Accessor<ItemMention[]>;
  markdownText: Accessor<string>;
  formatState: SelectionData;
  clear: () => void;
  ref: Accessor<HTMLDivElement | undefined>;
  insert: (value: string) => void;
  MarkdownArea: (props: ConsumableChatMarkdownAreaProps) => JSXElement;
  setInlineFormat: (format: TextFormatType) => void;
  setNodeFormat: (transform: NodeTransformType) => void;
  removeMention: (mentionId: string) => void;
};

export type useChatMarkdownAreaArgs = {
  initialValue?: string;
  addAttachment: (attachment: Attachment) => void;
};

export type ConsumableChatMarkdownAreaProps = {
  onChange?: (value: string) => void;
  onEnter?: (e: KeyboardEvent) => boolean;
  onEscape?: (e: KeyboardEvent) => boolean;
  onBlur?: () => void;
  initialValue?: string;
  placeholder?: string;
  users?: Accessor<IOrganizationUser[]>;
  history?: Accessor<HistoryItem[]>;
  onPasteFile?: (files: File[]) => void;
  dontFocusOnMount?: boolean;
  portalScope?: PortalScope;
  onFocusLeaveStart?: (e: KeyboardEvent) => void;
  onFocusLeaveEnd?: (e: KeyboardEvent) => void;
  captureEditor?: (editor: LexicalEditor) => void;
};

export function useChatMarkdownArea(
  args: useChatMarkdownAreaArgs
): UseChatMarkdown {
  const [mentions, setMentions] = createSignal<ItemMention[]>([]);
  const [mountRef, setMountRef] = createSignal<HTMLDivElement>();

  const { getAttachmentFromMention } = useGetChatAttachmentInfo();

  // Mutable slot that is filled when ChatMarkdownArea first renders.
  // Props in SolidJS carry reactive getters so accessing e.g. chatProps.onEnter
  // inside a callback always returns the latest value from the parent.
  let chatProps: ConsumableChatMarkdownAreaProps = {};

  const editor = buildConfig('chat')
    .namespace('chat-markdown-area')
    .withMentions({
      onCreate: (mention: ItemMention) => {
        track(TrackingEvents.CHAT.MENTION.SELECT);
        const attachment = getAttachmentFromMention(mention);
        if (attachment) args.addAttachment(attachment);
        setMentions((prev) => [...prev, mention]);
      },
      onRemove: (mention) => {
        setMentions((prev) => prev.filter((m) => m.itemId !== mention.itemId));
      },
      block: 'chat',
      showOpenTabs: true,
      useSnapshotForDocuments: ENABLE_SNAPSHOT_NODE,
    })
    .withEmojis()
    .withLinks({ floatingMenu: true })
    .withHistory({ timeGap: 400 })
    .withCode()
    .withRestoreFocus()
    .withSelectionData()
    .withFilePaste({
      onPasteFilesAndDirs: (files, directories) => {
        const onPasteFile = chatProps.onPasteFile;
        if (!onPasteFile) return;
        if (directories.length > 0) {
          toast.failure('Folder upload not supported here');
          return;
        }
        handleFileFolderDrop(files, directories, (entries) => {
          onPasteFile(entries.map((e) => e.file));
        });
      },
    })
    .onEnter((e) => {
      const handler = chatProps.onEnter;
      if (!handler) return false;
      // Shift+Enter becomes a regular newline — pass through to Lexical.
      if (e.shiftKey) {
        Object.defineProperty(e, 'shiftKey', { value: false });
        return false;
      }
      const captured = handler(e);
      setTimeout(() => editor.controls.focus(), 0);
      return captured;
    })
    .onEscape((e) => chatProps.onEscape?.(e) ?? false)
    .onChange((md) => chatProps.onChange?.(md))
    .onFocusLeave({
      onStart: (e) => chatProps.onFocusLeaveStart?.(e),
      onEnd: (e) => chatProps.onFocusLeaveEnd?.(e),
    })
    .use(
      tablePlugin({
        hasCellMerge: true,
        hasCellBackgroundColor: false,
        hasTabHandler: true,
        hasHorizontalScroll: true,
      })
    )
    .use(tableCellResizerPlugin())
    .use(keyboardShortcutsPlugin({ shortcuts: DefaultShortcuts }));

  editor.buildHandle();

  function ChatMarkdownArea(props: ConsumableChatMarkdownAreaProps) {
    chatProps = props;

    if (props.captureEditor) {
      props.captureEditor(editor.lexical);
    }

    onMount(() => {
      setMountRef(
        editor.lexical.getRootElement() as HTMLDivElement | undefined
      );
    });

    return (
      <MarkdownShell
        config={editor}
        placeholder={props.placeholder ?? 'Ask AI, @mention anything'}
        initialValue={args.initialValue ?? props.initialValue}
        autofocus={!isMobile() && !props.dontFocusOnMount}
        portalScope={props.portalScope}
      />
    );
  }

  function removeMention(mentionId: string) {
    editor.lexical.update(() => {
      const root = $getRoot();
      let nodeToRemove: any = null;

      $traverseNodes(root, (node: any) => {
        if (
          $isDocumentMentionNode(node) &&
          node.getDocumentId() === mentionId
        ) {
          nodeToRemove = node;
          return true;
        }
        return false;
      });

      if (nodeToRemove) {
        nodeToRemove.remove();
        setMentions((prev) => prev.filter((m) => m.itemId !== mentionId));
      }
    });
  }

  return {
    insert: (text) => insertText(editor.lexical, text),
    MarkdownArea: ChatMarkdownArea,
    focus: () => setTimeout(() => editor.controls.focus(), 0),
    mentions,
    markdownText: () => editor.controls.getMarkdown(),
    ref: mountRef,
    clear: () => {
      editor.controls.clear();
      setMentions([]);
    },
    formatState: editor.selection as SelectionData,
    setInlineFormat: (format) => {
      editor.lexical.focus();
      editor.lexical.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    setNodeFormat: (transform) => {
      editor.lexical.focus();
      editor.lexical.dispatchCommand(NODE_TRANSFORM, transform);
    },
    removeMention,
  };
}
