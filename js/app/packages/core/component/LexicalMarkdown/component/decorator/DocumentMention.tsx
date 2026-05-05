import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import {
  type BlockAlias,
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
import { HoverCard } from '@core/component/HoverCard';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import { useEntityProperties } from '@core/component/Properties/hooks';
import { UserIcon } from '@core/component/UserIcon';
import {
  itemToBlockName,
  resolveBlockAlias,
  verifyBlockName,
} from '@core/constant/allBlocks';
import { ENABLE_BLOCK_IN_BLOCK } from '@core/constant/featureFlags';
import { canNestBlock } from '@core/orchestrator';
import { formatDate } from '@core/util/date';
import { matches } from '@core/util/match';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import EyeSlashDuo from '@icon/duotone/eye-slash-duotone.svg';
import TrashSimple from '@icon/duotone/trash-simple-duotone.svg';
import {
  $convertMentionToCard,
  $isDocumentMentionNode,
  DocumentCardNode,
  type DocumentMentionDecoratorProps,
} from '@lexical-core';
import {
  type ItemEntity,
  isAccessiblePreviewItem,
  type PreviewItemNoAccess,
  useItemPreview,
} from '@queries/preview';
import { blockNameToItemType } from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
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
  Suspense,
  Switch,
  useContext,
} from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { autoRegister, UPDATE_DOCUMENT_NAME_COMMAND } from '../../plugins';
import { openDocument } from '../core/BlockLink';
import { MentionTooltip } from './MentionTooltip';

// Time threshold for showing fallback state for recently created mentions (1 minute)
const RECENT_MENTION_THRESHOLD_MS = 1 * 60 * 1000;

/**
 * Determine if we should use fallback data for a mention due to stale preview cache.
 * This happens when a mention is very recent and the preview API returns does_not_exist
 * (likely due to cache staleness rather than actual deletion).
 */
function shouldUseFallbackForRecentMention(
  previewItem: { loading: boolean; access?: string },
  isRecent: boolean
): boolean {
  return (
    !previewItem.loading && previewItem.access === 'does_not_exist' && isRecent
  );
}

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

function InlineTaskProperties(props: { taskId: string }) {
  const { properties, isLoading } = useEntityProperties(
    props.taskId,
    'TASK',
    false
  );

  const statusOptionId = createMemo(() => {
    const p = properties().find(
      (p) => p.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS
    );
    return p?.valueType === 'SELECT_STRING' ? p.value?.[0] : undefined;
  });

  const priorityOptionId = createMemo(() => {
    const p = properties().find(
      (p) => p.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PRIORITY
    );
    return p?.valueType === 'SELECT_STRING' ? p.value?.[0] : undefined;
  });

  const firstAssigneeId = createMemo(() => {
    const p = properties().find(
      (p) => p.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES
    );
    return p?.valueType === 'ENTITY' ? p.value?.[0]?.entity_id : undefined;
  });

  const hasAny = createMemo(
    () =>
      !isLoading() &&
      !!(statusOptionId() || priorityOptionId() || firstAssigneeId())
  );

  return (
    <Show when={hasAny()}>
      <span class="inline-flex items-center gap-1 mx-1 align-middle relative top-[-0.05em]">
        <Show when={statusOptionId()}>
          {(id) => <PropertyValueIcon optionId={id()} class="size-3" />}
        </Show>
        <Show when={priorityOptionId()}>
          {(id) => <PropertyValueIcon optionId={id()} class="size-3" />}
        </Show>
        <Show when={firstAssigneeId()}>
          {(id) => (
            <span class="inline-flex ml-0.5 size-3.25">
              <UserIcon
                id={id()}
                isDeleted={false}
                size="fill"
                suppressClick
                showTooltip={false}
              />
            </span>
          )}
        </Show>
      </span>
    </Show>
  );
}

function InlinePreview(props: {
  entity: ItemEntity;
  blockName: BlockName | BlockAlias;
  blockParams: Record<string, string>;
  theme?: EditorThemeClasses;
  collapsed?: boolean;
  documentName?: string;
  createdAt?: number;
  isRecentMention: () => boolean;
}) {
  const { item, ItemEntityIcon } = useItemPreviewData(() => props.entity);

  const shouldShowFallback = createMemo(() => {
    return (
      shouldUseFallbackForRecentMention(item(), props.isRecentMention()) &&
      props.documentName
    );
  });
  return (
    <Switch>
      <Match when={item().loading}>
        <MentionContainer
          icon={
            <EntityIcon
              targetType={props.blockName as any}
              size="fill"
              class="animate-pulse"
            />
          }
          text={
            <span
              data-document-mention="true"
              data-document-id={props.entity.id}
              data-block-name={props.blockName}
              data-document-name={props.documentName}
              class="opacity-50"
            >
              <Show when={props.documentName} fallback={'Loading...'}>
                {(name) => name().replaceAll('\n', ' ').trim()}
              </Show>
            </span>
          }
          collapsed={props.collapsed}
        />
      </Match>
      <Match when={shouldShowFallback()}>
        <MentionContainer
          icon={<EntityIcon targetType={props.blockName as any} size="fill" />}
          text={
            <span
              data-document-mention="true"
              data-document-id={props.entity.id}
              data-block-name={props.blockName}
              data-document-name={props.documentName}
            >
              <Show when={props.documentName} fallback={'Unknown'}>
                {(name) => name().replaceAll('\n', ' ').trim()}
              </Show>
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
      </Match>
      <Match when={matches(item(), isAccessiblePreviewItem)}>
        {(accessibleItem) => (
          <MentionContainer
            icon={
              <ItemEntityIcon
                size="fill"
                theme={
                  accessibleItem().type !== 'channel' &&
                  props.theme?.['document-mention'] === 'chat-blue'
                    ? 'monochrome'
                    : undefined
                }
              />
            }
            text={
              <span
                data-document-mention="true"
                data-document-id={accessibleItem().id}
                data-block-name={props.blockName}
                data-document-name={accessibleItem().name}
              >
                {accessibleItem().name.replaceAll('\n', ' ').trim()}
                <Show
                  when={
                    accessibleItem().type === 'call' &&
                    accessibleItem().updatedAt
                  }
                >
                  {(timeStamp) => {
                    return (
                      <span class="text-current/50 text-[0.8em]">
                        {` ${formatDate(timeStamp(), { showTime: true })}`}
                      </span>
                    );
                  }}
                </Show>
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
                <Show when={props.blockName === 'task'}>
                  <Suspense>
                    <InlineTaskProperties taskId={accessibleItem().id} />
                  </Suspense>
                </Show>
              </span>
            }
            collapsed={props.collapsed}
          />
        )}
      </Match>
      <Match when={(item() as PreviewItemNoAccess).access === 'no_access'}>
        <MentionContainer icon={<EyeSlashDuo />} text="No Access" />
      </Match>
      <Match when={(item() as PreviewItemNoAccess).access === 'does_not_exist'}>
        <MentionContainer icon={<TrashSimple />} text="Deleted" />
      </Match>
    </Switch>
  );
}

export function DocumentMention(props: DocumentMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  if (lexicalWrapper?.skipPreviewFetch) {
    return <DocumentMentionStatic {...props} />;
  }
  return (
    <Suspense>
      <DocumentMentionInner {...props} />
    </Suspense>
  );
}

/** Lightweight mention display that skips all backend fetches. Uses only the stored name. */
function DocumentMentionStatic(props: DocumentMentionDecoratorProps) {
  return (
    <MentionContainer
      icon={<EntityIcon targetType={props.blockName as any} size="fill" />}
      text={
        <span
          data-document-mention="true"
          data-document-id={props.documentId}
          data-block-name={props.blockName}
          data-document-name={props.documentName}
        >
          {props.documentName ?? props.documentId}
        </span>
      }
    />
  );
}

export function DocumentMentionInner(props: DocumentMentionDecoratorProps) {
  const currentBlockId = useMaybeBlockId();
  const currentBlockName = useMaybeBlockName();

  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = lexicalWrapper?.editor;
  const selection = () => lexicalWrapper?.selection;

  const [isCollapsed, setIsCollapsed] = createSignal<boolean>(
    props.collapsed ?? false
  );

  const isCollapsable = createMemo(() => {
    return lexicalWrapper?.isInteractable() ?? false;
  });

  // Check if this is a recently created mention that we should show fallback for
  const isRecentMention = createMemo(() => {
    if (!props.createdAt) return false;
    const age = Date.now() - props.createdAt;
    return age < RECENT_MENTION_THRESHOLD_MS;
  });

  const showEmbedOption = createMemo(() => {
    if (!lexicalWrapper?.isInteractable()) return false;
    if (!lexicalWrapper?.editor.hasNode(DocumentCardNode)) return false;
    return true;
  });

  const isEmbeddable = createMemo(() => {
    if (!ENABLE_BLOCK_IN_BLOCK) return false;
    const blockName = verifyBlockName(props.blockName);
    return canNestBlock(resolveBlockAlias(blockName), currentBlockName);
  });

  const itemEntity = (): ItemEntity => {
    const previewType = blockNameToItemType(verifyBlockName(props.blockName));
    const baseEntity = {
      id: props.documentId,
      type: previewType,
    };
    if (
      previewType === 'channel' &&
      props.blockParams &&
      CHANNEL_PARAMS.message in props.blockParams
    ) {
      return {
        ...baseEntity,
        messageId: props.blockParams[CHANNEL_PARAMS.message],
      };
    }
    return baseEntity;
  };

  const [item] = useItemPreview(itemEntity);

  const isSelectedAsNode = createMemo(() => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  });

  const resolvedBlockName = createMemo(() => {
    const i = item();
    if (!i.loading && i.access === 'access') {
      return itemToBlockName(i) ?? props.blockName;
    }
    return props.blockName;
  });

  const open = createCallback((e: MouseEvent | KeyboardEvent | null) => {
    openDocument(
      resolvedBlockName(),
      props.documentId,
      props.blockParams,
      openInNewSplitForMention(e?.shiftKey, e != null)
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
      // Don't update to "Deleted" if this is a recent mention
      if (!isRecentMention()) {
        setTimeout(() => {
          editor?.dispatchCommand(UPDATE_DOCUMENT_NAME_COMMAND, {
            [props.documentId]: 'Deleted',
          });
        });
      }
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
    const i = item();
    if (
      !i.loading &&
      (i.access === 'access' ||
        shouldUseFallbackForRecentMention(i, isRecentMention()))
    ) {
      open(e);
    }
  });

  return (
    <HoverCard
      trigger={
        <span class="relative">
          <span
            class="w-full h-full py-0.5 cursor-default rounded-xs hover:bg-hover focus:bg-active"
            classList={{
              'bg-active text-ink': isSelectedAsNode(),
            }}
            style={{
              'user-select': 'inherit',
            }}
            {...navHandlers}
          >
            <Switch>
              <Match when={item()}>
                <InlinePreview
                  entity={itemEntity()}
                  blockName={verifyBlockName(props.blockName)}
                  blockParams={props.blockParams || {}}
                  theme={props.theme}
                  collapsed={isCollapsed()}
                  documentName={props.documentName}
                  createdAt={props.createdAt}
                  isRecentMention={isRecentMention}
                />
              </Match>
            </Switch>
          </span>
          <MentionTooltip show={isSelectedAsNode()} text="Open" />
        </span>
      }
      content={
        <PopupPreview
          mouseEnter={() => {}}
          mouseLeave={() => {}}
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
            name: (() => {
              const i = item();
              return shouldUseFallbackForRecentMention(i, isRecentMention())
                ? props.documentName
                : undefined;
            })(),
            type: verifyBlockName(props.blockName),
            params: props.blockParams ?? {},
            isOpenable: currentBlockId !== props.documentId,
          }}
          previewInfo={{
            isPreviewable: isEmbeddable(),
            showPreview: showEmbedOption(),
            handlePreviewToggle: convertToCard,
          }}
          useFallbackData={shouldUseFallbackForRecentMention(
            item(),
            isRecentMention()
          )}
        />
      }
    />
  );
}
