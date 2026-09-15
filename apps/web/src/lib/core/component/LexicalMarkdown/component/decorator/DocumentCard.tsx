import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import {
  isInBlock,
  type PreviewState,
  useBlockOwner,
  useMaybeBlockName,
} from '@core/block';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { toast } from '@core/component/Toast/Toast';
import { resolveBlockAlias, verifyBlockName } from '@core/constant/allBlocks';
import { ENABLE_BLOCK_IN_BLOCK } from '@core/constant/featureFlags';
import { canNestBlock, createBlockInstance } from '@core/orchestrator';
import { blockElementSignal } from '@core/signal/blockElement';
import { getDisplayName, tryMacroId } from '@core/user';
import { matches } from '@core/util/match';
import DotsThree from '@icon/dots-three-large.svg';
import {
  $convertCardToMention,
  $getId,
  $isDocumentCardNode,
  DEFAULT_PREVIEW_BOX,
  type DocumentCardDecoratorProps,
  HISTORY_MERGE_TAG,
  type PreviewBox,
  setDocumentCardPreviewComponent,
  unsetDocumentCardPreviewCache,
} from '@macro-inc/lexical-core';
import Minimize from '@phosphor/arrows-in.svg';
import Clipboard from '@phosphor/clipboard.svg';
import LoadingSpinner from '@phosphor/spinner.svg';
import TrashSimple from '@phosphor/trash-simple.svg';
import {
  type AccessiblePreviewItem,
  isAccessiblePreviewItem,
} from '@queries/preview';
import { blockNameToItemType } from '@service-storage/client';
import { debounce } from '@solid-primitives/scheduled';
import { Card, cn, Dropdown, Item } from '@ui';
import {
  $addUpdateTag,
  $createNodeSelection,
  $getNodeByKey,
  $setSelection,
} from 'lexical';
import type { JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  Match,
  onCleanup,
  runWithOwner,
  Show,
  Suspense,
  Switch,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { formatDate } from '../../../../util/date';
import {
  TaskPropertiesPreview,
  TaskPropertiesPreviewProvider,
} from '../../../TaskPropertiesPreview';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { floatWithElement } from '../../directive/floatWithElement';
import { UPDATE_DOCUMENT_NAME_COMMAND } from '../../plugins';
import { removeNodeAndRestoreSelection } from '../../plugins/shared/removeNodeAndRestoreSelection';
import { dispatchInternalLayoutShift } from '../../plugins/shared/utils';
import { BlockLink } from '../core/BlockLink';
import { ChannelMessageThreadCard } from './ChannelMessageThreadCard';

false && floatWithElement;

const stringifyPreviewBox = ([width, height]: PreviewBox): [string, string] => {
  const widthStr = typeof width === 'string' ? width : `${width}px`;
  const heightStr = typeof height === 'string' ? height : `${height}px`;
  return [widthStr, heightStr];
};

export function DocumentCard(props: DocumentCardDecoratorProps) {
  return (
    <Suspense>
      <DocumentCardInner {...props} />
    </Suspense>
  );
}

function DocumentCardInner(props: DocumentCardDecoratorProps) {
  const wrapper = useContext(LexicalWrapperContext);
  const editor = () => wrapper?.editor;
  const selection = () => wrapper?.selection;
  const portalMount = isInBlock() ? blockElementSignal.get : () => undefined;

  const currentBlockName = useMaybeBlockName();

  const previewType = () =>
    blockNameToItemType(verifyBlockName(props.blockName));

  const { item, ItemEntityIcon, documentProperties } = useItemPreviewData(
    () => ({
      id: props.documentId,
      type: previewType(),
    })
  );

  const channelMessageId = () => {
    if (previewType() !== 'channel') return undefined;
    const messageId = props.blockParams?.[CHANNEL_PARAMS.message];
    const threadId = props.blockParams?.[CHANNEL_PARAMS.thread];
    return threadId ? threadId : messageId;
  };

  const [hasLoadedPreview, setHasLoadedPreview] = createSignal(false);

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const clickCardHandler = () => {
    const e = editor();
    if (!e) return;
    if (!e.isEditable()) return;
    if (isSelectedAsNode()) return;
    e.update(() => {
      const sel = $createNodeSelection();
      sel.add(props.key);
      $setSelection(sel);
    });
  };

  const [dropdownOpen, setDropdownOpen] = createSignal(false);
  const [, setContainerRef] = createSignal<HTMLDivElement>();

  const resizePreview = (height: string) => {
    editor()?.update(() => {
      $addUpdateTag(HISTORY_MERGE_TAG);
      const node = $getNodeByKey(props.key);
      if (!$isDocumentCardNode(node)) return;
      const [width] = node.getPreviewBox();
      node.setPreviewBox([width, height]);
      dispatchInternalLayoutShift(editor()!);
    });
  };

  const previewContext = createMemo<
    Partial<PreviewState & { showDraftSelectorButton: boolean }>
  >(() => {
    return {
      onChangePreviewHeight: (h: string) => resizePreview(h),
      showDraftSelectorButton: true,
      canvas: {
        onLocationChange: (location) => {
          if (!editor()) return;
          editor()?.update(() => {
            $addUpdateTag(HISTORY_MERGE_TAG);
            const node = $getNodeByKey(props.key);
            if (!$isDocumentCardNode(node)) return;
            node.setPreviewData({
              view: location,
            });
          });
        },
      },
    };
  });

  const previewData = () => {
    if (props.previewData?.view) {
      return { view: props.previewData.view };
    }
    return {};
  };

  const isPreviewable = () => {
    if (!ENABLE_BLOCK_IN_BLOCK) return false;
    const i = item();
    if (!i) return false;
    if (i.loading) return false;
    if (!isAccessiblePreviewItem(i)) return false;
    const blockName = resolveBlockAlias(verifyBlockName(props.blockName));
    return canNestBlock(blockName, currentBlockName);
  };

  const [previewComponent, setPreviewComponent] = createSignal<
    NonNullable<DocumentCardDecoratorProps['previewComponent']> | undefined
  >(undefined);

  const blockOwner = useBlockOwner();

  const registerPreviewElement = (
    nodeId: string,
    getElement: () => JSX.Element
  ) =>
    runWithOwner(blockOwner, () => {
      let disposeOnBlockUnmount: () => void = () => {};
      onCleanup(() => disposeOnBlockUnmount());

      return createRoot((dispose) => {
        const element = createMemo(getElement);
        setDocumentCardPreviewComponent(nodeId, element, dispose);
        disposeOnBlockUnmount = () => unsetDocumentCardPreviewCache(nodeId);
        return element;
      }, blockOwner);
    });

  createEffect(() => {
    if (hasLoadedPreview()) return;

    if (props.previewComponent) {
      setHasLoadedPreview(true);
      setPreviewComponent(() => props.previewComponent);
      return;
    }

    const msgId = channelMessageId();
    const shouldCreateBlockPreview = !msgId && isPreviewable();

    if (!msgId && !shouldCreateBlockPreview) return;

    const nodeId = editor()?.read(() => {
      const node = $getNodeByKey(props.key);
      if (!node) return;
      return $getId(node);
    });
    if (!nodeId) return;

    let getElement: () => JSX.Element;

    if (shouldCreateBlockPreview) {
      const i = item();
      if (!i || i.loading) return;

      const preview = createBlockInstance(
        resolveBlockAlias(verifyBlockName(props.blockName)),
        i.id,
        {
          params: previewData(),
          nested: { parentContext: previewContext() },
        }
      );
      if (!preview) return;

      getElement = () => preview.element();
    } else {
      getElement = () => (
        <div class="p-2">
          <ChannelMessageThreadCard
            channelId={props.documentId}
            messageId={msgId!}
          />
        </div>
      );
    }

    const noDispose = registerPreviewElement(nodeId, getElement);

    setHasLoadedPreview(true);
    setPreviewComponent(() => noDispose);
  });

  const deleteCard = () => {
    const currentEditor = editor();
    if (!currentEditor) return;
    removeNodeAndRestoreSelection(
      currentEditor,
      props.key,
      $isDocumentCardNode
    );
  };

  const convertToMention = () => {
    editor()?.update(() => {
      const node = $getNodeByKey(props.key);
      if (!$isDocumentCardNode(node)) return false;
      $convertCardToMention(node);
      return true;
    });
  };

  const handleCopy = () => {
    try {
      let hostname = window.location.hostname.replace('www.', '').toLowerCase();
      if (hostname === 'localhost') {
        hostname = 'dev.macro.com';
      }
      let link = `https://${hostname}/app/${props.blockName}/${props.documentId}`;

      if (props.blockParams && Object.keys(props.blockParams).length > 0) {
        const queryParams = new URLSearchParams(props.blockParams).toString();
        link += `?${queryParams}`;
      }
      navigator.clipboard.writeText(link);
      toast.success('Copied document link to clipboard');
    } catch (e) {
      console.error(e);
    }
  };

  createEffect(() => {
    const i = item();
    if (!i || i.loading) return;
    if (i.access === 'access') {
      editor()?.dispatchCommand(UPDATE_DOCUMENT_NAME_COMMAND, {
        [props.documentId]: i.name,
      });
    } else if (i.access === 'no_access') {
      editor()?.dispatchCommand(UPDATE_DOCUMENT_NAME_COMMAND, {
        [props.documentId]: 'No Access',
      });
    } else if (i.access === 'does_not_exist') {
      editor()?.dispatchCommand(UPDATE_DOCUMENT_NAME_COMMAND, {
        [props.documentId]: 'Deleted',
      });
    }
  });

  const [_, previewBoxHeight] = stringifyPreviewBox(
    props.previewBox || DEFAULT_PREVIEW_BOX
  );

  const [previewBoxRef, setPreviewBoxRef] = createSignal<HTMLDivElement | null>(
    null
  );

  const debouncedUpdatePreviewBox = debounce((size: [number, number]) => {
    editor()?.update(() => {
      const node = $getNodeByKey(props.key);
      if (!$isDocumentCardNode(node)) return false;
      node.setPreviewBox(size);
      return true;
    });
  }, 1000);

  // create mutation observer to update preview box
  createEffect(() => {
    const el = previewBoxRef();
    if (!el) return;
    const observer = new MutationObserver((_mutations) => {
      const { width, height } = el.getBoundingClientRect();
      if (editor()) {
        dispatchInternalLayoutShift(editor()!);
      }
      debouncedUpdatePreviewBox([width, height]);
    });
    observer.observe(el, { attributes: true });
    onCleanup(() => {
      observer.disconnect();
    });
  });

  const DocumentInfo = (props: {
    item: AccessiblePreviewItem;
    blockName: string;
    blockParams: DocumentCardDecoratorProps['blockParams'];
  }) => {
    return (
      <Card.Header class="shrink-0 py-2.5">
        <Item class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2 border-0 p-0">
          <Item.Icon class="col-start-1 row-start-1">
            <Show
              when={props.blockName === 'task'}
              fallback={<ItemEntityIcon size="xs" />}
            >
              <Suspense
                fallback={
                  <LoadingSpinner class="size-4 animate-spin text-ink-muted" />
                }
              >
                <TaskPropertiesPreview
                  taskId={props.item.id}
                  taskName={props.item.name}
                  previewProperties={documentProperties()}
                  mode="status"
                />
              </Suspense>
            </Show>
          </Item.Icon>
          <Item.Content class="col-start-2 row-start-1">
            <Item.Title>
              <BlockLink
                id={props.item.id}
                blockOrFileName={props.blockName}
                params={props.blockParams}
              >
                <span
                  role="link"
                  tabIndex={0}
                  class="wrap-anywhere rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.click();
                  }}
                >
                  {props.item.name}
                </span>
              </BlockLink>
            </Item.Title>
            <Show when={props.item.owner || props.item.updatedAt}>
              <Item.Description class="text-left wrap-anywhere">
                <Show when={props.item.owner}>
                  {(owner) =>
                    getDisplayName(tryMacroId(owner())) ||
                    owner().replace('macro|', '')
                  }
                </Show>
                <Show when={props.item.owner && props.item.updatedAt}>
                  {' - '}
                </Show>
                <Show when={props.item.updatedAt}>
                  {(updatedAt) => formatDate(updatedAt())}
                </Show>
              </Item.Description>
            </Show>
          </Item.Content>
          <Item.Actions class="col-start-3 row-start-1 h-5">
            <Dropdown open={dropdownOpen()} onOpenChange={setDropdownOpen}>
              <Dropdown.Trigger
                size="icon-sm"
                variant="ghost"
                aria-label="Document card actions"
              >
                <DotsThree />
              </Dropdown.Trigger>
              <Dropdown.Content mount={portalMount()}>
                <Dropdown.Group>
                  <Dropdown.Item onSelect={convertToMention}>
                    <Minimize class="size-4 shrink-0" />
                    <span class="flex-1 truncate">
                      Convert to Inline Mention
                    </span>
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={handleCopy}>
                    <Clipboard class="size-4 shrink-0" />
                    <span class="flex-1 truncate">Copy Link</span>
                  </Dropdown.Item>
                </Dropdown.Group>
                <Dropdown.Group>
                  <Dropdown.Item onSelect={deleteCard}>
                    <TrashSimple class="size-4 shrink-0" />
                    <span class="flex-1 truncate">Delete</span>
                  </Dropdown.Item>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </Item.Actions>
        </Item>
      </Card.Header>
    );
  };

  return (
    <Card
      variant="filled"
      depth={2}
      ref={(el) => {
        setContainerRef(el);
        setPreviewBoxRef(el);
      }}
      contentEditable={false}
      class={cn(
        'my-2 rounded-xl no-select-children select-none overflow-hidden',
        isSelectedAsNode() &&
          !channelMessageId() &&
          'border-[color-mix(in_oklch,var(--color-edge)_80%,var(--color-ink))] ring-2 ring-edge-muted',
        isPreviewable() && 'resize-y shrink-0 min-h-80'
      )}
      style={{
        height: isPreviewable() ? previewBoxHeight : 'auto',
      }}
      onClick={(e) => {
        if (channelMessageId()) return;
        // Controls and embedded editors own their clicks and native defaults.
        if (
          e.target instanceof Element &&
          e.target.closest(
            'a, button, input, textarea, select, [role="link"], [role="button"], [role="combobox"], [data-document-card-controls]'
          )
        )
          return;
        e.preventDefault();
        clickCardHandler();
      }}
    >
      <Switch>
        <Match when={item().loading}>
          <div class="flex items-center justify-center p-4 text-ink-muted">
            <LoadingSpinner class="size-6 animate-spin" />
          </div>
        </Match>
        <Match when={matches(item(), isAccessiblePreviewItem)}>
          {(item) => (
            <TaskPropertiesPreviewProvider
              taskId={props.blockName === 'task' ? item().id : undefined}
              previewProperties={documentProperties()}
            >
              <DocumentInfo
                item={item()}
                blockName={props.blockName}
                blockParams={props.blockParams}
              />
              <Show when={props.blockName === 'task'}>
                <Card.Body
                  class="shrink-0 pt-2 pl-9 [&>div]:px-0 [&>div]:pb-0"
                  data-document-card-controls
                >
                  <Suspense fallback={<div class="w-full bg-active h-4 m-2" />}>
                    <TaskPropertiesPreview
                      taskId={item().id}
                      previewProperties={documentProperties()}
                      mode="details"
                    />
                  </Suspense>
                </Card.Body>
              </Show>
              <Show when={previewComponent()}>
                <Card.Body
                  class={cn(
                    'mx-3 mt-2 mb-3 p-0',
                    isPreviewable() && 'flex min-h-0 flex-1'
                  )}
                  data-document-card-controls
                >
                  <Card
                    variant="filled"
                    offset={1}
                    class={cn(
                      'w-full overflow-hidden rounded-lg',
                      isPreviewable() && 'min-h-0 flex-1'
                    )}
                  >
                    <div
                      class={cn(
                        'relative min-w-0',
                        isPreviewable() && 'min-h-0 flex-1 overflow-y-auto'
                      )}
                    >
                      <Dynamic component={previewComponent()} {...props} />
                    </div>
                  </Card>
                </Card.Body>
              </Show>
            </TaskPropertiesPreviewProvider>
          )}
        </Match>
      </Switch>
    </Card>
  );
}
