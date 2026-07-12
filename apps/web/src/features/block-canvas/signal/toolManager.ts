import { contextMenuStore } from '@block-canvas/component/ContextMenu';
import { clamp, lerp, remap } from '@block-canvas/util/math';
import { getTextNodeHeight } from '@block-canvas/util/style';
import { createBlockSignal, useIsNestedBlock } from '@core/block';
import { IS_MAC } from '@core/constant/isMac';
import { useCanEdit } from '@core/signal/permissions';
import { isEditableInput } from '@core/util/isEditableInput';
import { createCallback } from '@solid-primitives/rootless';
import { pressedKeys } from 'core/hotkey/state';
import { nanoid } from 'nanoid';
import { createMemo, createSignal } from 'solid-js';
import { DRAG_THRESHOLD, type Tool, Tools, ViewOnlyTools } from '../constants';
import type { Operator } from '../operation/operation';
import { highestOrderSignal, useCanvasNodes } from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { sharedInstance } from '../util/sharedInstance';
import { type Vector2, vec2 } from '../util/vector2';
import { useCachedStyle } from './cachedStyle';
import { useCanvasHistory } from './canvasHistory';
import { useSelection } from './selection';

export type DispatchMouseArgs = {
  tool: Tool;
  action: 'start' | 'preview' | 'commit';
  e: PointerEvent;
  args: any[];
};

export const selectedToolSignal = createBlockSignal<Tool>(Tools.Grab);
export const pressedModifiersSignal = createBlockSignal<Set<string>>(new Set());

export const handlersByToolSignal = createBlockSignal<Map<Tool, Operator[]>>(
  new Map()
);

export const mouseDownPositionSignal = createBlockSignal<Vector2>();
export const mousePositionSignal = createBlockSignal<Vector2>();
export const lastMousePositionSignal = createBlockSignal<Vector2>();
export const rawMouseDownPositionSignal = createBlockSignal<Vector2>();
export const activeTextEditorSignal = createBlockSignal<boolean>(false);

export const middleMousePressedSignal = createBlockSignal<boolean>();
export const rightMousePressedSignal = createBlockSignal<boolean>();

export const useToolManager = sharedInstance<ToolManager>(createToolManager);

function createToolManager() {
  const canEdit = useCanEdit();
  const isNestedBlock = useIsNestedBlock();
  const [selectedTool, setTool] = selectedToolSignal;
  const [mouseDownPos, setMouseDownPos] = mouseDownPositionSignal;
  const [handlersByTool, setHandlersByTool] = handlersByToolSignal;
  const [middleMousePressed, setMiddleMousePressed] = middleMousePressedSignal;
  const [mousePosition, setMousePosition] = mousePositionSignal;
  const [lastMousePosition, setLastMousePosition] = lastMousePositionSignal;
  const [rawMouseDownPos, setRawMouseDownPos] = rawMouseDownPositionSignal;
  const [isDragging, setIsDragging] = createSignal(false);
  const [activeTextEditor, setActiveTextEditor] = activeTextEditorSignal;
  const [_previousTouch, setPreviousTouch] = createSignal<Vector2>();

  const { clientToCanvas, zoom, pan } = useRenderState();
  const selection = useSelection();
  const history = useCanvasHistory();
  const highestOrder = highestOrderSignal.get;

  const ignoreTargets: HTMLElement[] = [];

  const nodes = useCanvasNodes();
  const cachedStyle = useCachedStyle();
  const style = cachedStyle.getStyle;

  setMousePosition(vec2(0, 0));
  setLastMousePosition(vec2(0, 0));

  let containerRef: HTMLElement | undefined;

  let mouseMovedInDoubleClick = false;

  const canUseTool = createCallback((tool: Tool) => {
    return canEdit() || ViewOnlyTools.indexOf(tool) > -1;
  });

  const activeTool = createMemo(() => {
    const tool = selectedTool();
    if (middleMousePressed()) {
      return Tools.Grab;
    }

    if (activeTextEditor()) return Tools.Typing;

    // Any override that is not grab or zoom should be checked for canUseTool(Tool.ToolName)
    return tool ?? Tools.Grab;
  });

  function ignore(e: PointerEvent | MouseEvent) {
    const shouldIgnore = ignoreTargets.some((el) =>
      el?.contains(e.target as Node)
    );
    return shouldIgnore;
  }

  // @ts-ignore waiting to ship touch events until they feel more stable
  function _touchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    setPreviousTouch(
      vec2(e.changedTouches[0].clientX, e.changedTouches[0].clientY)
    );
  }

  // @ts-ignore waiting to ship touch events until they feel more stable
  function _touchMove(e: TouchEvent) {
    if (e.changedTouches.length !== 1) {
      setPreviousTouch();
      return;
    }
    const currentPos = vec2(
      e.changedTouches[0].clientX,
      e.changedTouches[0].clientY
    );
    setPreviousTouch(currentPos);
  }

  const contextMenu = contextMenuStore.get;

  function pointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      if (e.button === 1) setMiddleMousePressed(true);
      if (
        (e.button !== 0 ||
          (IS_MAC && pressedKeys().has('ctrl') && pressedKeys().size === 1) ||
          contextMenu.open) &&
        e.button !== 1
      )
        return;
    }

    if (ignore(e)) return;
    setMousePosition(vec2(e.pageX, e.pageY));
    setRawMouseDownPos(vec2(e.pageX, e.pageY));
    const tool = activeTool();

    if (e.target === containerRef && tool !== Tools.Grab) {
      selection.stash();
      selection.deselectAll();
    }

    const handlers = handlersByTool().get(tool);
    if (!handlers) return;
    if (!mouseDownPos()) {
      for (const handler of handlers) {
        handler.start(e);
      }
    } else {
      for (const handler of handlers) {
        handler.abort();
      }
    }

    setMouseDownPos(vec2(e.pageX, e.pageY));
    mouseMovedInDoubleClick = false;
  }

  function pointerMove(e: PointerEvent) {
    setMousePosition(vec2(e.pageX, e.pageY));
    if (rawMouseDownPos()) {
      if (mousePosition()!.distance(rawMouseDownPos()!) > DRAG_THRESHOLD) {
        mouseMovedInDoubleClick = true;
        setIsDragging(true);
      }
    }
    const tool = activeTool();
    const handlers = handlersByTool().get(tool) ?? [];
    for (const handler of handlers) {
      handler.preview(e);
    }
    setLastMousePosition(vec2(e.pageX, e.pageY));
  }

  function pointerUp(e: PointerEvent) {
    setMousePosition(vec2(e.pageX, e.pageY));
    setMouseDownPos();
    setRawMouseDownPos();
    setIsDragging(false);

    const tool = activeTool();
    const handlers = handlersByTool().get(tool);
    if (!handlers) return;
    for (const handler of handlers) {
      if (ignore(e)) {
        handler.abort();
      } else {
        handler.commit(e);
      }
    }

    if (e.pointerType === 'mouse') {
      if (e.button === 1) setMiddleMousePressed(false);
    }
    setPreviousTouch();
  }

  function _pointerEnter() {
    if (activeTextEditor()) return;
    const activeElement = document.activeElement;

    if (activeElement === null || !(activeElement instanceof HTMLElement)) {
      containerRef?.focus();
      return;
    }

    // Editable inputs take take precedence over the canvas.
    if (isEditableInput(activeElement)) {
      return;
    }
    containerRef?.focus();
  }

  function dblClick(e: MouseEvent) {
    if (ignore(e)) return;
    if (mouseMovedInDoubleClick) {
      mouseMovedInDoubleClick = false;
      return;
    }
    const tool = activeTool();
    const mousePos = clientToCanvas(e);
    if (tool === Tools.Select) {
      setTool(Tools.Text);
      const id = nanoid(8);
      const height = getTextNodeHeight(style().fontSize);
      nodes.setLastCreated(id);
      history.open();
      nodes.createNode(
        {
          id,
          type: 'text',
          x: mousePos.x - height / 8,
          y: mousePos.y - height / 2,
          width: 0,
          height,
          edges: [],
          style: style(),
          text: '',
          followTextWidth: true,
          layer: 0,
          sortOrder: highestOrder() + 1,
        },
        { autosave: true }
      );
      history.close();
    }
  }

  function createScrollCurve(params: {
    deltaRange: Vector2;
    velocityRange: Vector2;
  }) {
    let lastEventTime = Date.now();
    let lastDelta = 0;
    let lastSpeed = 0;
    const { deltaRange, velocityRange } = params;

    return (inputDelta: number, scale: number) => {
      const now = Date.now();
      const deltaTime = Math.max(1, now - lastEventTime) / 1000;

      let speed = clamp(
        Math.abs(inputDelta - lastDelta) / deltaTime,
        velocityRange.x,
        velocityRange.y
      );

      const clampedDelta = clamp(
        Math.abs(inputDelta),
        deltaRange.x,
        deltaRange.y
      );
      const normalizedDelta = remap(
        clampedDelta,
        deltaRange.x,
        deltaRange.y,
        0,
        1
      );
      const curvedDelta = Math.pow(normalizedDelta, 0.3);
      const deltaFactor = remap(curvedDelta, 0, 1, deltaRange.x, deltaRange.y);
      const speedFactor = lerp(speed, lastSpeed, 0.1);
      const output = deltaFactor * speedFactor * scale * Math.sign(inputDelta);

      lastEventTime = now;
      lastDelta = inputDelta;
      lastSpeed = speed;

      return output;
    };
  }

  const scaleScroll = createScrollCurve({
    deltaRange: vec2(0, 100),
    velocityRange: vec2(0, 3),
  });

  function scroll(e: WheelEvent) {
    if (ignore(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey) {
      const s = scaleScroll(e.deltaY, -0.0005);
      zoom(s, e, true);
    } else {
      pan(-e.deltaX, -e.deltaY, true);
    }
  }

  return {
    selectedTool,
    setSelectedTool(tool: Tool) {
      if (activeTextEditor()) {
        if (tool !== Tools.Typing) containerRef?.focus();
      }
      if (canUseTool(tool)) {
        setTool(tool);
      }
    },
    mouseDownPos,

    activeTool,

    isDragging,

    registerMouseTool(tool: Tool, operator: Operator) {
      let cloned = handlersByTool();
      let handlers = cloned.get(tool);
      if (handlers) {
        handlers.push(operator);
      } else {
        handlers = [operator];
      }
      cloned.set(tool, handlers);
      setHandlersByTool(cloned);
    },

    mount(ref: HTMLElement) {
      containerRef = ref;
      containerRef.addEventListener('pointerdown', pointerDown);
      document.addEventListener('pointermove', pointerMove);
      document.addEventListener('pointerup', pointerUp);
      // NOTE (seamus) In the new split designs, this is absurdly distracting
      // containerRef.addEventListener('pointerenter', pointerEnter);
      containerRef.addEventListener('dblclick', dblClick);

      if (!isNestedBlock) {
        containerRef.addEventListener('wheel', scroll, { passive: false });
      }
    },

    cleanup() {
      containerRef?.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('pointermove', pointerMove);
      document.removeEventListener('pointerup', pointerUp);
      // NOTE (seamus) In the new split designs, this is absurdly distracting
      // containerRef?.removeEventListener('pointerenter', pointerEnter);
      containerRef?.removeEventListener('dblclick', dblClick);

      if (!isNestedBlock) {
        containerRef?.removeEventListener('wheel', scroll);
      }
    },

    dispatch(
      tool: Tool,
      action: keyof Operator,
      e: PointerEvent,
      ...args: any[]
    ) {
      const handlers = handlersByTool().get(tool);
      if (!handlers) return;
      for (const handler of handlers) {
        handler[action](e, ...args);
      }
    },

    abortAll() {
      const handlers = handlersByTool();
      for (const [, operators] of handlers) {
        for (const operator of operators) {
          operator.abort();
        }
      }
    },

    ignoreMouseEvents(el: HTMLElement) {
      ignoreTargets.push(el);
    },
    removeIgnoreMouseEvents(el: HTMLElement) {
      ignoreTargets.splice(ignoreTargets.indexOf(el));
    },
    ignore,

    setActiveTextEditor,
    activeTextEditor,
    mousePosition: () => mousePosition() ?? vec2(0, 0),
    lastMousePosition: () => lastMousePosition() ?? vec2(0, 0),
    safeMouseDelta: () => vec2(1, 1),
    mouseIsDown: () => !!mouseDownPos(),
    focusCanvas: () => {
      setTimeout(() => {
        containerRef?.focus();
      }, 0);
    },
  };
}

export type ToolManager = ReturnType<typeof createToolManager>;
