import type { BlockAliasContext } from '@core/block';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { BlockOrchestrator } from '@core/orchestrator';
import type { NonNullableFields } from '@core/util/withRequired';
import { type EntityData, isTaskEntity } from '@macro-entity';
import {
  type Component,
  createMemo,
  createRenderEffect,
  createSignal,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  createNavigationEntityListShortcut,
  createSoupContext,
} from './SoupContext';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from './split-layout/context';
import { useSplitLayout } from './split-layout/layout';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

type PreviewPanel = {
  selectedEntity: EntityData | undefined;
  orchestrator: BlockOrchestrator;
  splitPanelContext: SplitPanelContextType;
};

const PreviewPanelContent: Component<NonNullableFields<PreviewPanel>> = (
  props
) => {
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement | null>(
    null
  );
  let scopedSplitPanelContextType: SplitPanelContextType = {} as any;
  const splitPanelContext = useSplitPanelOrThrow();
  const scopedLayoutRefs: SplitPanelContextType['layoutRefs'] = {
    ...props.splitPanelContext.layoutRefs,
  };
  // In preview we intentionally do NOT render the split header/title row.
  // We only provide toolbar slots (Share, etc).
  scopedLayoutRefs.headerLeft = undefined;
  scopedLayoutRefs.headerRight = undefined;

  if (props.selectedEntity.type === 'project') {
    const { getSplitCount } = useSplitLayout();
    const soupContext = createSoupContext({
      isRenderedFromPreview: true,
      parentContext: splitPanelContext.soupContext,
      domRef: containerRef,
    });

    const [attachHotKeys, splitHotkeyScope] = useHotkeyDOMScope(
      `split=${splitPanelContext.splitHotkeyScope}`
    );

    const [previewState, setPreviewState] = createSignal(false);
    const splitName = createMemo(() => {
      const { type, id } = splitPanelContext.handle.content();
      if (type === 'component') return id;

      return type;
    });

    createNavigationEntityListShortcut({
      splitName,
      splitHandle: splitPanelContext.handle,
      splitHotkeyScope,
      soupContext,
      previewState: [previewState, setPreviewState],
      getSplitCount: getSplitCount,
    });
    scopedSplitPanelContextType.soupContext = soupContext;
    scopedSplitPanelContextType.previewState = [previewState, setPreviewState];

    onMount(() => {
      attachHotKeys(containerRef()!);
    });
  }

  const blockInstance = () => {
    const aliasContext = isTaskEntity(props.selectedEntity)
      ? ({
          alias: 'task',
          baseType: 'md',
        } as BlockAliasContext)
      : undefined;
    return props.orchestrator.createBlockInstance(
      props.selectedEntity.type === 'document'
        ? fileTypeToResolvedBlockName(props.selectedEntity.fileType)
        : props.selectedEntity.type,
      props.selectedEntity.id,
      { aliasContext }
    );
  };
  const [interactedWith, setInteractedWith] = createSignal(false);

  createRenderEffect((prevId: string) => {
    const id = props.selectedEntity.id;
    if (id !== prevId) {
      setInteractedWith(false);
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
      class="flex flex-col size-full"
      onFocusIn={(event) => {
        if (interactedWith()) return;
        const relatedTarget = event.relatedTarget;
        const currentTarget = event.currentTarget;

        // TODO: use state instead to determine when preview block can recieve focus
        if (event.target.hasAttribute('data-allow-focus-in-preview')) {
          setInteractedWith(true);
          return;
        }

        if (relatedTarget instanceof HTMLElement) {
          if (!currentTarget.contains(relatedTarget)) {
            relatedTarget.focus();
          }
        }
      }}
      onPointerDown={() => {
        setInteractedWith(true);
      }}
      tabIndex={-1}
      ref={setContainerRef}
    >
      {/* Preview-specific toolbar slots so blocks can render the "share" bar (via SplitToolbarLeft/Right) */}
      <div
        class="relative w-full flex items-center justify-between shrink-0 h-10 pr-1 border-b border-edge-muted/50 bg-panel"
        classList={{
          // In spotlight/fullscreen, avoid hugging the screen edge
          'pl-2': splitPanelContext.handle.isSpotLight(),
          'pl-1': !splitPanelContext.handle.isSpotLight(),
        }}
        data-preview-split-toolbar
      >
        <div
          // In preview mode, anchor left-side controls (e.g. file menu) to the top-left
          // so the dropdown doesn't feel like it's "hanging" from the middle of the bar.
          class="flex h-full items-start pt-1 flex-1"
          ref={(ref) => {
            scopedLayoutRefs.toolbarLeft = ref;
          }}
        />
        <div
          class="flex h-full items-center"
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
          <Dynamic component={blockInstance().element} />
        </SplitPanelContext.Provider>
      </div>
    </div>
  );
};

export const PreviewPanel: Component<PreviewPanel> = (props) => {
  return (
    <div class="flex flex-row size-full sm:w-[70%] max-sm:h-[50%] max-sm:border-t border-edge-muted shrink-0">
      <Show when={props.selectedEntity}>
        {(selectedEntity) => (
          <PreviewPanelContent
            selectedEntity={selectedEntity()}
            orchestrator={props.orchestrator}
            splitPanelContext={props.splitPanelContext}
          />
        )}
      </Show>
    </div>
  );
};
