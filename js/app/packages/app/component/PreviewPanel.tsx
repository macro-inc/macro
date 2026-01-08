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
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

type PreviewPanel = {
  selectedEntity: EntityData | undefined;
  orchestrator: BlockOrchestrator;
  splitPanelContext: SplitPanelContextType;
};

const PreviewPanelContent: Component<NonNullableFields<PreviewPanel>> = (
  props
) => {
  let containerRef!: HTMLDivElement;
  let scopedSplitPanelContextType: SplitPanelContextType = {} as any;

  if (props.selectedEntity.type === 'project') {
    const splitPanelContext = useSplitPanelOrThrow();
    const unifiedListContext = createSoupContext({
      isRenderedFromPreview: true,
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
      unifiedListContext,
      previewState: [previewState, setPreviewState],
    });
    scopedSplitPanelContextType.unifiedListContext = unifiedListContext;
    scopedSplitPanelContextType.previewState = [previewState, setPreviewState];

    onMount(() => {
      attachHotKeys(containerRef);
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

  return (
    <div
      class="size-full"
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
      ref={containerRef}
    >
      <SplitPanelContext.Provider
        value={{
          ...props.splitPanelContext,
          ...scopedSplitPanelContextType,
          layoutRefs: {
            ...props.splitPanelContext.layoutRefs,
            headerLeft: undefined,
            headerRight: undefined,
          },
          halfSplitState: () => ({
            side: 'right',
            percentage: 30,
          }),
        }}
      >
        <Dynamic component={blockInstance().element} />
      </SplitPanelContext.Provider>
    </div>
  );
};

export const PreviewPanel: Component<PreviewPanel> = (props) => {
  return (
    <div class="flex flex-row size-full w-[70%] shrink-0">
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
