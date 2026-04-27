import {
  type PreviewState,
  useBlockOwner,
  useMaybeBlockName,
} from '@core/block';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import {
  DropdownMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/Menu';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import { resolveBlockAlias, verifyBlockName } from '@core/constant/allBlocks';
import { ENABLE_BLOCK_IN_BLOCK } from '@core/constant/featureFlags';
import { canNestBlock, createBlockInstance } from '@core/orchestrator';
import {
  isAccessiblePreviewItem,
  type AccessiblePreviewItem,
} from '@queries/preview';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { matches } from '@core/util/match';
import TrashSimple from '@icon/duotone/trash-simple-duotone.svg';
import Minimize from '@icon/regular/arrows-in.svg';
import Clipboard from '@icon/regular/clipboard.svg';
import ClockIcon from '@icon/regular/clock.svg';
import DotsThree from '@icon/regular/list.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import UserIcon from '@icon/regular/user.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
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
} from '@lexical-core';
import { blockNameToItemType } from '@service-storage/client';
import { debounce } from '@solid-primitives/scheduled';
import {
  $addUpdateTag,
  $createNodeSelection,
  $getNodeByKey,
  $setSelection,
} from 'lexical';
import type { Component, JSX } from 'solid-js';
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
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { floatWithElement } from '../../directive/floatWithElement';
import { UPDATE_DOCUMENT_NAME_COMMAND } from '../../plugins';
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

  const currentBlockName = useMaybeBlockName();

  const previewType = () =>
    blockNameToItemType(verifyBlockName(props.blockName));

  const { item, ItemEntityIcon } = useItemPreviewData(() => ({
    id: props.documentId,
    type: previewType(),
  }));

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
    Component | undefined
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
      getElement = () =>
        ChannelMessageThreadCard({
          channelId: props.documentId,
          messageId: msgId!,
        });
    }

    const noDispose = registerPreviewElement(nodeId, getElement);

    setHasLoadedPreview(true);
    setPreviewComponent(() => noDispose);
  });

  const deleteCard = () => {
    editor()?.update(() => {
      const node = $getNodeByKey(props.key);
      if (!$isDocumentCardNode(node)) return false;
      node.remove();
      return true;
    });
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
  }) => {
    return (
      <div class="p-2">
        <div class="flex center gap-2 items-center h-4">
          <div class="shrink-0">
            <ItemEntityIcon size="sm" />
          </div>
          <div class="text-sm font-semibold truncate grow">
            <BlockLink id={props.item.id} blockOrFileName={props.blockName}>
              <span class="hover:underline">{props.item.name}</span>
            </BlockLink>
          </div>
          <DropdownMenu open={dropdownOpen()} onOpenChange={setDropdownOpen}>
            <DropdownMenu.Trigger>
              <DeprecatedIconButton
                theme="clear"
                icon={DotsThree}
                tabIndex={-1}
              />
            </DropdownMenu.Trigger>
            <ScopedPortal scope="block">
              <DropdownMenuContent class="z-action-menu">
                <MenuItem
                  onClick={convertToMention}
                  icon={Minimize}
                  text="Convert to Inline Mention"
                />
                <MenuItem
                  onClick={handleCopy}
                  icon={Clipboard}
                  text="Copy Link"
                />
                <MenuSeparator />
                <MenuItem
                  onClick={deleteCard}
                  icon={TrashSimple}
                  text="Delete"
                />
              </DropdownMenuContent>
            </ScopedPortal>
          </DropdownMenu>
        </div>
        <div class="flex items-center justify-between mt-1">
          <Show when={props.item.owner}>
            {(owner) => (
              <div class="flex items-center text-xs text-ink-muted">
                <UserIcon class="w-3 h-3 mr-1" />
                <span class="truncate">{owner().replace('macro|', '')}</span>
              </div>
            )}
          </Show>
          <Show when={props.item.updatedAt}>
            {(updatedAt) => (
              <div class="flex items-center text-xs text-ink-muted/60 mr-2">
                <ClockIcon class="w-3 h-3 mr-1" />
                <span>{formatDate(updatedAt())}</span>
              </div>
            )}
          </Show>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={(el) => {
        setContainerRef(el);
        setPreviewBoxRef(el);
      }}
      contentEditable={false}
      class="relative my-2 rounded border border-edge-muted no-select-children select-none overflow-hidden flex flex-col"
      classList={{
        'bg-active outline-edge outline-4':
          isSelectedAsNode() && !channelMessageId(),
        'resize-y shrink-0 min-h-[100px]': isPreviewable(),
      }}
      style={{
        height: isPreviewable() ? previewBoxHeight : 'auto',
      }}
      onClick={(e) => {
        if (channelMessageId()) return;
        e.preventDefault();
        clickCardHandler();
      }}
    >
      <Switch>
        <Match when={item().loading}>
          <div class="flex items-center justify-center p-4 text-ink-muted">
            <LoadingSpinner class="w-6 h-6 animate-spin" />
          </div>
        </Match>

        <Match when={matches(item(), isAccessiblePreviewItem)}>
          {(item) => (
            <>
              <DocumentInfo item={item()} blockName={props.blockName} />
              <Show when={previewComponent()}>
                <Show
                  when={isPreviewable()}
                  fallback={<Dynamic component={previewComponent()} />}
                >
                  <div class="relative grow overflow-y-scroll">
                    <Dynamic component={previewComponent()} />
                  </div>
                </Show>
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}
