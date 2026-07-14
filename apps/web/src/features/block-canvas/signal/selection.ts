import { renderQueue, useBoundingBox } from '@block-canvas/store/canvasData';
import {
  useGetEdge,
  useGetGroup,
  useGetNode,
} from '@block-canvas/store/getNodeEdge';
import { createBlockSignal } from '@core/block';
import { createMemo, untrack } from 'solid-js';
import {
  type CanvasEdge,
  type CanvasEntityStyle,
  type CanvasGroup,
  type CanvasNode,
  StyleSchema,
} from '../model/CanvasModel';
import type { Rectangle } from '../util/rectangle';
import { sharedInstance } from '../util/sharedInstance';

export const selectedNodeIdsSignal = createBlockSignal<Set<string>>(new Set());
export const selectedEdgeIdsSignal = createBlockSignal<Set<string>>(new Set());
export const selectedGroupIdsSignal = createBlockSignal<Set<string>>(new Set());
export const boxSelectionSignal = createBlockSignal<Rectangle>();
const lastSelectedNodeIdsSignal = createBlockSignal<Set<string>>(new Set());
const lastSelectedEdgeIdsSignal = createBlockSignal<Set<string>>(new Set());

export type Selection = ReturnType<typeof createSelection>;

export const useSelection = sharedInstance<Selection>(createSelection);

function createSelection() {
  const [selectedNodeIds, setSelectedNodeIds] = selectedNodeIdsSignal;
  const [selectedEdgeIds, setSelectedEdgeIds] = selectedEdgeIdsSignal;
  const [selectedGroupIds, setSelectedGroupIds] = selectedGroupIdsSignal;
  const [lastSelectedNodeIds, setLastSelectedNodeIds] =
    lastSelectedNodeIdsSignal;
  const [lastSelectedEdgeIds, setLastSelectedEdgeIds] =
    lastSelectedEdgeIdsSignal;
  const [boxSelection, setBoxSelection] = boxSelectionSignal;
  const getNode = useGetNode();
  const getEdge = useGetEdge();
  const getGroup = useGetGroup();
  const boundingBox = useBoundingBox();

  const rq = renderQueue();

  const selectedNodes = createMemo(() => {
    const nodes = Array.from(selectedNodeIds().values()).map((id) =>
      getNode(id)
    );
    return nodes.filter((node) => node !== undefined) as CanvasNode[];
  });

  const selectedEdges = createMemo(() => {
    const edges = Array.from(selectedEdgeIds().values()).map((id) =>
      getEdge(id)
    );
    return edges.filter((edge) => edge !== undefined) as CanvasEdge[];
  });

  const selectedGroups = createMemo(() => {
    const groups = Array.from(selectedGroupIds().values()).map((id) =>
      getGroup(id)
    );
    return groups.filter((group) => group !== undefined) as CanvasGroup[];
  });

  return {
    selectAll() {
      setSelectedNodeIds(new Set(rq.nodes().map((node) => node.id)));
      setSelectedEdgeIds(new Set(rq.edges().map((edge) => edge.id)));
      setSelectedGroupIds(new Set(rq.groups().map((group) => group.id)));
    },

    deselectAll() {
      setSelectedNodeIds(new Set() as Set<string>);
      setSelectedEdgeIds(new Set() as Set<string>);
      setSelectedGroupIds(new Set() as Set<string>);
    },

    selectNode(id: string | { id: string }) {
      const keys = [...selectedNodeIds().keys()];
      const _id = typeof id === 'string' ? id : id.id;
      const groupId = getNode(_id).groupId;
      const group = groupId ? getGroup(groupId) : undefined;
      const childNodes = group && group.childNodes ? group.childNodes : [];
      setSelectedNodeIds(new Set([...keys, _id, ...childNodes]));
      const childEdges = group ? group.childEdges : undefined;
      if (childEdges)
        setSelectedEdgeIds(
          new Set([...selectedEdgeIds().keys(), ...childEdges])
        );
    },
    deselectNode(id: string | { id: string }) {
      const keys = [...selectedNodeIds().keys()];
      const _id = typeof id === 'string' ? id : id.id;
      setSelectedNodeIds(new Set([...keys].filter((i) => i !== _id)));
    },
    selectEdge(id: string | { id: string }) {
      const keys = [...selectedEdgeIds().keys()];
      const _id = typeof id === 'string' ? id : id.id;
      const groupId = getEdge(_id).groupId;
      const group = groupId ? getGroup(groupId) : undefined;
      const childEdges = group && group.childEdges ? group.childEdges : [];
      setSelectedEdgeIds(new Set([...keys, _id, ...childEdges]));
      const childNodes = group ? group.childNodes : undefined;
      if (childNodes)
        setSelectedNodeIds(
          new Set([...selectedNodeIds().keys(), ...childNodes])
        );
    },
    deselectEdge(id: string | { id: string }) {
      const keys = [...selectedEdgeIds().keys()];
      const _id = typeof id === 'string' ? id : id.id;
      setSelectedEdgeIds(new Set([...keys].filter((i) => i !== _id)));
    },
    selectGroup(id: string) {
      const keys = [...selectedGroupIds().keys()];
      setSelectedGroupIds(new Set([...keys, id]));
    },

    isSelected(id: string | { id: string }) {
      if (typeof id === 'string')
        return selectedNodeIds().has(id) || selectedEdgeIds().has(id);
      return selectedNodeIds().has(id.id) || selectedEdgeIds().has(id.id);
    },
    selectionBounds: createMemo(() => {
      if (selectedNodes().length === 0 && selectedEdges().length === 0) return;
      return boundingBox(selectedNodes(), selectedEdges());
    }),
    active: createMemo(
      () => selectedNodeIds().size > 0 || selectedEdgeIds().size > 0
    ),
    selectionBox: createMemo(() => boxSelection()),
    setSelectionBox(rect?: Rectangle) {
      setBoxSelection(rect);
    },

    extractSharedStyles(): Map<keyof CanvasEntityStyle, any> {
      const sharedStyles = new Map<keyof CanvasEntityStyle, any>();

      [...selectedNodes(), ...selectedEdges()].forEach((element: any) => {
        Object.keys(StyleSchema.shape).forEach((_prop) => {
          const prop = _prop as keyof CanvasEntityStyle;
          if (element.style && prop in element.style) {
            const styleValue = element.style[prop];

            if (!sharedStyles.has(prop)) {
              sharedStyles.set(prop, styleValue);
            } else if (sharedStyles.get(prop) !== styleValue) {
              sharedStyles.set(prop, undefined);
            }
          }
        });
      });

      return sharedStyles;
    },

    forceSetSelection(
      NodeIds: string[],
      EdgeIds: string[],
      GroupIds: string[]
    ) {
      setSelectedNodeIds(new Set(NodeIds));
      setSelectedEdgeIds(new Set(EdgeIds));
      setSelectedGroupIds(new Set(GroupIds));
    },

    stash() {
      setLastSelectedNodeIds(new Set([...untrack(selectedNodeIds)]));
      setLastSelectedEdgeIds(new Set([...untrack(selectedEdgeIds)]));
    },

    getStashed: createMemo(() => {
      return {
        nodes: lastSelectedNodeIds(),
        edges: lastSelectedEdgeIds(),
      };
    }),

    selectedNodeIds,
    selectedEdgeIds,
    selectedGroupIds,
    selectedNodes,
    selectedEdges,
    selectedGroups,
  };
}
