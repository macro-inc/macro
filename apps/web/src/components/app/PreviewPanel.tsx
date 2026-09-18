import {
  navigateCalendarEntityToTarget,
  navigateChannelEntityToTarget,
} from '@app/features/next-soup/utils';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createContextProvider } from '@solid-primitives/context';
import {
  createMemo,
  createRenderEffect,
  createSignal,
  type JSX,
  on,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  type PreviewPanelSelection,
  previewBlockTarget,
} from './previewTarget';

export type { PreviewPanelSelection } from './previewTarget';

import { ViewShell } from '../view-shell/ViewShell';
import {
  createPriorityCollapseController,
  PriorityCollapseOverflowSensor,
} from './split-layout/components/PriorityCollapseOverflowSensor';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from './split-layout/context';

export const [PreviewPanelContext, useMaybePreviewPanel] =
  createContextProvider(
    (props: {
      previewEntity: PreviewPanelSelection;
      onFocusOut?: VoidFunction;
    }) => ({
      previewEntity: () => props.previewEntity,
      onFocusOut: () => props.onFocusOut?.(),
    })
  );

export type PreviewPanelProps = {
  selectedEntity: PreviewPanelSelection | undefined;
  orchestrator: BlockOrchestrator;
  splitPanelContext: SplitPanelContextType;
  onFocusOut?: VoidFunction;
  ref?: (el: HTMLElement) => void;
  headerLeading?: JSX.Element;
};

function PreviewPanelContent(
  props: PreviewPanelProps & { selectedEntity: PreviewPanelSelection }
) {
  const scopedLayoutRefs: SplitPanelContextType['layoutRefs'] = {};
  const headerCollapseController = createPriorityCollapseController();
  const toolbarCollapseController = createPriorityCollapseController();
  const [interactedWith, setInteractedWith] = createSignal(false);
  const [attachHotkeys, previewHotkeyScope] =
    useHotkeyDOMScope('preview-panel');

  const blockInstance = createMemo<
    ReturnType<BlockOrchestrator['createBlockInstance']> | undefined
  >((previous) => {
    const entity = props.selectedEntity;

    const target = previewBlockTarget(entity);

    if (previous?.type === target.blockType && previous.id === target.blockId) {
      return previous;
    }

    return props.orchestrator.createBlockInstance(
      target.blockType,
      target.blockId,
      {
        aliasContext: target.aliasContext,
        params: target.params,
      }
    );
  });

  // Cache reconciliation can replace an unchanged channel object. Only a new
  // selection or explicit target should navigate/reset focus, not fresh metadata
  // or notifications. Keep the live entity available to the preview context.
  const navigationSelection = createMemo(() => {
    const entity = props.selectedEntity;
    if (
      entity.type === 'channel' ||
      entity.type === 'channel_message' ||
      entity.type === 'channel_thread'
    ) {
      return JSON.stringify([
        entity.type,
        entity.id,
        entity.type === 'channel' ? undefined : entity.channelId,
        entity.type === 'channel' ? undefined : entity.messageId,
        entity.type === 'channel' ? undefined : entity.threadId,
        entity.target?.messageId,
        entity.target?.threadId,
      ]);
    }
    return entity;
  });

  createRenderEffect(
    on(navigationSelection, () => {
      const entity = props.selectedEntity;
      setInteractedWith(false);
      if (!blockInstance()) return;
      if (
        entity.type === 'channel' ||
        entity.type === 'channel_message' ||
        entity.type === 'channel_thread'
      ) {
        void navigateChannelEntityToTarget(entity, props.orchestrator);
      } else if (entity.type === 'calendar_event') {
        void navigateCalendarEntityToTarget(entity, props.orchestrator);
      }
    })
  );

  return (
    <div
      ref={(element) => {
        attachHotkeys(element);
        props.ref?.(element);
      }}
      class="flex size-full min-h-0 flex-col"
      onFocusIn={(event) => {
        if (interactedWith()) return;
        if (event.target.hasAttribute('data-allow-focus-in-preview')) {
          setInteractedWith(true);
          return;
        }
        const relatedTarget = event.relatedTarget;
        if (
          relatedTarget instanceof HTMLElement &&
          !event.currentTarget.contains(relatedTarget)
        ) {
          relatedTarget.focus();
        } else if (props.onFocusOut) {
          props.onFocusOut();
        } else {
          (event.target as HTMLElement).blur?.();
        }
      }}
      onPointerDown={() => setInteractedWith(true)}
      tabIndex={-1}
    >
      <ViewShell.TopBar
        ref={headerCollapseController.setRow}
        class="relative w-full py-0 touch:flex"
      >
        <Show when={props.headerLeading}>
          <div class="flex shrink-0 items-center">{props.headerLeading}</div>
        </Show>
        <PriorityCollapseOverflowSensor
          controller={headerCollapseController}
          truncateAsLastResort
          class="relative h-full min-w-0 shrink overflow-hidden"
          contentClass={
            props.headerLeading
              ? 'flex h-full items-center gap-1 pl-0.5'
              : 'flex h-full items-center gap-1'
          }
          contentRef={(element) => {
            scopedLayoutRefs.headerLeft = element;
          }}
        />
        <div
          class="flex h-full grow shrink items-center justify-end gap-1"
          ref={(ref) => {
            scopedLayoutRefs.headerRight = ref;
          }}
        />
      </ViewShell.TopBar>
      <div
        ref={toolbarCollapseController.setRow}
        class="relative flex min-h-0 w-full shrink-0 items-center justify-between px-2"
      >
        <PriorityCollapseOverflowSensor
          controller={toolbarCollapseController}
          class="min-w-0 flex-1 overflow-hidden"
          contentClass="flex items-center gap-1"
          contentRef={(element) => {
            scopedLayoutRefs.toolbarLeft = element;
          }}
        />
        <div
          class="flex h-full items-center gap-1"
          ref={(ref) => {
            scopedLayoutRefs.toolbarRight = ref;
          }}
        />
      </div>
      <div class="min-h-0 flex-1">
        <SplitPanelContext.Provider
          value={{
            ...props.splitPanelContext,
            splitHotkeyScope: previewHotkeyScope,
            isInlinePreview: true,
            layoutRefs: scopedLayoutRefs,
            headerCollapser: headerCollapseController.collapser,
            toolbarCollapser: toolbarCollapseController.collapser,
          }}
        >
          <PreviewPanelContext
            previewEntity={props.selectedEntity}
            onFocusOut={props.onFocusOut}
          >
            <Suspense>
              <Show when={blockInstance()}>
                {(instance) => <Dynamic component={instance().element} />}
              </Show>
            </Suspense>
          </PreviewPanelContext>
        </SplitPanelContext.Provider>
      </div>
    </div>
  );
}

/**
 * Renders an admitted selection. Hosts use createPreviewSelectionGuard before
 * changing selection so conflicts never replace their current detail view.
 */
export function PreviewPanel(props: PreviewPanelProps) {
  return (
    <div class="flex size-full min-h-0">
      <Show when={props.selectedEntity}>
        {(selectedEntity) => (
          <PreviewPanelContent {...props} selectedEntity={selectedEntity()} />
        )}
      </Show>
    </div>
  );
}
