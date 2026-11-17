import { calendarMentionOpen } from '@app/features/calendar-view/mention-open-target';
import { openCalendarEventSplit } from '@app/features/calendar-view/open-calendar-event';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import {
  type DocumentPreviewContentProps,
  PopupPreview,
} from '@core/component/DocumentPreview';
import { DocumentPreviewSheet } from '@core/component/DocumentPreviewSheet';
import { HoverCard } from '@core/component/HoverCard';
import { useItemPreviewData } from '@core/component/ItemPreview';
import {
  itemToBlockName,
  resolveBlockAlias,
  verifyBlockName,
} from '@core/constant/allBlocks';
import { ENABLE_BLOCK_IN_BLOCK } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { canNestBlock } from '@core/orchestrator';
import { fireAndForget } from '@core/util/fireAndForget';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useNativeSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import type { ItemEntity } from '@queries/preview';
import { blockNameToItemType } from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
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
import { useMarkdownHost } from '../../context/MarkdownHostContext';
import { createLexicalDocumentMentionHost } from '../../decorator-host/lexical-document-mention';
import { autoRegister } from '../../plugins';
import { openDocument } from '../core/BlockLink';
import {
  createRecentMention,
  type DocumentMentionProps,
  InlinePreview,
  shouldUseFallbackForRecentMention,
} from './DocumentMention';
import { MentionTooltip } from './MentionTooltip';

export function DocumentMentionInner(props: DocumentMentionProps) {
  const currentBlockId = useMaybeBlockId();
  const currentBlockName = useMarkdownHost() ?? useMaybeBlockName();

  const lexicalWrapper = useContext(LexicalWrapperContext);
  const host = props.host ?? createLexicalDocumentMentionHost(lexicalWrapper);

  const [isCollapsed, setIsCollapsed] = createSignal<boolean>(
    props.collapsed ?? false
  );

  const isCollapsable = createMemo(() => {
    return host.isInteractable();
  });

  // Check if this is a recently created mention that we should show fallback for.
  // It stops being recent while mounted, so a chip for an event deleted in the
  // meantime then reads and opens as deleted without a remount.
  const isRecentMention = createRecentMention(props.createdAt);

  const showEmbedOption = createMemo(() => {
    return host.canEmbed();
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

  const previewData = useItemPreviewData(itemEntity, props.inlinePreview);
  const { item } = previewData;

  const isSelectedAsNode = createMemo(() => host.isSelected(props.key));

  const resolvedBlockName = createMemo(() => {
    const i = item();
    if (!i.loading && i.access === 'access') {
      // NOTE: this is a hack around invalid "unknown" fallback
      const resolved = itemToBlockName(i);
      if (resolved && resolved !== 'unknown') return resolved;
    }
    return props.blockName;
  });

  const [previewCardOpen, setPreviewCardOpen] = createSignal(false);
  const [previewTrigger, setPreviewTrigger] = createSignal<HTMLElement>();
  const [previewSheetOpen, setPreviewSheetOpen] = createSignal(false);

  const calendarOpen = createMemo(() =>
    verifyBlockName(props.blockName) === 'calendar'
      ? calendarMentionOpen(
          item(),
          props.documentId,
          props.blockParams?.occurrenceKey
        )
      : undefined
  );

  // A deleted or inaccessible item has nothing to open. A just-created
  // mention can briefly preview as missing; it still opens rather than
  // reading as deleted.
  const isUnavailable = () => {
    const i = item();
    if (i.loading) return false;
    return (
      i.access === 'no_access' ||
      (i.access === 'does_not_exist' && !isRecentMention())
    );
  };
  const showsPreviewOnOpen = () =>
    calendarOpen()?.kind === 'read_only' || isUnavailable();

  const open = createCallback((e: MouseEvent | KeyboardEvent | null) => {
    // The calendar is a singleton block: open it aimed at the viewer's own
    // copy of the meeting. A meeting shared through the channel but absent
    // from the viewer's calendars, like any item that is gone or hidden from
    // the viewer, has nothing to open, so its preview card is shown instead,
    // as a sheet on touch devices.
    if (showsPreviewOnOpen()) {
      if (isTouchDevice()) setPreviewSheetOpen(true);
      else setPreviewCardOpen(true);
      return;
    }
    const target = calendarOpen();
    if (target?.kind === 'calendar') {
      fireAndForget(
        (async () => {
          const opened = await openCalendarEventSplit({
            ...target.target,
            openInNewSplit: openInNewSplitForMention(e?.shiftKey, e != null),
          });
          if (opened) props.onOpened?.();
        })(),
        'document-mention'
      );
      return;
    }
    const result = openDocument(
      resolvedBlockName(),
      props.documentId,
      props.blockParams,
      openInNewSplitForMention(e?.shiftKey, e != null)
    );
    if (result && result.status !== 'unavailable') props.onOpened?.();
  });

  const releaseEnter = host.registerNormalEnter((event) => {
    if (isSelectedAsNode()) {
      open(event);
      return true;
    }
    return false;
  });
  if (releaseEnter) autoRegister(releaseEnter);

  // The internal model of the LexicalNode needs the fresh state of the document
  // name for serialization.
  createEffect(() => {
    const i = item();
    if (i.loading) return;
    if (i.access === 'access') {
      setTimeout(() => {
        host.updateDocumentNames({
          [props.documentId]: i.name,
        });
      });
    } else if (i.access === 'no_access') {
      setTimeout(() => {
        host.updateDocumentNames({
          [props.documentId]: 'No Access',
        });
      });
    } else if (i.access === 'does_not_exist') {
      // Don't update to "Deleted" if this is a recent mention
      if (!isRecentMention()) {
        setTimeout(() => {
          host.updateDocumentNames({
            [props.documentId]: 'Deleted',
          });
        });
      }
    }
  });

  const deleteMention = () => host.remove(props.key);
  const convertToText = (link: string) => host.convertToText(props.key, link);
  const convertToCard = () => host.convertToCard(props.key);

  // Native listeners: inside an editable editor (the agent and chat
  // composers) the shell stops click propagation before Solid's delegated
  // handlers run, which left the chip inert there.
  const openIfReady = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const i = item();
    if (
      isUnavailable() ||
      (!i.loading &&
        (i.access === 'access' ||
          shouldUseFallbackForRecentMention(i, isRecentMention())))
    ) {
      open(e);
    }
  };
  const navHandlers =
    useNativeSplitNavigationHandler<HTMLSpanElement>(openIfReady);
  // Outside an editor (a list row or a dialog) the hover card trigger opens
  // the reference itself.
  const inEditor = props.host !== undefined || lexicalWrapper?.editor != null;

  // One set of preview props for the hover card and the touch sheet.
  const previewContentProps: DocumentPreviewContentProps = {
    onOpened: () => props.onOpened?.(),
    get delete() {
      return host.isEditable() ? deleteMention : undefined;
    },
    get convertToText() {
      return host.isEditable() ? convertToText : undefined;
    },
    get collapseInfo() {
      return {
        isCollapsed: isCollapsed(),
        isCollapsable: isCollapsable(),
        handleCollapse: () => {
          const state = !isCollapsed();
          setIsCollapsed(state);
          host.setCollapsed(props.key, state);
        },
      };
    },
    get documentInfo() {
      return {
        id: props.documentId,
        name: shouldUseFallbackForRecentMention(item(), isRecentMention())
          ? props.documentName
          : undefined,
        type: verifyBlockName(props.blockName),
        params: props.blockParams ?? {},
        isOpenable: currentBlockId !== props.documentId,
      };
    },
    get previewInfo() {
      return {
        isPreviewable: isEmbeddable(),
        showPreview: showEmbedOption(),
        handlePreviewToggle: convertToCard,
      };
    },
    get useFallbackData() {
      return shouldUseFallbackForRecentMention(item(), isRecentMention());
    },
  };

  return (
    <>
      {/* The sheet stays up once open, so a share the viewer adds or is
          invited to meanwhile shows it is on their calendar in place. */}
      <Show
        when={isTouchDevice() && (showsPreviewOnOpen() || previewSheetOpen())}
      >
        <DocumentPreviewSheet
          open={previewSheetOpen()}
          onOpenChange={setPreviewSheetOpen}
          {...previewContentProps}
        />
      </Show>
      <HoverCard
        open={previewCardOpen()}
        onOpenChange={setPreviewCardOpen}
        keepOpenOnTriggerPress={showsPreviewOnOpen()}
        triggerRef={setPreviewTrigger}
        triggerOnClick={inEditor ? undefined : openIfReady}
        // A modal makes previews outside its content inert.
        portalMount={
          previewTrigger()?.closest<HTMLElement>('[role="dialog"]') ?? undefined
        }
        triggerOnKeyDown={
          inEditor
            ? undefined
            : (event) => {
                if (event.key === 'Enter') openIfReady(event);
              }
        }
        triggerClass={
          inEditor ? undefined : 'rounded-xs focus-visible:bg-active'
        }
        trigger={
          <span class="relative">
            <span
              class="size-full py-[0.125em] cursor-default rounded-xs hover:bg-hover focus:bg-active"
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
                    previewData={previewData}
                    entity={itemEntity()}
                    blockName={verifyBlockName(props.blockName)}
                    blockParams={props.blockParams || {}}
                    theme={props.theme}
                    collapsed={isCollapsed()}
                    documentName={props.documentName}
                    createdAt={props.createdAt}
                    isRecentMention={isRecentMention}
                    onOpened={props.onOpened}
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
            {...previewContentProps}
          />
        }
      />
    </>
  );
}
