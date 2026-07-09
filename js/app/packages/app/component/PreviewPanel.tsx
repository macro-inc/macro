import { getChannelParams } from '@block-channel/utils/link';
import type { BlockAliasContext, BlockName } from '@core/block';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import { USE_MACRO_PR_SUMMARY_BLOCK } from '@core/constant/featureFlags';
import type { BlockOrchestrator } from '@core/orchestrator';
import { throttledDependent } from '@core/util/debounce';
import type { NonNullableFields } from '@core/util/withRequired';
import {
  type EntityData,
  isChannelMessageEntity,
  isGithubPrEntity,
  isSnippetEntity,
  isTaskEntity,
} from '@entity';
import { createContextProvider } from '@solid-primitives/context';
import {
  type Component,
  createRenderEffect,
  createSignal,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from './split-layout/context';

export const [PreviewPanelContext, useMaybePreviewPanel] =
  createContextProvider(
    (props: { previewEntity: EntityData; onFocusOut?: VoidFunction }) => {
      return {
        previewEntity: () => props.previewEntity,
        onFocusOut: () => props.onFocusOut?.(),
      };
    }
  );

type PreviewPanel = {
  selectedEntity: EntityData | undefined;
  orchestrator: BlockOrchestrator;
  splitPanelContext: SplitPanelContextType;
  onFocusOut?: VoidFunction;
  ref?: (el: HTMLElement) => void;
};

const PreviewPanelContent: Component<NonNullableFields<PreviewPanel>> = (
  props
) => {
  let scopedSplitPanelContextType: SplitPanelContextType = {} as any;
  const scopedLayoutRefs: SplitPanelContextType['layoutRefs'] = {
    ...props.splitPanelContext.layoutRefs,
  };

  if (props.selectedEntity.type === 'project') {
    // Isolate the previewed project's preview state from the outer panel so
    // the nested SoupView's sync effect doesn't clobber the parent. Preview
    // can only work one level deep, so we never enable preview inside.
    const [previewState, setPreviewState] = createSignal(false);
    scopedSplitPanelContextType.previewState = [previewState, setPreviewState];
  }

  const throttledSelectedEntity = throttledDependent(
    () => props.selectedEntity,
    150
  );

  const blockInstance = () => {
    const aliasContext = isTaskEntity(props.selectedEntity)
      ? ({
          alias: 'task',
          baseType: 'md',
        } as BlockAliasContext)
      : isSnippetEntity(props.selectedEntity)
        ? ({
            alias: 'snippet',
            baseType: 'md',
          } as BlockAliasContext)
        : undefined;

    let blockType: BlockName;
    let blockId: string;
    if (props.selectedEntity.type === 'document') {
      blockType = fileTypeToResolvedBlockName(props.selectedEntity.fileType);
      blockId = props.selectedEntity.id;
    } else if (
      props.selectedEntity.type === 'channel_message' ||
      props.selectedEntity.type === 'channel_thread'
    ) {
      blockType = 'channel';
      blockId = props.selectedEntity.channelId;
    } else if (props.selectedEntity.type === 'foreign') {
      // GitHub PRs preview in the dedicated /pr block (keyed by foreign entity
      // id); other foreign sources fall back to the generic unknown block.
      // Mirrors the open path in openEntityInSplitFromUnifiedList, which is
      // also gated on USE_MACRO_PR_SUMMARY_BLOCK.
      blockType =
        USE_MACRO_PR_SUMMARY_BLOCK && isGithubPrEntity(props.selectedEntity)
          ? 'pr'
          : 'unknown';
      blockId = props.selectedEntity.id;
    } else if (props.selectedEntity.type === 'crm_company') {
      blockType = 'company';
      blockId = props.selectedEntity.id;
    } else if (props.selectedEntity.type === 'crm_contact') {
      blockType = 'contact';
      blockId = props.selectedEntity.id;
    } else {
      blockType = props.selectedEntity.type;
      blockId = props.selectedEntity.id;
    }

    return props.orchestrator.createBlockInstance(blockType, blockId, {
      aliasContext,
    });
  };
  const [interactedWith, setInteractedWith] = createSignal(false);

  createRenderEffect((prevId: string) => {
    const id = props.selectedEntity.id;
    if (id !== prevId) {
      setInteractedWith(false);
    }

    const entity = props.selectedEntity;
    if (isChannelMessageEntity(entity) || entity.type === 'channel_thread') {
      const channelId = entity.channelId;
      const messageId = entity.messageId;
      const threadId = entity.threadId;
      props.orchestrator.getBlockHandle(channelId).then((handle) => {
        handle?.goToLocationFromParams(getChannelParams(messageId, threadId));
      });
    }

    return id;
  }, props.selectedEntity.id);

  createRenderEffect(() => {
    // noop: previously we constrained toolbarLeft width based on the main split's
    // halfSplitState. This caused preview topbars (e.g. the hamburger menu) to
    // appear "hung" from the middle in preview mode.
    // Keeping this effect slot in case we need future layout hacks.
  });

  return (
    <div
      ref={props.ref}
      class="flex flex-col size-full"
      onFocusIn={(event) => {
        if (interactedWith()) return;

        // TODO: use state instead to determine when preview block can recieve focus
        if (event.target.hasAttribute('data-allow-focus-in-preview')) {
          setInteractedWith(true);
          return;
        }

        // Prevent blocks from stealing focus in preview mode.
        // Redirect to the previous element if it was outside the preview,
        // otherwise blur the target to keep focus on the search list.
        const relatedTarget = event.relatedTarget;
        const currentTarget = event.currentTarget;

        if (
          relatedTarget instanceof HTMLElement &&
          !currentTarget.contains(relatedTarget)
        ) {
          relatedTarget.focus();
        } else {
          (event.target as HTMLElement).blur?.();
        }
      }}
      onPointerDown={() => {
        setInteractedWith(true);
      }}
      tabIndex={-1}
    >
      {/* Display the split header content here */}
      <div
        class="relative w-full flex items-center justify-between shrink-0 bg-surface px-2 py-2"
        data-preview-split-header
      >
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

      {/* Legacy: We've moved to a single top bar in most places but some blocks/places still try to display a toolbar as well.
          This is for those blocks so we can see their toolbars int eh preview panel */}
      <div
        class="relative w-full flex items-center justify-between shrink-0 bg-surface px-2 py-2"
        data-preview-split-toolbar
      >
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

      <div class="flex-1 min-h-0">
        <SplitPanelContext.Provider
          value={{
            ...props.splitPanelContext,
            ...scopedSplitPanelContextType,
            layoutRefs: scopedLayoutRefs,
            // Disable halfSplit positioning logic for preview topbars.
            // The preview panel is already laid out by the outer split; applying halfSplitState
            // here incorrectly shifts toolbar content towards the middle.
            halfSplitState: undefined,
          }}
        >
          <PreviewPanelContext
            previewEntity={throttledSelectedEntity()}
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
};

export const PreviewPanel: Component<PreviewPanel> = (props) => {
  return (
    <div class="flex flex-row size-full">
      <Show when={props.selectedEntity}>
        {(selectedEntity) => (
          <PreviewPanelContent
            ref={props.ref}
            selectedEntity={selectedEntity()}
            orchestrator={props.orchestrator}
            splitPanelContext={props.splitPanelContext}
            onFocusOut={props.onFocusOut}
          />
        )}
      </Show>
    </div>
  );
};
