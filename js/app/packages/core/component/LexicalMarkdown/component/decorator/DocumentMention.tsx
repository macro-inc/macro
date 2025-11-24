import {
  type BlockName,
  useMaybeBlockId,
  useMaybeBlockName,
} from '@core/block';
import {
  getMentionsIcon,
  mentionsAccessories,
  PopupPreview,
} from '@core/component/DocumentPreview';
import { EntityIcon } from '@core/component/EntityIcon';
import { verifyBlockName } from '@core/constant/allBlocks';
import { ENABLE_BLOCK_IN_BLOCK } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { canNestBlock } from '@core/orchestrator';
import {
  isAccessiblePreviewItem,
  type PreviewChannelAccess,
  type PreviewDocumentAccess,
  type PreviewItem,
  type PreviewItemAccess,
  type PreviewItemNoAccess,
  type PreviewProjectAccess,
  useItemPreview,
} from '@core/signal/preview';
import { matches } from '@core/util/match';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import EyeSlashDuo from '@icon/duotone/eye-slash-duotone.svg';
import TrashSimple from '@icon/duotone/trash-simple-duotone.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import {
  $convertMentionToCard,
  $isDocumentMentionNode,
  DocumentCardNode,
  type DocumentMentionDecoratorProps,
} from '@lexical-core';
import { blockNameToItemType } from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
import { debounce } from '@solid-primitives/scheduled';
import {
  $getNodeByKey,
  COMMAND_PRIORITY_NORMAL,
  type EditorThemeClasses,
  KEY_ENTER_COMMAND,
} from 'lexical';
import type { JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  Show,
  Switch,
  useContext,
} from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { floatWithElement } from '../../directive/floatWithElement';
import { autoRegister, UPDATE_DOCUMENT_NAME_COMMAND } from '../../plugins';
import { openDocument } from '../core/BlockLink';
import { MentionTooltip } from './MentionTooltip';

false && floatWithElement;

function MentionContainer(props: {
  icon: JSX.Element;
  text: JSX.Element;
  collapsed?: boolean;
}) {
  return (
    <span class="pointer-events-auto">
      <span class="relative top-[0.125em] size-[1em] inline-flex mx-1">
        {props.icon}
      </span>
      <Show when={!props.collapsed}>
        <span class="underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
          {props.text}
        </span>
      </Show>
    </span>
  );
}

function Spinner() {
  return (
    <div class="animate-spin">
      <LoadingSpinner />
    </div>
  );
}

function Loading(props: { collapsed?: boolean }) {
  return (
    <MentionContainer
      icon={<Spinner />}
      text={props.collapsed ? '' : 'Loading'}
    />
  );
}

type AccessiblePreviewItem =
  | PreviewItemAccess
  | PreviewProjectAccess
  | PreviewDocumentAccess
  | PreviewChannelAccess;

function isAccessible(item: PreviewItem): item is AccessiblePreviewItem {
  return isAccessiblePreviewItem(item);
}

function InlinePreview(props: {
  item: () => PreviewItem;
  blockName: BlockName;
  blockParams: Record<string, string>;
  theme?: EditorThemeClasses;
  collapsed?: boolean;
}) {
  return (
    <Switch>
      <Match when={props.item().loading}>
        <Loading />
      </Match>
      <Match when={matches(props.item(), isAccessible)}>
        {(accessibleItem) => {
          const { type, fileType, channelType } = accessibleItem();
          return (
            <MentionContainer
              icon={
                <Show
                  when={type === 'channel'}
                  fallback={
                    <EntityIcon
                      targetType={type === 'document' ? fileType : type}
                      size="fill"
                      theme={
                        props.theme?.['document-mention'] === 'chat-blue'
                          ? 'monochrome'
                          : undefined
                      }
                    />
                  }
                >
                  <EntityIcon
                    size="fill"
                    targetType={
                      channelType === 'direct_message'
                        ? 'directMessage'
                        : channelType === 'organization'
                          ? 'company'
                          : 'channel'
                    }
                  />
                </Show>
              }
              text={
                <span
                  data-document-mention="true"
                  data-document-id={accessibleItem().id}
                  data-block-name={props.blockName}
                  data-document-name={accessibleItem().name}
                >
                  {accessibleItem().name.replaceAll('\n', ' ').trim()}
                  <span class="relative text-[0.8em] text-current/50 rounded-xs">
                    {(() => {
                      const accessories = mentionsAccessories(
                        props.blockName as BlockName,
                        props.blockParams
                      );
                      if (accessories) {
                        return (
                          <>
                            {` ${accessories.note ?? ''}`}
                            {getMentionsIcon(accessories.icon)}
                          </>
                        );
                      }
                    })()}
                  </span>
                </span>
              }
              collapsed={props.collapsed}
            />
          );
        }}
      </Match>
      <Match
        when={(props.item() as PreviewItemNoAccess).access === 'no_access'}
      >
        <MentionContainer icon={<EyeSlashDuo />} text="No Access" />
      </Match>
      <Match
        when={(props.item() as PreviewItemNoAccess).access === 'does_not_exist'}
      >
        <MentionContainer icon={<TrashSimple />} text="Deleted" />
      </Match>
    </Switch>
  );
}

export function DocumentMention(props: DocumentMentionDecoratorProps) {
  const currentBlockId = useMaybeBlockId();
  const currentBlockName = useMaybeBlockName();

  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const selection = () => lexicalWrapper?.selection;

  let inlinePreviewRef!: HTMLSpanElement;

  const [isCollapsed, setIsCollapsed] = createSignal<boolean>(
    props.collapsed ?? false
  );

  const isCollapsable = createMemo(() => {
    return lexicalWrapper?.isInteractable() ?? false;
  });

  const showEmbedOption = createMemo(() => {
    if (!lexicalWrapper?.isInteractable()) return false;
    if (!lexicalWrapper?.editor.hasNode(DocumentCardNode)) return false;
    return true;
  });

  const isEmbeddable = createMemo(() => {
    if (!ENABLE_BLOCK_IN_BLOCK) return false;
    const blockName = verifyBlockName(props.blockName);
    return canNestBlock(blockName, currentBlockName);
  });

  const previewType = () =>
    blockNameToItemType(verifyBlockName(props.blockName));

  const [item] = useItemPreview({
    id: props.documentId,
    type: previewType(),
  });

  const [popupOpen, setPopupOpen] = createSignal(false);
  const debouncedSetPreviewOpen = debounce(setPopupOpen, 100);

  const isSelectedAsNode = createMemo(() => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  });

  const open = createCallback((e: MouseEvent | KeyboardEvent | null) => {
    openDocument(
      props.blockName,
      props.documentId,
      props.blockParams,
      e?.altKey ?? false
    );
  });

  if (editor) {
    autoRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e) => {
          if (isSelectedAsNode()) {
            open(e);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
  }

  // The internal model of the LexicalNode needs the fresh state of the document
  // name for serialization.
  createEffect(() => {
    const i = item();
    if (i.loading) return;
    if (i.access === 'access') {
      setTimeout(() => {
        editor?.dispatchCommand(UPDATE_DOCUMENT_NAME_COMMAND, {
          [props.documentId]: i.name,
        });
      });
    } else if (i.access === 'no_access') {
      setTimeout(() => {
        editor?.dispatchCommand(UPDATE_DOCUMENT_NAME_COMMAND, {
          [props.documentId]: 'No Access',
        });
      });
    } else if (i.access === 'does_not_exist') {
      setTimeout(() => {
        editor?.dispatchCommand(UPDATE_DOCUMENT_NAME_COMMAND, {
          [props.documentId]: 'Deleted',
        });
      });
    }
  });

  const deleteMention = () => {
    editor?.update(() => {
      const node = $getNodeByKey(props.key);
      if (!$isDocumentMentionNode(node)) return false;
      node.remove();
      return true;
    });
  };

  const convertToCard = () => {
    if (!editor) return;
    editor.update(() => {
      const node = $getNodeByKey(props.key);
      if (!$isDocumentMentionNode(node)) return false;
      $convertMentionToCard(node);
      return true;
    });
  };

  const navHandlers = useSplitNavigationHandler<HTMLSpanElement>((e) => {
    e.stopPropagation();
    if (matches(item(), (i) => !i.loading && i.access === 'access')) {
      open(e);
    }
  });

  return (
    <>
      <span class="relative">
        <span
          class="w-full h-full py-0.5 cursor-default rounded-xs hover:bg-hover focus:bg-active"
          classList={{
            'bg-active text-ink bracket bracket-offset-2': isSelectedAsNode(),
          }}
          style={{
            'user-select': 'inherit',
          }}
          ref={inlinePreviewRef}
          onMouseEnter={() => {
            if (!isTouchDevice) {
              debouncedSetPreviewOpen(true);
            }
          }}
          onMouseLeave={() => {
            if (!isTouchDevice) {
              debouncedSetPreviewOpen.clear();
              debouncedSetPreviewOpen(false);
            }
          }}
          ontouchstart={(e) => {
            if (isTouchDevice) {
              e.preventDefault();
            }
          }}
          ontouchend={(e) => {
            if (isTouchDevice) {
              e.preventDefault();
              if (matches(item(), (i) => !i.loading && i.access === 'access')) {
                open(null);
              }
            }
          }}
          {...navHandlers}
        >
          <Switch>
            <Match when={item().loading}>
              <Loading collapsed={isCollapsed()} />
            </Match>
            <Match when={item()}>
              <InlinePreview
                item={item}
                blockName={verifyBlockName(props.blockName)}
                blockParams={props.blockParams || {}}
                theme={props.theme}
                collapsed={isCollapsed()}
              />
            </Match>
          </Switch>
        </span>
        <MentionTooltip show={isSelectedAsNode()} text="Open" />
      </span>

      <Show when={popupOpen()}>
        <PopupPreview
          item={item}
          floatRef={inlinePreviewRef}
          mouseEnter={() => {
            debouncedSetPreviewOpen(true);
          }}
          mouseLeave={() => {
            debouncedSetPreviewOpen.clear();
            debouncedSetPreviewOpen(false);
          }}
          delete={editor?.isEditable() ? deleteMention : undefined}
          collapseInfo={{
            isCollapsed: isCollapsed(),
            isCollapsable: isCollapsable(),
            handleCollapse: () => {
              const state = !isCollapsed();
              setIsCollapsed(state);
              editor?.update(() => {
                const node = $getNodeByKey(props.key);
                if ($isDocumentMentionNode(node)) {
                  node.setCollapsed(state);
                }
              });
            },
          }}
          documentInfo={{
            id: props.documentId,
            type: verifyBlockName(props.blockName),
            params: props.blockParams ?? {},
            isOpenable: currentBlockId !== props.documentId,
          }}
          previewInfo={{
            isPreviewable: isEmbeddable(),
            showPreview: showEmbedOption(),
            handlePreviewToggle: convertToCard,
          }}
        />
      </Show>
    </>
  );
}
