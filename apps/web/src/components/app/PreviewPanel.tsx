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
import { match, P } from 'ts-pattern';
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
};

function PreviewPanelContent(
  props: PreviewPanelProps & { selectedEntity: EntityData }
) {
  const scopedLayoutRefs: SplitPanelContextType['layoutRefs'] = {};
  const selectedEntityId = createMemo(() => props.selectedEntity.id);
  const [interactedWith, setInteractedWith] = createSignal(false);

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
        (message) => ({
          blockType: 'channel',
          blockId: message.channelId,
          aliasContext: undefined,
        })
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
      .with({ type: 'calendar_event' }, () => ({
        blockType: 'calendar',
        blockId: CALENDAR_BLOCK_ID,
        aliasContext: undefined,
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

    const channelTarget =
      target.blockType === 'channel'
        ? untrack(() => getChannelEntityTarget(entity))
        : undefined;

    return props.orchestrator.createBlockInstance(
      target.blockType,
      target.blockId,
      {
        aliasContext: target.aliasContext,
        params:
          channelTarget?.kind === 'message'
            ? getChannelParams(channelTarget.messageId, channelTarget.threadId)
            : undefined,
      }
    );
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
          <PreviewPanelContent {...props} selectedEntity={selectedEntity()} />
        )}
      </Show>
    </div>
  );
}
