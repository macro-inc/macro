import {
  calendarBlockParamsForEntity,
  getChannelEntityTarget,
  navigateCalendarEntityToTarget,
  navigateChannelEntityToTarget,
  reminderSplitTarget,
} from '@app/features/next-soup/utils';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { getChannelParams } from '@block-channel/utils/link';
import type {
  BlockAliasContext,
  BlockComponentProps,
  BlockName,
} from '@core/block';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import { USE_MACRO_PR_SUMMARY_BLOCK } from '@core/constant/featureFlags';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { BlockOrchestrator } from '@core/orchestrator';
import {
  type EntityData,
  isGithubPrEntity,
  isSnippetEntity,
  isTaskEntity,
} from '@entity';
import { createContextProvider } from '@solid-primitives/context';
import {
  createMemo,
  createRenderEffect,
  createSignal,
  on,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match, P } from 'ts-pattern';
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
    (props: { previewEntity: EntityData; onFocusOut?: VoidFunction }) => ({
      previewEntity: () => props.previewEntity,
      onFocusOut: () => props.onFocusOut?.(),
    })
  );

export type PreviewPanelProps = {
  selectedEntity: EntityData | undefined;
  orchestrator: BlockOrchestrator;
  splitPanelContext: SplitPanelContextType;
  onFocusOut?: VoidFunction;
  ref?: (el: HTMLElement) => void;
};

type PreviewBlockTarget = {
  blockType: BlockName;
  blockId: string;
  aliasContext: BlockAliasContext | undefined;
  params?: BlockComponentProps[BlockName];
};

function PreviewPanelContent(
  props: PreviewPanelProps & { selectedEntity: EntityData }
) {
  const scopedLayoutRefs: SplitPanelContextType['layoutRefs'] = {};
  const headerCollapseController = createPriorityCollapseController();
  const toolbarCollapseController = createPriorityCollapseController();
  const [interactedWith, setInteractedWith] = createSignal(false);
  const [attachHotkeys, previewHotkeyScope] =
    useHotkeyDOMScope('preview-panel');

  const blockInstance = createMemo(() => {
    const entity = props.selectedEntity;

    const target = match(entity)
      .returnType<PreviewBlockTarget>()
      .when(isTaskEntity, (task) => ({
        blockType: fileTypeToResolvedBlockName(task.fileType),
        blockId: task.id,
        aliasContext: {
          alias: 'task',
          baseType: 'md',
        } satisfies BlockAliasContext,
      }))
      .when(isSnippetEntity, (snippet) => ({
        blockType: fileTypeToResolvedBlockName(snippet.fileType),
        blockId: snippet.id,
        aliasContext: {
          alias: 'snippet',
          baseType: 'md',
        } satisfies BlockAliasContext,
      }))
      .with({ type: 'document' }, (document) => ({
        blockType: fileTypeToResolvedBlockName(document.fileType),
        blockId: document.id,
        aliasContext: undefined,
      }))
      .with(
        { type: P.union('channel_message', 'channel_thread') },
        (message) => {
          const channelTarget = untrack(() => getChannelEntityTarget(message));
          return {
            blockType: 'channel',
            blockId: message.channelId,
            aliasContext: undefined,
            params:
              channelTarget?.kind === 'message'
                ? getChannelParams(
                    channelTarget.messageId,
                    channelTarget.threadId
                  )
                : undefined,
          };
        }
      )
      .with({ type: 'foreign' }, (foreignEntity) => ({
        blockType:
          USE_MACRO_PR_SUMMARY_BLOCK && isGithubPrEntity(foreignEntity)
            ? 'pr'
            : 'unknown',
        blockId: foreignEntity.id,
        aliasContext: undefined,
      }))
      .with({ type: 'crm_company' }, (company) => ({
        blockType: 'company',
        blockId: company.id,
        aliasContext: undefined,
      }))
      .with({ type: 'crm_contact' }, (contact) => ({
        blockType: 'contact',
        blockId: contact.id,
        aliasContext: undefined,
      }))
      .with({ type: 'calendar_event' }, (calendarEvent) => ({
        blockType: 'calendar',
        blockId: CALENDAR_BLOCK_ID,
        aliasContext: undefined,
        params: untrack(() => calendarBlockParamsForEntity(calendarEvent)),
      }))
      .with({ type: 'reminder' }, (reminder) => {
        const reminderTarget = reminderSplitTarget(reminder);
        return {
          blockType: fileTypeToResolvedBlockName(reminderTarget?.type),
          blockId: reminderTarget?.id ?? reminder.id,
          aliasContext: undefined,
        };
      })
      .otherwise((fallbackEntity) => ({
        blockType: fileTypeToResolvedBlockName(fallbackEntity.type),
        blockId: fallbackEntity.id,
        aliasContext: undefined,
      }));

    return props.orchestrator.createBlockInstance(
      target.blockType,
      target.blockId,
      {
        aliasContext: target.aliasContext,
        params: target.params,
      }
    );
  });

  createRenderEffect(
    on(
      () => props.selectedEntity,
      (entity) => {
        setInteractedWith(false);
        void navigateChannelEntityToTarget(entity, props.orchestrator);
        void navigateCalendarEntityToTarget(entity, props.orchestrator);
      }
    )
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
      <div
        ref={headerCollapseController.setRow}
        class="relative flex min-h-10 w-full shrink-0 items-center justify-between bg-surface px-2"
      >
        <PriorityCollapseOverflowSensor
          controller={headerCollapseController}
          truncateAsLastResort
          class="relative h-full min-w-0 shrink overflow-hidden"
          contentClass="flex h-full items-center gap-1"
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
      </div>
      <div
        ref={toolbarCollapseController.setRow}
        class="relative flex min-h-0 w-full shrink-0 items-center justify-between bg-surface px-2"
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
              <Dynamic component={blockInstance().element} />
            </Suspense>
          </PreviewPanelContext>
        </SplitPanelContext.Provider>
      </div>
    </div>
  );
}

/** Renders a selected entity's actual block inside an inline preview surface. */
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
