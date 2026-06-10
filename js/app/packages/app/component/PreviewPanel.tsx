import { getChannelParams } from '@block-channel/utils/link';
import type { BlockAliasContext, BlockName } from '@core/block';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import type { BlockOrchestrator } from '@core/orchestrator';
import { throttledDependent } from '@core/util/debounce';
import type { NonNullableFields } from '@core/util/withRequired';
import { type EntityData, isChannelMessageEntity, isTaskEntity } from '@entity';
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
  // In preview we intentionally do NOT render the split header/title row.
  // We only provide toolbar slots (Share, etc).
  scopedLayoutRefs.headerLeft = undefined;
  scopedLayoutRefs.headerRight = undefined;

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
      : undefined;

    let blockType: BlockName;
    let blockId: string;
    if (props.selectedEntity.type === 'document') {
      blockType = fileTypeToResolvedBlockName(props.selectedEntity.fileType);
      blockId = props.selectedEntity.id;
    } else if (props.selectedEntity.type === 'channel_message') {
      blockType = 'channel';
      blockId = props.selectedEntity.channelId;
    } else if (props.selectedEntity.type === 'foreign') {
      // TODO(dev-rb/github): Preview GitHub PRs with /pr.
      blockType = 'unknown';
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
    if (isChannelMessageEntity(entity)) {
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
      {/* Preview-specific toolbar slots so blocks can render the "share" bar (via SplitToolbarLeft/Right) */}
      <div
        class="relative w-full flex items-center justify-between shrink-0 h-10 bg-surface px-2 border-b border-edge-muted"
        data-preview-split-toolbar
      >
        <div
          // In preview mode, anchor left-side controls (e.g. file menu) to the top-left
          // so the dropdown doesn't feel like it's "hanging" from the middle of the bar.
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
