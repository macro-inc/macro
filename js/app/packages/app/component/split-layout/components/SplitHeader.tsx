import { openEntityInSplitFromUnifiedList } from '@app/component/next-soup/utils';
import { isListViewID } from '@app/constants/list-views';
import type { BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import type { EntityDragEvent } from '@entity';
import CollapseIcon from '@phosphor/arrows-in.svg';
import ExpandIcon from '@phosphor/arrows-out.svg';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import CloseIcon from '@phosphor/x.svg';
import { mergeRefs } from '@solid-primitives/refs';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { Button, cn } from '@ui';
import {
  createMemo,
  type ParentProps,
  type Setter,
  Show,
  useContext,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { SplitLayoutContext, SplitPanelContext } from '../context';
import type { SplitContent } from '../layoutManager';
import { canSpotlight } from '../utils/canSpotlight';

function getEntitySplitContent(data: EntityDragEvent['draggable']['data']):
  | {
      type: SplitContent['type'];
      id: string;
    }
  | undefined {
  if (data.type === 'document') {
    return {
      type: fileTypeToBlockName(data.subType?.type ?? data.fileType) as
        | BlockName
        | 'unknown',
      id: data.id,
    };
  }

  if (data.type === 'channel_message') {
    return { type: 'channel', id: data.channelId };
  }

  if (data.type === 'foreign') return undefined;

  // CRM entity types map to their dedicated blocks (entity type !== block name).
  if (data.type === 'crm_company') return { type: 'company', id: data.id };
  if (data.type === 'crm_contact') return { type: 'contact', id: data.id };

  return { type: data.type, id: data.id };
}

function SplitBackButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return null;
  return (
    <Button
      class="p-1 rounded-lg"
      label="Go Back"
      hotkey={TOKENS.split.go.back}
      disabled={!context.handle.canGoBack()}
      onClick={context.handle.goBack}
    >
      <CaretLeft class="h-4" />
    </Button>
  );
}

function SplitForwardButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <Button
      label="Go Forward"
      hotkey={TOKENS.split.go.forward}
      disabled={!context.handle.canGoForward()}
      onClick={context.handle.goForward}
      class={cn(
        'p-1 rounded-lg',
        isMobile() && !context.handle.canGoForward() && 'hidden'
      )}
    >
      <CaretRight class="h-4" />
    </Button>
  );
}

function _SplitSpotlightButton() {
  const context = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!context || !layout) return '';
  return (
    <Show when={canSpotlight(layout.manager)}>
      <Button
        class="p-1 rounded-lg hidden"
        label={
          context.handle.isSpotLight() ? 'Minimize Split' : 'Spotlight Split'
        }
        hotkey={TOKENS.window.spotlight.toggle}
        onClick={() => context.handle.toggleSpotlight()}
      >
        {context.handle.isSpotLight() ? (
          <CollapseIcon class="h-4" />
        ) : (
          <ExpandIcon class="h-4" />
        )}
      </Button>
    </Show>
  );
}

function SplitCloseButton() {
  const context = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!context || !layout) return null;

  const label = createMemo(() => {
    const isOnlySplit = layout.manager.splits().length === 1;
    const isNotUnifiedList = !isListViewID(context.handle.content().id);
    return isOnlySplit && isNotUnifiedList ? 'Return to list' : 'Close';
  });

  return (
    <Show when={layout.manager.splits().length > 1}>
      <Button
        class="p-1 rounded-lg"
        label={label()}
        hotkey={TOKENS.split.close}
        onClick={context.handle.close}
      >
        <CloseIcon class="size-4" />
      </Button>
    </Show>
  );
}

export function SplitHeader(props: { ref: Setter<HTMLDivElement | null> }) {
  const panel = useContext(SplitPanelContext);
  if (!panel) {
    throw new Error('<SplitHeader> must be used within a <SplitLayout>');
  }

  const droppableId = `split-header-${panel.handle.id}`;
  const droppable = createDroppable(droppableId, {
    type: 'split-header',
  });
  const [dragDropState, { onDragEnd }] = useDragDropContext() ?? [
    undefined,
    { onDragEnd: () => {} },
  ];

  const isEntityDraggingOver = createMemo(() => {
    const data = dragDropState?.active.draggable?.data;
    return (
      data?.dragType === 'entity' &&
      dragDropState?.active.droppable?.id === droppableId
    );
  });

  onDragEnd((event: EntityDragEvent) => {
    if (event.droppable?.id !== droppableId) return;

    const data = event.draggable?.data;
    if (!data || data.dragType !== 'entity') return;

    const current = panel.handle.content();
    const next = getEntitySplitContent(data);
    if (!next) return;
    if (current.type === next.type && current.id === next.id) return;

    void openEntityInSplitFromUnifiedList(data, {
      splitHandle: panel.handle,
      allowDuplicate: true,
    });
  });

  return (
    <div
      class={cn(
        'isolate relative w-full h-full overflow-clip text-ink',
        isMobile() && isListViewID(panel.handle.content().id) && 'hidden',
        isEntityDraggingOver() && 'bg-active/50'
      )}
      data-split-header
      ref={mergeRefs(droppable, props.ref)}
    >
      <Show when={panel.panelRef()}>
        {(panelRef) => (
          <Portal mount={panelRef()}>
            <Show when={isEntityDraggingOver()}>
              <div
                class="pointer-events-none absolute inset-0 rounded-xl z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted flex items-center justify-center"
                data-split-header-drop-overlay
              >
                <div class="max-w-[min(28rem,calc(100%-3rem))] min-w-0 bg-surface border border-edge rounded-lg shadow-lg shadow-drop-shadow px-4 py-3 flex items-center gap-2 text-sm text-ink">
                  <span class="shrink-0 text-ink-muted">
                    Open in this split
                  </span>
                </div>
              </div>
            </Show>
          </Portal>
        )}
      </Show>
      <div class="absolute inset-0 flex justify-start items-center">
        <div class="relative flex items-center pl-2 mobile:pl-0 h-full">
          <div class="mobile:hidden">
            <SplitCloseButton />
          </div>
          <Show when={!(isMobile() && isListViewID(panel.handle.content().id))}>
            <SplitBackButton />
            <SplitForwardButton />
          </Show>
        </div>

        <div
          class="relative min-w-0 h-full shrink pl-2 flex items-center gap-0.5"
          ref={(ref) => {
            panel.layoutRefs.headerLeft = ref;
          }}
        />

        {/*<Show when={shouldShowRightmost()}>
          <div
            class={
              'pl-2 z-annotation-layer relative flex items-center gap-0.5 h-full'
            }
          >
            <SplitSpotlightButton />
          </div>
        </Show>*/}

        <div
          class="min-w-4 h-full grow shrink flex items-center justify-end gap-0.5 px-2"
          ref={(ref) => {
            panel.layoutRefs.headerRight = ref;
          }}
        />
      </div>
    </div>
  );
}

export function SplitHeaderLeft(props: ParentProps) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitHeaderLeft> must be used within a <SplitLayout>');

  return (
    <Show when={ctx.layoutRefs.headerLeft}>
      <Portal
        mount={ctx.layoutRefs.headerLeft}
        ref={(div) => (div.style.display = 'contents')}
      >
        {props.children}
      </Portal>
    </Show>
  );
}

export function SplitHeaderRight(props: ParentProps) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitHeaderRight> must be used within a <SplitLayout>');

  return (
    <Show when={ctx.layoutRefs.headerRight}>
      <Portal
        mount={ctx.layoutRefs.headerRight}
        ref={(div) => (div.style.display = 'contents')}
      >
        {props.children}
      </Portal>
    </Show>
  );
}
