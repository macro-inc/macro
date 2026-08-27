import {
  getChannelEntityTarget,
  navigateChannelEntityToTarget,
  reminderSplitTarget,
} from '@app/features/next-soup/utils';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { getChannelParams } from '@block-channel/utils/link';
import type { BlockAliasContext, BlockName } from '@core/block';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import { USE_MACRO_PR_SUMMARY_BLOCK } from '@core/constant/featureFlags';
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

function PreviewPanelContent(props: PreviewPanelProps & {
  selectedEntity: EntityData;
}) {
  const scopedLayoutRefs: SplitPanelContextType['layoutRefs'] = {};
  const selectedEntityId = createMemo(() => props.selectedEntity.id);
  const [interactedWith, setInteractedWith] = createSignal(false);

  const blockInstance = createMemo(() => {
    const entity = props.selectedEntity;
    const aliasContext = isTaskEntity(entity)
      ? ({ alias: 'task', baseType: 'md' } as BlockAliasContext)
      : isSnippetEntity(entity)
        ? ({ alias: 'snippet', baseType: 'md' } as BlockAliasContext)
        : undefined;

    let blockType: BlockName;
    let blockId: string;
    if (entity.type === 'document') {
      blockType = fileTypeToResolvedBlockName(entity.fileType);
      blockId = entity.id;
    } else if (
      entity.type === 'channel_message' ||
      entity.type === 'channel_thread'
    ) {
      blockType = 'channel';
      blockId = entity.channelId;
    } else if (entity.type === 'foreign') {
      blockType =
        USE_MACRO_PR_SUMMARY_BLOCK && isGithubPrEntity(entity)
          ? 'pr'
          : 'unknown';
      blockId = entity.id;
    } else if (entity.type === 'crm_company') {
      blockType = 'company';
      blockId = entity.id;
    } else if (entity.type === 'crm_contact') {
      blockType = 'contact';
      blockId = entity.id;
    } else if (entity.type === 'calendar_event') {
      blockType = 'calendar';
      blockId = CALENDAR_BLOCK_ID;
    } else if (entity.type === 'reminder') {
      const target = reminderSplitTarget(entity);
      blockType = fileTypeToResolvedBlockName(target?.type);
      blockId = target?.id ?? entity.id;
    } else {
      blockType = fileTypeToResolvedBlockName(entity.type);
      blockId = entity.id;
    }

    const channelTarget =
      blockType === 'channel'
        ? untrack(() => getChannelEntityTarget(entity))
        : undefined;

    return props.orchestrator.createBlockInstance(blockType, blockId, {
      aliasContext,
      params:
        channelTarget?.kind === 'message'
          ? getChannelParams(channelTarget.messageId, channelTarget.threadId)
          : undefined,
    });
  });

  createRenderEffect(
    on(selectedEntityId, () => {
      setInteractedWith(false);
      void navigateChannelEntityToTarget(
        props.selectedEntity,
        props.orchestrator
      );
    })
  );

  return (
    <div
      ref={props.ref}
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
        } else {
          (event.target as HTMLElement).blur?.();
        }
      }}
      onPointerDown={() => setInteractedWith(true)}
      tabIndex={-1}
    >
      <div class="relative flex min-h-10 w-full shrink-0 items-center justify-between bg-surface px-2">
        <div
          class="flex h-full items-center gap-1"
          ref={(ref) => {
            scopedLayoutRefs.headerLeft = ref;
          }}
        />
        <div
          class="flex h-full items-center gap-1"
          ref={(ref) => {
            scopedLayoutRefs.headerRight = ref;
          }}
        />
      </div>
      <div class="relative flex min-h-0 w-full shrink-0 items-center justify-between bg-surface px-2">
        <div
          class="flex h-full items-center gap-1"
          ref={(ref) => {
            scopedLayoutRefs.toolbarLeft = ref;
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
            layoutRefs: scopedLayoutRefs,
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
          <PreviewPanelContent
            {...props}
            selectedEntity={selectedEntity()}
          />
        )}
      </Show>
    </div>
  );
}
