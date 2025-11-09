import { useCanvasFileDrop } from '@block-canvas/signal/fileDrop';
import {
  canTryMindMapAgainSignal,
  redoGenerateMindMap,
} from '@block-canvas/signal/generateMindMap';
import { useRenderMermaid } from '@block-canvas/util/mermaid';
import { withAnalytics } from '@coparse/analytics';
import { type BlockName, useBlockId, useIsNestedBlock } from '@core/block';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import type { DragEventWithData } from '@core/component/FileList/DraggableItem';
import { BasicHotkey } from '@core/component/Hotkey';
import { OldMenu, OldMenuItem } from '@core/component/OldMenu';
import {
  blockNameToFileExtensions,
  blockNameToMimeTypes,
  fileTypeToBlockName,
} from '@core/constant/allBlocks';
import {
  ENABLE_CANVAS_HEIC,
  ENABLE_CANVAS_VIDEO,
} from '@core/constant/featureFlags';
import { fileDrop } from '@core/directive/fileDrop';
import { observedSize } from '@core/directive/observedSize';
import { HEIC_EXTENSIONS, HEIC_MIME_TYPES } from '@core/heic/constants';
import { TOKENS } from '@core/hotkey/tokens';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { blockHandleSignal } from '@core/signal/load';
import { trackMention } from '@core/signal/mention';
import { useCanEdit } from '@core/signal/permissions';
import TrashSimple from '@icon/regular/trash-simple.svg';
import Clipboard from '@phosphor-icons/core/regular/clipboard.svg?component-solid';
import CopySimple from '@phosphor-icons/core/regular/copy-simple.svg?component-solid';
import GridFour from '@phosphor-icons/core/regular/grid-four.svg?component-solid';
import Scissors from '@phosphor-icons/core/regular/scissors.svg?component-solid';
import SelectionBackground from '@phosphor-icons/core/regular/selection-background.svg?component-solid';
import SelectionForeground from '@phosphor-icons/core/regular/selection-foreground.svg?component-solid';
import SquaresFour from '@phosphor-icons/core/regular/squares-four.svg?component-solid';
import Stack from '@phosphor-icons/core/regular/stack.svg?component-solid';
import StackMinus from '@phosphor-icons/core/regular/stack-minus.svg?component-solid';
import StackPlus from '@phosphor-icons/core/regular/stack-plus.svg?component-solid';
import { createCallback } from '@solid-primitives/rootless';
import { throttle } from '@solid-primitives/scheduled';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { toast } from 'core/component/Toast/Toast';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { createMethodRegistration } from 'core/orchestrator';
import { usePinch } from 'solid-gesture';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
} from 'solid-js';
import {
  MAX_PAN_FLICK_SPEED,
  ReorderOperations,
  type Tool,
  Tools,
} from '../constants';
import { useConnect } from '../operation/connect';
import { fileHeight, fileWidth, useFile } from '../operation/file';
import { useImage } from '../operation/image';
import { useMove } from '../operation/move';
import { operatorFromPartial } from '../operation/operation';
import { usePencil } from '../operation/pencil';
import { useRescale } from '../operation/rescale';
import { useSelect } from '../operation/select';
import { useShape } from '../operation/shape';
import { useText } from '../operation/text';
import { useCanvasHistory } from '../signal/canvasHistory';
import { useClipboard } from '../signal/clipboard';
import { useNudge } from '../signal/nudge';
import { useReorder } from '../signal/reorder';
import { useSelection } from '../signal/selection';
import {
  handlersByToolSignal,
  middleMousePressedSignal,
  mouseDownPositionSignal,
  useToolManager,
} from '../signal/toolManager';
import {
  highestOrderSignal,
  useCanvasEdges,
  useCanvasNodes,
  useCreateGroup,
  useDeleteGroup,
  useExportCanvasData,
} from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { type Vector2, vec2 } from '../util/vector2';
import { createContextMenu } from './ContextMenu';
import { connectorTypeMenuTriggerSignal } from './TopBar';

false && observedSize;
false && fileDrop;

function toolToCursor(tool: Tool) {
  switch (tool) {
    case Tools.Select:
      return 'cursor-auto';
    case Tools.Grab:
      return 'cursor-grab';
    case Tools.ZoomIn:
      return 'cursor-zoom-in';
    case Tools.ZoomOut:
      return 'cursor-zoom-out';
    case Tools.Shape:
      return 'cursor-crosshair';
    case Tools.Image:
      return 'cursor-crosshair';
    case Tools.File:
      return 'cursor-context-menu';
    case Tools.Line:
      return 'cursor-crosshair';
    case Tools.Move:
      return 'cursor-move';
    case Tools.Pencil:
      return `cursor-crosshair`;
    case Tools.Text:
    case Tools.Typing:
      return `cursor-text`;
    default:
      return 'cursor-auto';
  }
}

// Track unique canvas controller instances to allow drag and drop to different canvases.
let canvasControllerId = 0;

export function handleDelete() {
  const selection = useSelection();
  const nodes = useCanvasNodes();
  const edges = useCanvasEdges();
  const history = useCanvasHistory();

  return createCallback(() => {
    if (!selection.active()) return false;
    history.open();
    nodes.batchUpdate(
      () => {
        for (let id of selection.selectedNodeIds()) {
          nodes.delete(id);
        }
      },
      { autosave: true }
    );
    edges.batchUpdate(
      () => {
        for (let id of selection.selectedEdgeIds()) {
          edges.delete(id);
        }
      },
      { autosave: true }
    );
    selection.deselectAll();
    nodes.save();
    edges.save();
    history.close();
    return true;
  });
}

export const renderMermaid = createCallback(async (args: { code: string }) => {
  const redoGenerateMindMapCallback = createCallback(redoGenerateMindMap);
  const [canTryMindMapAgain, _setCanTryMindMapAgain] = canTryMindMapAgainSignal;
  try {
    await renderMermaid(args);
  } catch (err) {
    console.error(err);
    if (canTryMindMapAgain()) {
      redoGenerateMindMapCallback();
    } else {
      toast.failure('Failed to generate Mind Map.');
    }
  }
});

export function CanvasController(props: ParentProps) {
  const scopeId = blockHotkeyScopeSignal.get;
  const canEdit = useCanEdit();
  const isNestedBlock = useIsNestedBlock();
  const isDisabled = createMemo(() => isNestedBlock || !canEdit());
  const renderState = useRenderState();
  const toolManager = useToolManager();
  const nodes = useCanvasNodes();
  const edges = useCanvasEdges();
  const selection = useSelection();
  const select = useSelect();
  const move = useMove();
  const rescale = useRescale();
  const connect = useConnect();
  const shape = useShape();
  const image = useImage();
  const pencil = usePencil();
  const text = useText();
  const clipboard = useClipboard();
  const history = useCanvasHistory();
  const file = useFile();
  const { nudge } = useNudge();
  const reorder = useReorder();
  const createGroup = useCreateGroup();
  const deleteGroup = useDeleteGroup();
  const deleteSelection = handleDelete();
  const renderMermaid = useRenderMermaid();
  const blockId = useBlockId();
  const [middleMousePressed] = middleMousePressedSignal;
  const [handlersByTool] = handlersByToolSignal;
  const [_, setConnectorTypeMenuTrigger] = connectorTypeMenuTriggerSignal;
  const exportCanvasData = useExportCanvasData();

  const imageExtensions = blockNameToFileExtensions.image;
  const imageMimeTypes = blockNameToMimeTypes.image;
  const videoExtensions = blockNameToFileExtensions.video;
  const videoMimeTypes = blockNameToMimeTypes.video;

  const canvasImageExtensions = ENABLE_CANVAS_HEIC
    ? [...imageExtensions, ...HEIC_EXTENSIONS]
    : imageExtensions;
  const canvasImageMimeTypes = ENABLE_CANVAS_HEIC
    ? [...imageMimeTypes, ...HEIC_MIME_TYPES]
    : imageMimeTypes;

  const acceptedMimeTypes = ENABLE_CANVAS_VIDEO
    ? [...canvasImageMimeTypes, ...videoMimeTypes]
    : canvasImageMimeTypes;
  const acceptedFileExtensions = ENABLE_CANVAS_VIDEO
    ? [...canvasImageExtensions, ...videoExtensions]
    : canvasImageExtensions;

  const blockHandle = blockHandleSignal.get;

  createMethodRegistration(blockHandle, {
    renderMermaid: async ({ code }: { code: string }) => renderMermaid(code),
    exportCanvas: async () => {
      const canvas = exportCanvasData();
      return canvas;
    },
  });

  const [domRect, setDomRect] = createSignal<DOMRect | undefined>();

  const [ref, setRef] = createSignal<HTMLDivElement>();

  const cursor = createMemo(() => toolToCursor(toolManager.activeTool()));

  const _id = canvasControllerId++;

  // TODO (seamus) : Doing pan this way is messy. But ths is so much nicer than it was before
  // so I will revisit if nedded. The pan operation has to be bound to the aniamtion fram rate
  // and not the rate of the mouse move event or else we get drifting or stuttering or other jank.
  let animationFrameId: number | null = null;
  let lastMousePosition = vec2(0, 0);
  let isGrab = false;

  toolManager.registerMouseTool(
    Tools.Grab,
    operatorFromPartial({
      preview: () => {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);

        if (!toolManager.mouseIsDown()) {
          isGrab = false;
          return;
        }

        if (!isGrab) {
          isGrab = true;
          lastMousePosition = toolManager.mousePosition().clone();
          return;
        }

        animationFrameId = requestAnimationFrame(() => {
          const delta = toolManager.mousePosition().subtract(lastMousePosition);
          renderState.pan(delta.x, delta.y, true);
          animationFrameId = null;
          lastMousePosition = toolManager.mousePosition().clone();
        });
      },
      start: (e) => {
        isGrab = true;
        lastMousePosition = vec2(e.pageX, e.pageY);
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
      },
      abort: () => {
        isGrab = false;
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
      },
      commit: (e: PointerEvent) => {
        // No momentum bases "flick" on mouse based grabs.
        if (e.pointerType === 'mouse') return;
        if (!isGrab) return;

        const delta = vec2(e.pageX, e.pageY).subtract(lastMousePosition);
        const mag = Math.min(delta.mag(), MAX_PAN_FLICK_SPEED);
        const dir = delta.normalize();

        let currentMomentum = mag;
        const decayFactor = 0.8; // Controls how quickly the momentum decays

        const animate = () => {
          if (currentMomentum < 0.01) {
            animationFrameId = null;
            return;
          }
          renderState.pan(
            dir.x * currentMomentum,
            dir.y * currentMomentum,
            true
          );
          currentMomentum *= decayFactor;
          animationFrameId = requestAnimationFrame(animate);
        };
        animationFrameId = requestAnimationFrame(animate);
      },
    })
  );

  toolManager.registerMouseTool(Tools.Select, select);
  toolManager.registerMouseTool(Tools.Resize, rescale);
  toolManager.registerMouseTool(Tools.Move, move);
  toolManager.registerMouseTool(Tools.Line, connect);
  toolManager.registerMouseTool(Tools.Shape, shape);
  toolManager.registerMouseTool(Tools.Image, image);
  toolManager.registerMouseTool(Tools.Pencil, pencil);
  toolManager.registerMouseTool(Tools.Text, text);
  toolManager.registerMouseTool(Tools.File, file);

  toolManager.registerMouseTool(
    Tools.ZoomIn,
    operatorFromPartial({
      start: (e) => renderState.zoom(0.1, e, true),
    })
  );

  toolManager.registerMouseTool(
    Tools.ZoomOut,
    operatorFromPartial({
      start: (e) => renderState.zoom(-0.1, e, true),
    })
  );

  onMount(() => {
    registerHotkey({
      hotkey: ['delete', 'backspace'],
      scopeId: scopeId(),
      description: 'Delete selection',
      keyDownHandler: deleteSelection,
      hotkeyToken: TOKENS.canvas.delete,
    });

    registerHotkey({
      hotkey: ']',
      scopeId: scopeId(),
      description: 'Bring to front',
      keyDownHandler: () => {
        if (!selection.active()) return false;
        reorder.reorder(ReorderOperations.BringToFront, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.bringToFront,
    });

    registerHotkey({
      hotkey: 'opt+]',
      scopeId: scopeId(),
      description: 'Bring forward',
      keyDownHandler: () => {
        if (!selection.active()) return false;
        reorder.reorder(ReorderOperations.Forward, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.bringForward,
    });

    registerHotkey({
      hotkey: '[',
      scopeId: scopeId(),
      description: 'Send to back',
      keyDownHandler: () => {
        if (!selection.active()) return false;
        reorder.reorder(ReorderOperations.SendToBack, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.sendToBack,
    });

    registerHotkey({
      hotkey: 'opt+[',
      scopeId: scopeId(),
      description: 'Send backward',
      keyDownHandler: () => {
        if (!selection.active()) return false;
        reorder.reorder(ReorderOperations.Backward, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.sendBackward,
    });

    registerHotkey({
      hotkey: 'cmd+a',
      scopeId: scopeId(),
      description: 'Select all',
      keyDownHandler: () => {
        toolManager.setSelectedTool(Tools.Select);
        selection.selectAll();
        return true;
      },
      hotkeyToken: TOKENS.canvas.selectAll,
    });

    registerHotkey({
      hotkey: 'cmd+c',
      scopeId: scopeId(),
      description: 'Copy selection',
      keyDownHandler: () => {
        if (!selection.active()) return false;
        clipboard.copySelection(false);
        return true;
      },
      hotkeyToken: TOKENS.canvas.copy,
    });

    registerHotkey({
      hotkey: 'cmd+x',
      scopeId: scopeId(),
      description: 'Cut selection',
      keyDownHandler: () => {
        if (!selection.active()) return false;
        history.open();
        clipboard.copySelection(true);
        selection.deselectAll();
        history.close();
        nodes.save();
        edges.save();
        return true;
      },
      hotkeyToken: TOKENS.canvas.cut,
    });

    registerHotkey({
      hotkey: 'cmd+v',
      scopeId: scopeId(),
      description: 'Paste',
      keyDownHandler: () => {
        return false;
      },
      hotkeyToken: TOKENS.canvas.paste,
    });

    registerHotkey({
      hotkey: 'cmd+=',
      scopeId: scopeId(),
      description: 'Zoom in',
      keyDownHandler: () => {
        renderState.zoom(0.1, undefined, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.zoomIn,
    });

    registerHotkey({
      hotkey: 'cmd+-',
      scopeId: scopeId(),
      description: 'Zoom out',
      keyDownHandler: () => {
        renderState.zoom(-0.1, undefined, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.zoomOut,
    });

    registerHotkey({
      hotkey: 'cmd+z',
      scopeId: scopeId(),
      description: 'Undo',
      keyDownHandler: () => {
        history.undo();
        return true;
      },
      hotkeyToken: TOKENS.canvas.undo,
    });

    registerHotkey({
      hotkey: ['shift+cmd+z', 'cmd+y'],
      scopeId: scopeId(),
      description: 'Redo',
      keyDownHandler: () => {
        history.redo();
        return true;
      },
      hotkeyToken: TOKENS.canvas.redo,
    });

    registerHotkey({
      hotkey: 'escape',
      scopeId: scopeId(),
      description: 'Cancel/Deselect',
      keyDownHandler: () => {
        toolManager.abortAll();
        selection.deselectAll();
        return true;
      },
      hotkeyToken: TOKENS.canvas.cancel,
    });

    registerHotkey({
      hotkey: 'v',
      scopeId: scopeId(),
      description: 'Select tool',
      keyDownHandler: () => {
        toolManager.setSelectedTool(Tools.Select);
        return true;
      },
      hotkeyToken: TOKENS.canvas.selectTool,
    });

    registerHotkey({
      hotkey: 'h',
      scopeId: scopeId(),
      description: 'Hand tool',
      keyDownHandler: () => {
        toolManager.setSelectedTool(Tools.Grab);
        return true;
      },
      hotkeyToken: TOKENS.canvas.handTool,
    });

    registerHotkey({
      hotkey: 'r',
      scopeId: scopeId(),
      description: 'Shape tool',
      keyDownHandler: () => {
        toolManager.setSelectedTool(Tools.Shape);
        return true;
      },
      hotkeyToken: TOKENS.canvas.shapeTool,
    });

    registerHotkey({
      hotkey: 'p',
      scopeId: scopeId(),
      description: 'Pencil tool',
      keyDownHandler: () => {
        toolManager.setSelectedTool(Tools.Pencil);
        return true;
      },
      hotkeyToken: TOKENS.canvas.pencilTool,
    });

    registerHotkey({
      hotkey: 'x',
      scopeId: scopeId(),
      description: 'Line tool',
      keyDownHandler: () => {
        if (toolManager.selectedTool() === Tools.Line) {
          setConnectorTypeMenuTrigger((prev) => !prev);
        }
        toolManager.setSelectedTool(Tools.Line);
        return true;
      },
      hotkeyToken: TOKENS.canvas.lineTool,
    });

    registerHotkey({
      hotkey: 't',
      scopeId: scopeId(),
      description: 'Text tool',
      keyDownHandler: () => {
        toolManager.setSelectedTool(Tools.Text);
        return true;
      },
      hotkeyToken: TOKENS.canvas.textTool,
    });

    registerHotkey({
      hotkey: 'z',
      scopeId: scopeId(),
      description: 'Zoom in tool',
      keyDownHandler: () => {
        toolManager.setSelectedTool(Tools.ZoomIn);
        return true;
      },
      hotkeyToken: TOKENS.canvas.zoomInTool,
    });

    registerHotkey({
      hotkey: 'opt+z',
      scopeId: scopeId(),
      description: 'Zoom out tool',
      keyDownHandler: () => {
        toolManager.setSelectedTool(Tools.ZoomOut);
        return true;
      },
      hotkeyToken: TOKENS.canvas.zoomOutTool,
    });

    registerHotkey({
      hotkey: 'arrowup',
      scopeId: scopeId(),
      description: 'Nudge up',
      keyDownHandler: () => {
        nudge('up', false, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.nudgeUp,
    });

    registerHotkey({
      hotkey: 'shift+arrowup',
      scopeId: scopeId(),
      description: 'Nudge up more',
      keyDownHandler: () => {
        nudge('up', true, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.nudgeUpMore,
    });

    registerHotkey({
      hotkey: 'arrowright',
      scopeId: scopeId(),
      description: 'Nudge right',
      keyDownHandler: () => {
        nudge('right', false, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.nudgeRight,
    });

    registerHotkey({
      hotkey: 'shift+arrowright',
      scopeId: scopeId(),
      description: 'Nudge right more',
      keyDownHandler: () => {
        nudge('right', true, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.nudgeRightMore,
    });

    registerHotkey({
      hotkey: 'arrowdown',
      scopeId: scopeId(),
      description: 'Nudge down',
      keyDownHandler: () => {
        nudge('down', false, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.nudgeDown,
    });

    registerHotkey({
      hotkey: 'shift+arrowdown',
      scopeId: scopeId(),
      description: 'Nudge down more',
      keyDownHandler: () => {
        nudge('down', true, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.nudgeDownMore,
    });

    registerHotkey({
      hotkey: 'arrowleft',
      scopeId: scopeId(),
      description: 'Nudge left',
      keyDownHandler: () => {
        nudge('left', false, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.nudgeLeft,
    });

    registerHotkey({
      hotkey: 'shift+arrowleft',
      scopeId: scopeId(),
      description: 'Nudge left more',
      keyDownHandler: () => {
        nudge('left', true, true);
        return true;
      },
      hotkeyToken: TOKENS.canvas.nudgeLeftMore,
    });

    registerHotkey({
      hotkey: 'cmd+g',
      scopeId: scopeId(),
      description: 'Group selection',
      keyDownHandler: () => {
        history.open();
        createGroup();
        history.close();
        return true;
      },
      hotkeyToken: TOKENS.canvas.group,
    });

    registerHotkey({
      hotkey: 'shift+cmd+g',
      scopeId: scopeId(),
      description: 'Ungroup selection',
      keyDownHandler: () => {
        history.open();
        deleteGroup();
        history.close();
        return true;
      },
      hotkeyToken: TOKENS.canvas.ungroup,
    });

    let optSetZoom = false;

    registerHotkey({
      hotkey: 'opt',
      scopeId: scopeId(),
      description: 'Zoom in',
      keyDownHandler: () => {
        if (toolManager.selectedTool() === Tools.ZoomIn) {
          toolManager.setSelectedTool(Tools.ZoomOut);
          optSetZoom = true;
          return true;
        }
        return false;
      },
      keyUpHandler: () => {
        if (toolManager.selectedTool() === Tools.ZoomOut && optSetZoom) {
          toolManager.setSelectedTool(Tools.ZoomIn);
          optSetZoom = false;
        }
      },
      hotkeyToken: TOKENS.canvas.optZoom,
    });

    let spaceKeyGrab = false;
    let toolBeforeSpaceGrab: Tool = Tools.Grab;

    registerHotkey({
      hotkey: 'space',
      scopeId: scopeId(),
      description: 'Temporary grab tool',
      keyDownHandler: (e) => {
        if (e?.repeat) return false;
        if (!spaceKeyGrab) toolBeforeSpaceGrab = toolManager.selectedTool();
        toolManager.setSelectedTool(Tools.Grab);
        spaceKeyGrab = true;
        return true;
      },
      keyUpHandler: () => {
        if (
          toolManager.selectedTool() === Tools.Grab &&
          spaceKeyGrab &&
          !middleMousePressed()
        ) {
          const handlers = handlersByTool().get(Tools.Grab);
          if (handlers) {
            for (const handler of handlers) {
              handler.abort();
            }
          }
          toolManager.setSelectedTool(toolBeforeSpaceGrab);
          toolBeforeSpaceGrab = toolManager.selectedTool();
          spaceKeyGrab = false;
        }
      },
      hotkeyToken: TOKENS.canvas.spaceGrab,
    });
  });

  createEffect(
    on(domRect, (_) => {
      if (!ref()) return;
      renderState.setDomRect(ref()!.getBoundingClientRect());
    })
  );

  const pasteHandler = (e: ClipboardEvent) => {
    // The clipboard paste handler manages its own history state.
    e.preventDefault();
    clipboard.handlePaste({
      event: e,
    });
  };

  onMount(() => {
    toolManager.mount(ref()!);
    ref()!.addEventListener('paste', pasteHandler);
  });

  onCleanup(() => {
    toolManager.cleanup();
    ref()!.removeEventListener('paste', pasteHandler);
  });

  const [isDragging, setIsDragging] = createSignal(false);
  const [dragPosition, setDragPosition] = createSignal<Vector2>();
  const { handleMouseUp, handleFileDrop } = useCanvasFileDrop();
  const { setSelectedTool } = useToolManager();
  const { viewBox, clientToCanvas } = useRenderState();
  const centerVec = createMemo(() => {
    return vec2(viewBox().x + viewBox().w / 2, viewBox().y + viewBox().h / 2);
  });
  const { track, TrackingEvents } = withAnalytics();
  const highestOrder = highestOrderSignal.get;

  const droppable = createDroppable('canvas-input-' + _id);
  const [dragDropState, { onDragEnd, onDragMove }] = useDragDropContext() ?? [
    undefined,
    {
      onDragEnd: () => {},
      onDragMove: () => {},
    },
  ];

  const wrapDndEvent = (event: DragEventWithData) => {
    const currentPos = dragDropState?.active.sensor?.coordinates?.current;
    if (!currentPos) return;
    const mousePos = {
      clientX: currentPos.x,
      clientY: currentPos.y,
    };
    const item = event.draggable.data;
    const blockName = fileTypeToBlockName(item.fileType ?? item.type);
    if (!blockName) return;
    return {
      id: event.draggable.data.id as string,
      blockName: blockName as BlockName,
      mousePos,
      item,
    };
  };

  const attachImageOnDrag = (event: DragEventWithData) => {
    if (!event.droppable) return;
    track(TrackingEvents.BLOCKCANVAS.IMAGES.DSSIMAGE, {
      method: 'drag from sidebar',
    });
    nodes.createNode(
      {
        type: 'image',
        status: 'dss',
        uuid: event.draggable.data.id.toString(),
        x: dragPosition()?.x ?? centerVec().x,
        y: dragPosition()?.y ?? centerVec().y,
        width: 0,
        height: 0,
        edges: [],
        style: { strokeColor: 'transparent' },
        flipX: false,
        flipY: false,
        layer: 0,
        sortOrder: highestOrder() + 1,
      },
      { autosave: true }
    );
    setSelectedTool(Tools.Select);
  };

  const attachVideoOnDrag = (event: DragEventWithData) => {
    if (!event.droppable) return;
    track(TrackingEvents.BLOCKCANVAS.VIDEOS.DSSVIDEO, {
      method: 'drag from sidebar',
    });

    nodes.createNode(
      {
        type: 'video',
        status: 'dss',
        uuid: event.draggable.data.id.toString(),
        x: dragPosition()?.x ?? centerVec().x,
        y: dragPosition()?.y ?? centerVec().y,
        width: 0,
        height: 0,
        edges: [],
        style: { strokeColor: 'transparent' },
        flipX: false,
        flipY: false,
        layer: 0,
        sortOrder: highestOrder() + 1,
      },
      { autosave: true }
    );

    setSelectedTool(Tools.Move);
  };

  const attachFileOnDrag = async (
    event: DragEventWithData,
    id: string,
    isChat = false,
    isRss = false,
    isProject = false
  ) => {
    if (!event.droppable) return;
    track(TrackingEvents.BLOCKCANVAS.FILES.SIDEBARDND);

    // Track document mention and get UUID
    let mentionUuid: string | undefined;
    if (blockId && !isChat && !isRss) {
      mentionUuid = await trackMention(blockId, 'document', id);
    }

    nodes.createNode(
      {
        type: 'file',
        file: id,
        isChat,
        isRss,
        isProject,
        mentionUuid,
        x: (dragPosition()?.x ?? centerVec().x) - fileWidth / 2,
        y: (dragPosition()?.y ?? centerVec().y) - fileHeight / 2,
        width: fileWidth,
        height: fileHeight,
        edges: [],
        style: { strokeColor: 'transparent' },
        layer: 0,
        sortOrder: highestOrder() + 1,
      },
      { autosave: true }
    );

    setSelectedTool(Tools.Select);
  };

  const dndDragMove = throttle((event: DragEventWithData) => {
    if (!droppable.isActiveDroppable) {
      setDragPosition();
      return;
    }
    const res = wrapDndEvent(event);
    if (!res) return;
    const { mousePos } = res;
    setDragPosition(clientToCanvas(mousePos));
  }, 60);

  const dndDragEnd = (event: DragEventWithData) => {
    if (!dragPosition()) return;
    if (!canEdit()) return;

    const res = wrapDndEvent(event);
    if (!res) return;
    const position = dragPosition();

    if (res.blockName === undefined) return;
    if (!position) return;

    if (res.blockName === 'image') {
      attachImageOnDrag(event);
    } else if (res.blockName === 'video' && ENABLE_CANVAS_VIDEO) {
      attachVideoOnDrag(event);
    } else if (res.blockName === 'chat') {
      attachFileOnDrag(event, res.id, true, false);
    } else if (res.blockName === 'project') {
      attachFileOnDrag(event, res.id, false, false, true);
    } else {
      attachFileOnDrag(event, res.id, false, false);
    }
  };

  onDragEnd((event) => {
    if (event.droppable?.id !== 'canvas-input-' + _id) return;
    dndDragEnd(event as DragEventWithData);
  });

  onDragMove((event) => {
    dndDragMove(event as DragEventWithData);
  });

  const [_mouseDownPos, setMouseDownPos] = mouseDownPositionSignal;

  // TODO (seamus) : Make a beter interface with the gesute library.
  const pinch = usePinch(
    ({ origin, delta, last, event, offset }) => {
      if (event.type === 'wheel') return;
      event.preventDefault();

      setMouseDownPos();

      const [scale] = offset;
      const previousScale = scale - delta[0];
      const zoomFactor = scale / previousScale - 1;

      const client = { clientX: origin[0], clientY: origin[1] };

      renderState.zoom(zoomFactor, client, last);
    },
    {
      pointer: { touch: true },
    }
  );

  const {
    openContextMenu,
    closeContextMenu,
    ContextMenu,
    contextMenuPos,
    menuRef,
  } = createContextMenu(ref);
  const openContextMenuHandler: JSX.EventHandler<HTMLElement, MouseEvent> = (
    e
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = e;
    openContextMenu({ x, y });
  };

  return (
    <div
      data-visual-editor={true} // Attach this attr for the cross-block focus logic
      {...pinch()}
      style={{
        'touch-action': 'none',
      }}
      ref={setRef}
      tabIndex={0}
      use:droppable={!isDisabled()}
      use:observedSize={{ setSize: setDomRect }}
      // SCUFFED THEMING? The color-mix below is a little rough, not necessarily ideal
      class={`relative w-full h-full overflow-hidden z-0 ${cursor()} bg-[oklch(from_color-mix(in_oklch,var(--color-panel)_75%,var(--color-ink)_25%)_l_0_var(--surface-h))]`}
      use:fileDrop={{
        disabled: isDisabled(),
        acceptedMimeTypes: acceptedMimeTypes,
        acceptedFileExtensions: acceptedFileExtensions,
        onDragStart: () => setIsDragging(true),
        onDragEnd: () => setIsDragging(false),
        onDrop: (files) => {
          track(TrackingEvents.BLOCKCANVAS.IMAGES.STATICIMAGE, {
            method: 'drag to canvas',
          });
          handleFileDrop(files);
        },
        onMouseUp: handleMouseUp,
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isDisabled()) return;
        setMouseDownPos();
        openContextMenuHandler(e);
      }}
    >
      <ContextMenu>
        <OldMenuItem
          text="Cut"
          iconClass="text-ink-extra-muted"
          icon={Scissors}
          onClick={() => {
            history.open();
            clipboard.copySelection(true);
            selection.deselectAll();
            history.close();
            nodes.save();
            edges.save();
            closeContextMenu();
          }}
          hotkey={<BasicHotkey token={'canvas.cut'} />}
          disabled={!selection.active()}
        />
        <OldMenuItem
          text="Copy"
          iconClass="text-ink-extra-muted"
          icon={CopySimple}
          onClick={() => {
            clipboard.copySelection(false);
            closeContextMenu();
          }}
          hotkey={<BasicHotkey token={'canvas.copy'} />}
          disabled={!selection.active()}
        />
        <OldMenuItem
          text="Paste"
          iconClass="text-ink-extra-muted"
          icon={Clipboard}
          onClick={() => {
            const menuPos = contextMenuPos();
            history.open();
            clipboard.handlePaste({
              position: clientToCanvas({
                clientX: menuPos.x,
                clientY: menuPos.y,
              }),
            });
            history.close();
            nodes.save();
            edges.save();
            closeContextMenu();
          }}
          hotkey={<BasicHotkey token={'canvas.paste'} />}
        />
        <OldMenuItem
          text="Delete"
          iconClass="text-ink-extra-muted"
          icon={TrashSimple}
          onClick={() => {
            deleteSelection();
            closeContextMenu();
          }}
          hotkey={<BasicHotkey token={'canvas.delete'} />}
          disabled={!selection.active()}
        />
        <Show when={selection.active()}>
          <OldMenuItem
            spacerTop={true}
            text="Change order"
            iconClass="text-ink-extra-muted"
            icon={Stack}
            chevron={true}
            menuRef={menuRef()}
            submenu={
              <OldMenu width="md">
                <OldMenuItem
                  text="Bring forward"
                  iconClass="text-ink-extra-muted"
                  icon={StackPlus}
                  onClick={() => {
                    reorder.reorder(ReorderOperations.Forward, true);
                    closeContextMenu();
                  }}
                  hotkey={<BasicHotkey token={'canvas.bringForward'} />}
                />
                <OldMenuItem
                  text="Send backward"
                  iconClass="text-ink-extra-muted"
                  icon={StackMinus}
                  onClick={() => {
                    reorder.reorder(ReorderOperations.Backward, true);
                    closeContextMenu();
                  }}
                  hotkey={<BasicHotkey token={'canvas.sendBackward'} />}
                />
                <OldMenuItem
                  text="Bring to front"
                  iconClass="text-ink-extra-muted"
                  icon={SelectionBackground}
                  onClick={() => {
                    reorder.reorder(ReorderOperations.BringToFront, true);
                    closeContextMenu();
                  }}
                  hotkey={<BasicHotkey token={'canvas.bringToFront'} />}
                />
                <OldMenuItem
                  text="Send to back"
                  iconClass="text-ink-extra-muted"
                  icon={SelectionForeground}
                  onClick={() => {
                    reorder.reorder(ReorderOperations.SendToBack, true);
                    closeContextMenu();
                  }}
                  hotkey={<BasicHotkey token={'canvas.sendToBack'} />}
                />
              </OldMenu>
            }
          />
          <OldMenuItem
            text="Group"
            iconClass="text-ink-extra-muted"
            icon={GridFour}
            onClick={() => {
              history.open();
              createGroup();
              history.close();
              closeContextMenu();
            }}
          />
          <OldMenuItem
            text="Ungroup"
            iconClass="text-ink-extra-muted"
            icon={SquaresFour}
            onClick={() => {
              history.open();
              deleteGroup();
              history.close();
              closeContextMenu();
            }}
          />
          {/*  <OldMenuItem
            text="Center on screen"
            icon={() => <GpsFix class="text-ink-extra-muted" />}
            chevron={true}
            submenu={
              <Menu width="md">
                <OldMenuItem
                  text="Center horizontally"
                  icon={() => <DotsThreeOutline class="text-ink-extra-muted" />}
                  onClick={() => {

                    closeContextMenu();
                  }}
                />
                <OldMenuItem
                  text="Center vertically"
                  icon={() => (
                    <DotsThreeOutlineVertical class="text-ink-extra-muted" />
                  )}
                  onClick={() => {

                    closeContextMenu();
                  }}
                />
                <OldMenuItem
                  text="Center both"
                  icon={() => <DotOutline class="text-ink-muted" />}
                  onClick={() => {

                    closeContextMenu();
                  }}
                />
              </Menu>
            }
          /> */}
        </Show>
      </ContextMenu>
      <Show when={isDragging() || droppable.isActiveDroppable}>
        <FileDropOverlay valid={true}>
          <div class="font-mono">
            Drop any file here to add it to your canvas
          </div>
        </FileDropOverlay>
      </Show>
      {props.children}
    </div>
  );
}
