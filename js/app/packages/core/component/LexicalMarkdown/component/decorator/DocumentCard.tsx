import {
  type PreviewState,
  useBlockOwner,
  useMaybeBlockName,
} from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { IconButton } from '@core/component/IconButton';
import {
  DropdownMenuContent,
  MenuItem,
  MenuSeparator,
} from '@core/component/Menu';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import { verifyBlockName } from '@core/constant/allBlocks';
import { ENABLE_BLOCK_IN_BLOCK } from '@core/constant/featureFlags';
import { canNestBlock, createBlockInstance } from '@core/orchestrator';
import {
  isAccessiblePreviewItem,
  isLoadingPreviewItem,
  type PreviewChannelAccess,
  type PreviewDocumentAccess,
  type PreviewItemAccess,
  type PreviewProjectAccess,
  useItemPreview,
} from '@core/signal/preview';
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
import type { Component } from 'solid-js';
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  Match,
  onCleanup,
  runWithOwner,
  Show,
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

false && floatWithElement;

const stringifyPreviewBox = ([width, height]: PreviewBox): [string, string] => {
  const widthStr = typeof width === 'string' ? width : `${width}px`;
  const heightStr = typeof height === 'string' ? height : `${height}px`;
  return [widthStr, heightStr];
};

export function DocumentCard(props: DocumentCardDecoratorProps) {
  const wrapper = useContext(LexicalWrapperContext);
  const editor = () => wrapper?.editor;
  const selection = () => wrapper?.selection;

  const currentBlockName = useMaybeBlockName();

  const previewType = () =>
    blockNameToItemType(verifyBlockName(props.blockName));

  const [item] = useItemPreview({
    id: props.documentId,
    type: previewType(),
  });

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

  const previewData = createMemo(() => {
    if (props.previewData?.view) {
      return { view: props.previewData.view };
    }
    return {};
  });

  const isPreviewable = createMemo(() => {
    if (!ENABLE_BLOCK_IN_BLOCK) return false;
    const i = item();
    if (!i) return false;
    if (isLoadingPreviewItem(i)) return false;
    if (!isAccessiblePreviewItem(i)) return false;
    const blockName = verifyBlockName(props.blockName);
    return canNestBlock(blockName, currentBlockName);
  });

  const [previewComponent, setPreviewComponent] = createSignal<
    Component | undefined
  >(undefined);

  const blockOwner = useBlockOwner();

  createEffect(() => {
    if (!editor) return;
    if (!isPreviewable()) return;
    if (hasLoadedPreview()) return;

    if (props.previewComponent) {
      setHasLoadedPreview(true);
      setPreviewComponent(() => props.previewComponent);
      return;
    }

    let nodeId = editor()?.read(() => {
      const node = $getNodeByKey(props.key);
      if (!node) return;
      return $getId(node);
    });
    if (!nodeId) {
      console.error('Unable to find node id for document card');
      return;
    }

    const i = item();
    if (!i || i.loading) {
      return;
    }
    const documentId = i.id;

    const preview = createBlockInstance(
      verifyBlockName(props.blockName),
      documentId,
      {
        nested: {
          parentContext: previewContext(),
          initArgs: previewData(),
        },
      }
    );

    const noDispose = runWithOwner(blockOwner, () => {
      let disposeOnBlockUnmount: () => void = () => {};
      onCleanup(() => {
        disposeOnBlockUnmount();
      });

      return createRoot((dispose) => {
        if (!preview || !nodeId) return;

        const element = createMemo(() => preview.element());

        setDocumentCardPreviewComponent(nodeId, element, dispose);
        disposeOnBlockUnmount = () => unsetDocumentCardPreviewCache(nodeId);
        return element;
      }, blockOwner);
    });

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
    item:
      | PreviewItemAccess
      | PreviewProjectAccess
      | PreviewDocumentAccess
      | PreviewChannelAccess;
    blockName: string;
  }) => {
    return (
      <div class="p-2">
        <div class="flex center gap-2 items-center">
          <div class="flex-shrink-0">
            <Show
              when={props.item.type === 'channel'}
              fallback={
                <EntityIcon
                  targetType={
                    props.item.type === 'document'
                      ? props.item.fileType
                      : props.item.type
                  }
                  size="sm"
                />
              }
            >
              <EntityIcon
                size="sm"
                targetType={
                  props.item.channelType === 'direct_message'
                    ? 'directMessage'
                    : props.item.channelType === 'organization'
                      ? 'company'
                      : 'channel'
                }
              />
            </Show>
          </div>
          <div class="text-sm font-semibold truncate grow-1">
            <BlockLink id={props.item.id} blockOrFileName={props.blockName}>
              <span class="hover:underline">{props.item.name}</span>
            </BlockLink>
          </div>
          <DropdownMenu open={dropdownOpen()} onOpenChange={setDropdownOpen}>
            <DropdownMenu.Trigger>
              <IconButton theme="clear" icon={DotsThree} tabIndex={-1} />
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
              <div class="flex items-center text-xs text-ink-muted">
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
      class="relative my-2 rounded-lg border border-edge no-select-children select-none overflow-hidden flex flex-col"
      classList={{
        'bg-active outline-edge outline-4': isSelectedAsNode(),
        'resize-y shrink-0 min-h-[100px]': isPreviewable(),
      }}
      style={{
        height: isPreviewable() ? previewBoxHeight : 'auto',
      }}
      onClick={(e) => {
        e.preventDefault();
        clickCardHandler();
      }}
    >
      <Switch>
        <Match when={matches(item(), isLoadingPreviewItem)}>
          <div class="flex items-center justify-center p-4 text-ink-muted">
            <LoadingSpinner class="w-6 h-6 animate-spin" />
          </div>
        </Match>

        <Match when={matches(item(), isAccessiblePreviewItem)}>
          {(item) => (
            <>
              <DocumentInfo item={item()} blockName={props.blockName} />
              <Show when={isPreviewable()}>
                <div class="relative grow overflow-y-scroll">
                  <Show when={previewComponent()}>
                    <Dynamic component={previewComponent()} />
                  </Show>
                </div>
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}
