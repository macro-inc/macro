import { Tools } from '@block-canvas/constants';
import type {
  CanvasEntityStyle,
  ShapeType,
} from '@block-canvas/model/CanvasModel';
import {
  highestOrderSignal,
  useCanvasNodes,
} from '@block-canvas/store/canvasData';
import { useRenderState } from '@block-canvas/store/RenderState';
import {
  parseScale,
  parseTranslate,
  svgEntityStyles,
} from '@block-canvas/util/svg';
import { type Vector2, vec2 } from '@block-canvas/util/vector2';
import { withAnalytics } from '@coparse/analytics';
import { createBlockSignal } from '@core/block';
import { CANVAS_SVG_IMPORT } from '@core/constant/featureFlags';
import { uploadFile } from '@core/util/upload';
import { toast } from 'core/component/Toast/Toast';
import { nanoid } from 'nanoid';
import { createSignal } from 'solid-js';
import { getTextNodeHeight } from '../util/style';
import { useCachedStyle } from './cachedStyle';
import { useCanvasHistory } from './canvasHistory';
import { useToolManager } from './toolManager';

export const canvasDraggingSignal = createBlockSignal(false);

export const useCanvasFileDrop = () => {
  const [fileDropPos, setFileDropPos] = createSignal(vec2(0, 0));
  const { clientToCanvas } = useRenderState();
  const nodes = useCanvasNodes();
  const { setSelectedTool } = useToolManager();
  const { track, TrackingEvents } = withAnalytics();
  const highestOrder = highestOrderSignal.get;
  const history = useCanvasHistory();

  const cachedStyle = useCachedStyle();
  const style = cachedStyle.getStyle;
  const height = getTextNodeHeight(style().fontSize);

  const createTextNode = (
    text: string,
    position: Vector2,
    styleOverrides: Partial<CanvasEntityStyle>
  ) => {
    history.open();
    const id = nanoid(8);
    nodes.setLastCreated(id);
    nodes.createNode(
      {
        id,
        type: 'text',
        x: position.x,
        y: position.y,
        width: 0,
        height,
        edges: [],
        style: {
          ...style(),
          ...styleOverrides,
          importedColor: true,
        },
        text,
        followTextWidth: true,
        layer: 0,
        sortOrder: highestOrder() + 1,
      },
      { autosave: true }
    );
    history.close();
  };

  const createShapeNode = (
    position: Vector2,
    width: number,
    height: number,
    styleOverrides: Partial<CanvasEntityStyle>,
    shapeType: ShapeType
  ) => {
    history.open();
    const id = nanoid(8);
    nodes.setLastCreated(id);
    nodes.createNode(
      {
        id,
        type: 'shape',
        x: position.x,
        y: position.y,
        width,
        height,
        edges: [],
        style: {
          ...style(),
          ...styleOverrides,
          importedColor: true,
        },
        layer: 0,
        sortOrder: highestOrder() + 1,
        shape: shapeType,
      },
      { autosave: true }
    );
    history.close();
  };

  const parseSVGStringToNodes = (svg: string, position: Vector2) => {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svg, 'image/svg+xml');
    parseSVGDocToNodes(svgDoc, {}, position);
  };

  const parseSVGDocToNodes = (
    svg: Document | Element,
    styleContext: Partial<CanvasEntityStyle>,
    offset: Vector2 = vec2(0, 0),
    scale: number = 1.0,
    width: number = 0,
    height: number = 0
  ) => {
    for (const child of svg.children) {
      const el = child as Element;
      let elOffset = offset.clone();
      let elScale = scale;
      const newStyleContext = { ...styleContext };

      const transform = el.getAttribute('transform');
      if (transform) {
        elOffset = elOffset.add(parseTranslate(transform).multiply(scale));
        elScale *= parseScale(transform);
      }

      for (const styleEntry of svgEntityStyles) {
        let val: any = el.getAttribute(styleEntry.svgAttribute);
        if (val) {
          if (val && styleEntry.type === 'number') {
            val = parseInt(val);
            if (styleEntry.applyScale) {
              val *= elScale;
            }
          }
          newStyleContext[styleEntry.styleProperty] = val;
        }
      }

      const x = parseInt(el.getAttribute('x') || '0');
      const y = parseInt(el.getAttribute('y') || '0');
      elOffset = elOffset.add(vec2(x, y).multiply(scale));

      const newWidth = el.getAttribute('width');
      const newHeight = el.getAttribute('height');
      if (newWidth) {
        width = newWidth.includes('%')
          ? width * parseInt(newWidth) * 0.01
          : parseInt(newWidth);
      }
      if (newHeight) {
        height = newHeight.includes('%')
          ? height * parseInt(newHeight) * 0.01
          : parseInt(newHeight);
      }

      if (el.tagName === 'text') {
        createTextNode(el.textContent || '', elOffset, {
          ...newStyleContext,
          strokeColor: newStyleContext.fillColor,
        });
      }

      if (el.tagName === 'rect') {
        createShapeNode(elOffset, width, height, newStyleContext, 'rectangle');
      }

      if (el.tagName === 'ellipse') {
        const rx = parseInt(el.getAttribute('rx') || '0');
        const ry = parseInt(el.getAttribute('ry') || '0');
        const cx = parseInt(el.getAttribute('cx') || '0');
        const cy = parseInt(el.getAttribute('cy') || '0');
        elOffset = elOffset.add(vec2(cx, cy));
        if (rx && ry) {
          elOffset = elOffset.subtract(vec2(rx, ry));
          createShapeNode(elOffset, rx * 2, ry * 2, newStyleContext, 'ellipse');
        }
      }
      parseSVGDocToNodes(
        el,
        { ...newStyleContext },
        elOffset,
        elScale,
        width,
        height
      );
    }
  };

  const staticImageUpload = async (blob: File | Blob, position: Vector2) => {
    const url = URL.createObjectURL(blob);
    const loadingNode = nodes.createNode({
      type: 'image',
      status: 'loading',
      uuid: url,
      x: position.x,
      y: position.y,
      width: 0,
      height: 0,
      edges: [],
      style: { strokeColor: 'transparent' },
      flipX: false,
      flipY: false,
      layer: 0,
      sortOrder: highestOrder() + 1,
    });
    setSelectedTool(Tools.Select);

    try {
      const file =
        blob instanceof File
          ? blob
          : new File([blob], 'pastedCanvasImage', { type: blob.type });

      const result = await uploadFile(file, 'static', {
        hideProgressIndicator: true,
      });

      if (!result.failed) {
        nodes.updateNode(
          loadingNode.id,
          {
            status: 'static',
            uuid: result.id,
          },
          { autosave: true }
        );
      } else {
        throw result.error;
      }
    } catch (_error) {
      track(TrackingEvents.BLOCKCANVAS.IMAGES.STATICFAILURE, {
        error: 'failed uploading image',
      });
      toast.failure('Failed to upload image');
      nodes.delete(loadingNode.id, { autosave: true });
    }
  };

  return {
    handleMouseUp: (x: number, y: number) => {
      setFileDropPos(clientToCanvas({ clientX: x, clientY: y }));
    },
    handleFileDrop: async (files: File[], pos?: Vector2) => {
      const file = files[0];
      if (!file) {
        toast.failure('Invalid file');
        return;
      }
      const position = vec2(
        pos ? pos.x : fileDropPos().x,
        pos ? pos.y : fileDropPos().y
      );
      if (CANVAS_SVG_IMPORT && file.type === 'image/svg+xml') {
        const reader = new FileReader();
        reader.onloadend = (readerEvent) => {
          if (readerEvent.target?.result) {
            const svgString = readerEvent.target.result.toString();
            parseSVGStringToNodes(svgString, position);
          }
        };
        reader.readAsText(file);
        return;
      }
      staticImageUpload(file, position);
    },
    staticImageUpload,
    parseSVGStringToNodes,
  };
};
