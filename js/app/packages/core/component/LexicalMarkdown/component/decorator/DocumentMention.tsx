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
import { useItemPreviewData } from '@core/component/ItemPreview';
import { resolveBlockAlias, verifyBlockName } from '@core/constant/allBlocks';
import { ENABLE_BLOCK_IN_BLOCK } from '@core/constant/featureFlags';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import { canNestBlock } from '@core/orchestrator';
import {
  isAccessiblePreviewItem,
  type PreviewItemNoAccess,
  type ItemEntity,
} from '@queries/preview';
import { matches } from '@core/util/match';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
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
import { HoverCard } from '@core/component/HoverCard';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { autoRegister, UPDATE_DOCUMENT_NAME_COMMAND } from '../../plugins';
import { openDocument } from '../core/BlockLink';
import { MentionTooltip } from './MentionTooltip';

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

function InlinePreview(props: {
  entity: ItemEntity;
  blockName: BlockName | BlockAlias;
  blockParams: Record<string, string>;
  theme?: EditorThemeClasses;
  collapsed?: boolean;
}) {
  const { item, ItemEntityIcon } = useItemPreviewData(() => props.entity);

  return (
    <Switch>
      <Match when={item().loading}>
        <Loading />
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
  return (
    <Suspense>
      <DocumentMentionInner {...props} />
    </Suspense>
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
      CHANNEL_URL_PARAMS.message in props.blockParams
    ) {
      return {
        ...baseEntity,
        messageId: props.blockParams[CHANNEL_URL_PARAMS.message],
      };
    }
    return baseEntity;
  };

  const { item } = useItemPreviewData(itemEntity);

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
    <HoverCard
      trigger={
        <span class="relative">
          <span
            class="w-full h-full py-0.5 cursor-default rounded-xs hover:bg-hover focus:bg-active"
            classList={{
              'bg-active text-ink bracket bracket-offset-2': isSelectedAsNode(),
            }}
            style={{
              'user-select': 'inherit',
            }}
            {...navHandlers}
          >
            <Switch>
              <Match when={item().loading}>
                <Loading collapsed={isCollapsed()} />
              </Match>
              <Match when={item()}>
                <InlinePreview
                  entity={itemEntity()}
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
      }
    />
  );
}
