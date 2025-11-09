import { sharedInstance } from '@block-canvas/util/sharedInstance';
import { getTextNodeHeight } from '@block-canvas/util/style';
import { withAnalytics } from '@coparse/analytics';
import { jsonToXML } from '@core/component/LexicalMarkdown/citationsUtils';
import { parseMacroAppUrl } from '@core/component/LexicalMarkdown/plugins';
import { blockNameToFileExtensions } from '@core/constant/allBlocks';
import { CANVAS_SVG_IMPORT } from '@core/constant/featureFlags';
import { nanoid } from 'nanoid';
import { batch } from 'solid-js';
import {
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  CanvasSchema,
} from '../model/CanvasModel';
import {
  highestOrderSignal,
  useBoundingBox,
  useCanvasEdges,
  useCanvasGroups,
  useCanvasNodes,
} from '../store/canvasData';
import { useRenderState } from '../store/RenderState';
import { Rect } from '../util/rectangle';
import { type Vector2, vec2 } from '../util/vector2';
import { useCachedStyle } from './cachedStyle';
import { useCanvasHistory } from './canvasHistory';
import { useCanvasFileDrop } from './fileDrop';
import { useSelection } from './selection';
import { useToolManager } from './toolManager';

export const useClipboard = sharedInstance(() => {
  const {
    selectedNodeIds,
    selectedEdgeIds,
    active,
    forceSetSelection,
    deselectAll,
  } = useSelection();
  const nodes = useCanvasNodes();
  const edges = useCanvasEdges();
  const groups = useCanvasGroups();
  const highestOrder = highestOrderSignal.get;
  const history = useCanvasHistory();
  const { track, TrackingEvents } = withAnalytics();
  const { staticImageUpload, parseSVGStringToNodes } = useCanvasFileDrop();
  const boundingBox = useBoundingBox();
  const { activeTextEditor } = useToolManager();

  const cachedStyle = useCachedStyle();
  const style = cachedStyle.getStyle;

  const { currentPosition, currentScale, viewBox } = useRenderState();

  const checkForMacroUrl = (text: string): string => {
    const parsedMacroAppUrl = parseMacroAppUrl(text);
    if (
      !parsedMacroAppUrl.isValid ||
      !parsedMacroAppUrl.id ||
      !parsedMacroAppUrl.block
    ) {
      return text;
    }

    return jsonToXML('m-document-mention', {
      documentId: parsedMacroAppUrl.id,
      blockName: parsedMacroAppUrl.block,
      documentName: '',
      blockParams: parsedMacroAppUrl.params,
    });
  };

  const pasteCanvas = (copiedText: string, position?: Vector2) => {
    if (activeTextEditor()) return;

    const json = JSON.parse(copiedText);
    const canvasData = CanvasSchema.parse(json);
    const pastedNodes = (canvasData.nodes ?? []) as CanvasNode[];
    const pastedEdges = (canvasData.edges ?? []) as CanvasEdge[];
    const groupMap = new Map();

    // todo: throw or return if not valid parse;
    if (pastedNodes.length === 0 && pastedEdges.length === 0) return;

    const freeEdges = pastedEdges.filter(
      (edge) => edge.from.type === 'free' || edge.to.type === 'free'
    );
    const originalBounds = boundingBox(pastedNodes, freeEdges);
    const pasteCenter = position ?? originalBounds.center;
    let offset = vec2(10, 10);

    if (!viewBox().containsPoint(pasteCenter)) {
      offset = currentPosition()
        .multiply(-1 / currentScale())
        .subtract(pasteCenter);
    }

    const updatedIds = new Map<string, string>();

    if (position) {
      const freeEdges = pastedEdges.filter(
        (edge) => edge.from.type === 'free' || edge.to.type === 'free'
      );
      const bounds = boundingBox(pastedNodes, freeEdges);
      const widthOffset = position.x - bounds.x - bounds.width / 2;
      const heightOffset = position.y - bounds.y - bounds.height / 2;

      pastedNodes.forEach((node) => {
        const newId = nanoid(8);
        node.x += widthOffset;
        node.y += heightOffset;
        updatedIds.set(node.id, newId);
        node.id = newId;
        if (node.groupId) {
          if (groupMap.has(node.groupId)) {
            node.groupId = groupMap.get(node.groupId);
            groups.addNode(node.groupId!, newId);
          } else {
            const newGroupId = nanoid(8);
            groupMap.set(node.groupId, newGroupId);
            node.groupId = newGroupId;
            groups.createGroup(
              newGroupId,
              highestOrder() + 1,
              node.layer,
              [newId],
              []
            );
          }
        }
      });
      pastedEdges.forEach((edge) => {
        const newId = nanoid(8);
        updatedIds.set(edge.id, newId);
        edge.id = newId;
        if (edge.from.type === 'free') {
          edge.from.x += widthOffset;
          edge.from.y += heightOffset;
        } else if (edge.from.type === 'connected') {
          edge.from.node = updatedIds.get(edge.from.node) ?? edge.from.node;
        }
        if (edge.to.type === 'free') {
          edge.to.x += widthOffset;
          edge.to.y += heightOffset;
        } else if (edge.to.type === 'connected') {
          edge.to.node = updatedIds.get(edge.to.node) ?? edge.to.node;
        }
        if (edge.groupId) {
          if (groupMap.has(edge.groupId)) {
            edge.groupId = groupMap.get(edge.groupId);
            groups.addNode(edge.groupId!, newId);
          } else {
            const newGroupId = nanoid(8);
            groupMap.set(edge.groupId, newGroupId);
            edge.groupId = newGroupId;
            groups.createGroup(
              newGroupId,
              highestOrder() + 1,
              edge.layer,
              [],
              [newId]
            );
          }
        }
      });
    } else {
      pastedNodes.forEach((node) => {
        const newId = nanoid(8);
        node.x += offset.x;
        node.y += offset.y;
        updatedIds.set(node.id, newId);
        node.id = newId;
        if (node.groupId) {
          if (groupMap.has(node.groupId)) {
            node.groupId = groupMap.get(node.groupId);
            groups.addNode(node.groupId!, newId);
          } else {
            const newGroupId = nanoid(8);
            groupMap.set(node.groupId, newGroupId);
            node.groupId = newGroupId;
            groups.createGroup(
              newGroupId,
              highestOrder() + 1,
              node.layer,
              [newId],
              []
            );
          }
        }
      });
      pastedEdges.forEach((edge) => {
        const newId = nanoid(8);
        updatedIds.set(edge.id, newId);
        edge.id = newId;
        if (edge.from.type === 'free') {
          edge.from.x += offset.x;
          edge.from.y += offset.y;
        } else if (edge.from.type === 'connected') {
          edge.from.node = updatedIds.get(edge.from.node) ?? edge.from.node;
        }
        if (edge.to.type === 'free') {
          edge.to.x += offset.x;
          edge.to.y += offset.y;
        } else if (edge.to.type === 'connected') {
          edge.to.node = updatedIds.get(edge.to.node) ?? edge.to.node;
        }
        if (edge.groupId) {
          if (groupMap.has(edge.groupId)) {
            edge.groupId = groupMap.get(edge.groupId);
            groups.addNode(edge.groupId!, newId);
          } else {
            const newGroupId = nanoid(8);
            groupMap.set(edge.groupId, newGroupId);
            edge.groupId = newGroupId;
            groups.createGroup(
              newGroupId,
              highestOrder() + 1,
              edge.layer,
              [],
              [newId]
            );
          }
        }
      });
    }
    for (const node of pastedNodes) {
      node.edges = node.edges.map((edgeId) => {
        if (updatedIds.has(edgeId)) {
          return updatedIds.get(edgeId)!;
        }
        return edgeId;
      });
    }

    const pastedGroupIds = new Set<string>();

    batch(() => {
      nodes.batchUpdate(
        () => {
          for (const node of pastedNodes) {
            nodes.createNode(node);
            if (node.groupId) pastedGroupIds.add(node.groupId);
          }
        },
        { autosave: true }
      );
      edges.batchUpdate(
        () => {
          for (const edge of pastedEdges) {
            edges.createEdge(edge);
            if (edge.groupId) pastedGroupIds.add(edge.groupId);
          }
        },
        { autosave: true }
      );
    });

    const pastedNodeIds = pastedNodes.map((node) => node.id);
    const pastedEdgeIds = pastedEdges.map((edge) => edge.id);

    forceSetSelection(pastedNodeIds, pastedEdgeIds, Array.from(pastedGroupIds));
  };

  const handleStandardPaste = async (position?: Vector2) => {
    const clipboardData = await navigator.clipboard.read();
    const item = clipboardData[0];
    if (!item) return;
    const centerPoint = currentPosition().multiply(-1 / currentScale());

    history.open();
    deselectAll();

    if (item.types.includes('text/plain')) {
      let copiedText = await navigator.clipboard.readText();
      try {
        // Paste Canvas
        if (copiedText.startsWith('<svg ') && copiedText.endsWith('</svg>')) {
          if (CANVAS_SVG_IMPORT) {
            parseSVGStringToNodes(copiedText, centerPoint);
          } else {
            const blob = new Blob([copiedText], { type: 'image/svg+xml' });
            staticImageUpload(blob, centerPoint);
          }
        } else {
          pasteCanvas(copiedText, position);
        }
      } catch {
        // Paste text box
        const id = nanoid(8);
        const height = getTextNodeHeight(style().fontSize);
        const centerPoint = currentPosition().multiply(-1 / currentScale());
        nodes.setLastCreated(id);
        nodes.createNode(
          {
            id,
            type: 'text',
            x: centerPoint.x,
            y: centerPoint.y,
            width: 0,
            height,
            edges: [],
            style: style(),
            text: checkForMacroUrl(copiedText),
            followTextWidth: true,
            layer: 0,
            sortOrder: highestOrder() + 1,
          },
          { autosave: true }
        );
      }
      history.close();
      return;
    }

    for (const imageType of blockNameToFileExtensions.image) {
      const mime = `image/${imageType}`;
      if (item.types.includes(mime)) {
        const blob = await item.getType(mime);
        track(TrackingEvents.BLOCKCANVAS.IMAGES.STATICIMAGE, {
          method: 'paste from clipboard',
        });
        staticImageUpload(blob, centerPoint);
        history.close();
        return;
      }
    }
  };

  // Some older applications may write image data to the clipboard in a way that is not
  // compatible  with the newer clipboard API. This has to be a synchronous call and the above
  // paste method is cleaner as an async - hence the annoying branching.
  const handleLegacyImagePaste = (e: ClipboardEvent): boolean => {
    if (!e.clipboardData) return false;
    const items = e.clipboardData.items;
    for (const item of items) {
      if (
        blockNameToFileExtensions.image.includes(
          item.type.replace('image/', '')
        )
      ) {
        const blob = item.getAsFile();
        if (blob) {
          const centerPoint = currentPosition().multiply(-1 / currentScale());
          history.open();
          deselectAll();
          staticImageUpload(blob, centerPoint);
          history.close();
          return true;
        }
      }
    }
    return false;
  };

  return {
    copySelection(cut?: boolean) {
      if (!active()) return;

      let canvasNodes: CanvasNode[] = [];
      selectedNodeIds().forEach((id) => {
        const node = nodes.get(id);
        if (node) canvasNodes.push(node);
      });

      let canvasEdges: CanvasEdge[] = [];
      selectedEdgeIds().forEach((id) => {
        const edge = edges.get(id);
        if (edge) canvasEdges.push(edge);
      });

      canvasEdges = JSON.parse(JSON.stringify(canvasEdges));
      canvasNodes = JSON.parse(JSON.stringify(canvasNodes));

      const updatedIds = new Map<string, string>();

      for (const node of canvasNodes) {
        const newId = nanoid(8);
        updatedIds.set(node.id, newId);
        node.id = newId;
      }

      for (const edge of canvasEdges) {
        const newId = nanoid(8);
        updatedIds.set(edge.id, newId);
        edge.id = newId;

        if (edge.from.type === 'connected') {
          if (updatedIds.has(edge.from.node)) {
            edge.from.node = updatedIds.get(edge.from.node)!;
          } else {
            const oldNode = nodes.get(edge.from.node);
            // todo : what if there is no node? - shouldn't happen but .....
            const pos = Rect.centerPointOfEdge(oldNode, edge.from.side);
            edge.from = {
              type: 'free',
              x: pos.x,
              y: pos.y,
            };
          }
        }

        if (edge.to.type === 'connected') {
          if (updatedIds.has(edge.to.node)) {
            edge.to.node = updatedIds.get(edge.to.node)!;
          } else {
            const oldNode = nodes.get(edge.to.node);
            // todo : what if there is no node? - shouldn't happen but .....
            const pos = Rect.centerPointOfEdge(oldNode, edge.to.side);
            edge.to = {
              type: 'free',
              x: pos.x,
              y: pos.y,
            };
          }
        }
      }

      for (const node of canvasNodes) {
        node.edges = node.edges.map((edgeId) => {
          if (updatedIds.has(edgeId)) {
            return updatedIds.get(edgeId)!;
          }
          return edgeId;
        });
      }

      navigator.clipboard.writeText(
        JSON.stringify({ nodes: canvasNodes, edges: canvasEdges } as Canvas)
      );

      if (cut) {
        nodes.batchUpdate(
          () => {
            selectedNodeIds().forEach((id) => {
              nodes.delete(id);
            });
          },
          { autosave: true }
        );
        edges.batchUpdate(
          () => {
            selectedEdgeIds().forEach((id) => {
              edges.delete(id);
            });
          },
          { autosave: true }
        );
      }
    },

    handlePaste(opts: { position?: Vector2; event?: ClipboardEvent }) {
      if (opts?.event?.clipboardData instanceof DataTransfer) {
        if (handleLegacyImagePaste(opts.event)) return;
      }
      handleStandardPaste(opts.position);
    },
  };
});
