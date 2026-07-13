import { sharedInstance } from '@block-canvas/util/sharedInstance';
import { type Vector2, vec2 } from '@block-canvas/util/vector2';
import { batch } from 'solid-js';
import {
  useBoundingBox,
  useCanvasEdges,
  useCanvasNodes,
} from '../store/canvasData';
import { useCanvasHistory } from './canvasHistory';
import { useSelection } from './selection';

export const useAlign = sharedInstance(() => {
  const history = useCanvasHistory();
  const selection = useSelection();
  const nodes = useCanvasNodes();
  const edges = useCanvasEdges();
  const boundingBox = useBoundingBox();

  return {
    align(alignment: number, autosave?: boolean) {
      history.open();
      const bounds = selection.selectionBounds();

      if (!bounds) return;

      const boundsXStart = bounds.x;
      const boundsXMid = bounds.x + bounds.w / 2;
      const boundsXEnd = bounds.x + bounds.w;
      const boundsYStart = bounds.y;
      const boundsYMid = bounds.y + bounds.h / 2;
      const boundsYEnd = bounds.y + bounds.h;

      const groupsPos = new Map<
        string,
        { x: number; y: number; width: number; height: number }
      >();
      const groupsToMove = new Map<string, Vector2>();

      selection.selectedGroups().forEach((group) => {
        const groupId = group.id;
        let groupPos = groupsPos.get(groupId);
        if (!groupPos) {
          const groupBounds = boundingBox(
            group.childNodes?.map((n) => nodes.get(n)) ?? [],
            group.childEdges?.map((e) => edges.get(e)) ?? []
          );
          groupPos = {
            x: groupBounds.x,
            y: groupBounds.y,
            width: groupBounds.w,
            height: groupBounds.h,
          };
          groupsPos.set(groupId, groupPos);
        }
        if (!groupsToMove.get(groupId)) {
          switch (alignment) {
            case 0:
              groupsToMove.set(groupId, vec2(groupPos.x - boundsXStart, 0));
              break;
            case 1:
              groupsToMove.set(
                groupId,
                vec2(groupPos.x - (boundsXMid - groupPos.width / 2), 0)
              );
              break;
            case 2:
              groupsToMove.set(
                groupId,
                vec2(groupPos.x - (boundsXEnd - groupPos.width), 0)
              );
              break;
            case 3:
              groupsToMove.set(groupId, vec2(0, groupPos.y - boundsYStart));
              break;
            case 4:
              groupsToMove.set(
                groupId,
                vec2(0, groupPos.y - (boundsYMid - groupPos.height / 2))
              );
              break;
            case 5:
              groupsToMove.set(
                groupId,
                vec2(0, groupPos.y - (boundsYEnd - groupPos.height))
              );
              break;
          }
        }
      });

      batch(() => {
        nodes.batchUpdate(
          () => {
            selection.selectedNodeIds().forEach((nodeId) => {
              const original = nodes.get(nodeId);
              const groupId = original.groupId;
              if (groupId) {
                let group = groupsPos.get(groupId);
                if (group) {
                  let groupShift = groupsToMove.get(groupId);
                  nodes.updateNode(nodeId, {
                    x: original.x - groupShift!.x,
                    y: original.y - groupShift!.y,
                  });
                  return;
                }
              } else {
                switch (alignment) {
                  case 0:
                    nodes.updateNode(nodeId, { x: boundsXStart });
                    break;
                  case 1:
                    nodes.updateNode(nodeId, {
                      x: boundsXMid - original.width / 2,
                    });
                    break;
                  case 2:
                    nodes.updateNode(nodeId, {
                      x: boundsXEnd - original.width,
                    });
                    break;
                  case 3:
                    nodes.updateNode(nodeId, { y: boundsYStart });
                    break;
                  case 4:
                    nodes.updateNode(nodeId, {
                      y: boundsYMid - original.height / 2,
                    });
                    break;
                  case 5:
                    nodes.updateNode(nodeId, {
                      y: boundsYEnd - original.height,
                    });
                    break;
                }
              }
            });
          },
          { autosave }
        );

        edges.batchUpdate(
          () => {
            selection.selectedEdgeIds().forEach((edgeId) => {
              const original = edges.get(edgeId);
              const groupId = original.groupId;
              if (groupId) {
                let groupShift = groupsToMove.get(groupId);
                edges.updateEdge(edgeId, {
                  from:
                    original.from.type === 'free'
                      ? {
                          type: 'free',
                          x: original.from.x - groupShift!.x,
                          y: original.from.y - groupShift!.y,
                        }
                      : original.from,
                  to:
                    original.to.type === 'free'
                      ? {
                          type: 'free',
                          x: original.to.x - groupShift!.x,
                          y: original.to.y - groupShift!.y,
                        }
                      : original.to,
                });
              } else {
                switch (alignment) {
                  case 0:
                    if (
                      original.from.type === 'free' &&
                      original.to.type === 'free'
                    ) {
                      const xShift =
                        original.from.x < original.to.x
                          ? original.from.x - boundsXStart
                          : original.to.x - boundsXStart;
                      edges.updateEdge(edgeId, {
                        from: {
                          type: 'free',
                          x: original.from.x - xShift,
                          y: original.from.y,
                        },
                        to: {
                          type: 'free',
                          x: original.to.x - xShift,
                          y: original.to.y,
                        },
                      });
                    } else if (original.from.type === 'free') {
                      edges.updateEdge(edgeId, {
                        from: {
                          type: 'free',
                          x: boundsXStart,
                          y: original.from.y,
                        },
                      });
                    } else if (original.to.type === 'free') {
                      edges.updateEdge(edgeId, {
                        to: {
                          type: 'free',
                          x: boundsXStart,
                          y: original.to.y,
                        },
                      });
                    }
                    break;
                  case 1:
                    if (
                      original.from.type === 'free' &&
                      original.to.type === 'free'
                    ) {
                      const xMidpoint = (original.to.x - original.from.x) / 2; // midpoint between ends
                      edges.updateEdge(edgeId, {
                        from: {
                          type: 'free',
                          x: boundsXMid - xMidpoint,
                          y: original.from.y,
                        },
                        to: {
                          type: 'free',
                          x: boundsXMid + xMidpoint,
                          y: original.to.y,
                        },
                      });
                    } else if (original.from.type === 'free') {
                      edges.updateEdge(edgeId, {
                        from: {
                          type: 'free',
                          x: boundsXMid,
                          y: original.from.y,
                        },
                      });
                    } else if (original.to.type === 'free') {
                      edges.updateEdge(edgeId, {
                        to: {
                          type: 'free',
                          x: boundsXMid,
                          y: original.to.y,
                        },
                      });
                    }
                    break;
                  case 2:
                    if (
                      original.from.type === 'free' &&
                      original.to.type === 'free'
                    ) {
                      if (original.from.x > original.to.x) {
                        edges.updateEdge(edgeId, {
                          from: {
                            type: 'free',
                            x: boundsXEnd,
                            y: original.from.y,
                          },
                          to: {
                            type: 'free',
                            x: boundsXEnd - (original.from.x - original.to.x),
                            y: original.to.y,
                          },
                        });
                      } else {
                        edges.updateEdge(edgeId, {
                          from: {
                            type: 'free',
                            x: boundsXEnd - (original.to.x - original.from.x),
                            y: original.from.y,
                          },
                          to: {
                            type: 'free',
                            x: boundsXEnd,
                            y: original.to.y,
                          },
                        });
                      }
                    } else if (original.from.type === 'free') {
                      edges.updateEdge(edgeId, {
                        from: {
                          type: 'free',
                          x: boundsXEnd,
                          y: original.from.y,
                        },
                      });
                    } else if (original.to.type === 'free') {
                      edges.updateEdge(edgeId, {
                        to: {
                          type: 'free',
                          x: boundsXEnd,
                          y: original.to.y,
                        },
                      });
                    }
                    break;
                  case 3:
                    if (
                      original.from.type === 'free' &&
                      original.to.type === 'free'
                    ) {
                      const yShift =
                        original.from.y < original.to.y
                          ? original.from.y - boundsYStart
                          : original.to.y - boundsYStart;
                      edges.updateEdge(edgeId, {
                        from: {
                          type: 'free',
                          x: original.from.x,
                          y: original.from.y - yShift,
                        },
                        to: {
                          type: 'free',
                          x: original.to.x,
                          y: original.to.y - yShift,
                        },
                      });
                    } else if (original.from.type === 'free') {
                      edges.updateEdge(edgeId, {
                        from: {
                          type: 'free',
                          x: original.from.x,
                          y: boundsYStart,
                        },
                      });
                    } else if (original.to.type === 'free') {
                      edges.updateEdge(edgeId, {
                        to: {
                          type: 'free',
                          x: original.to.x,
                          y: boundsYStart,
                        },
                      });
                    }
                    break;
                  case 4:
                    if (
                      original.from.type === 'free' &&
                      original.to.type === 'free'
                    ) {
                      const yMidpoint = (original.to.y - original.from.y) / 2;
                      edges.updateEdge(edgeId, {
                        from: {
                          type: 'free',
                          x: original.from.x,
                          y: boundsYMid - yMidpoint,
                        },
                        to: {
                          type: 'free',
                          x: original.to.x,
                          y: boundsYMid + yMidpoint,
                        },
                      });
                    } else if (original.from.type === 'free') {
                      edges.updateEdge(edgeId, {
                        from: {
                          type: 'free',
                          x: original.from.x,
                          y: boundsYMid,
                        },
                      });
                    } else if (original.to.type === 'free') {
                      edges.updateEdge(edgeId, {
                        to: {
                          type: 'free',
                          x: original.to.x,
                          y: boundsYMid,
                        },
                      });
                    }
                    break;
                  case 5:
                    if (
                      original.from.type === 'free' &&
                      original.to.type === 'free'
                    ) {
                      if (original.from.y > original.to.y) {
                        edges.updateEdge(edgeId, {
                          from: {
                            type: 'free',
                            x: original.from.x,
                            y: boundsYEnd,
                          },
                          to: {
                            type: 'free',
                            x: original.to.x,
                            y: boundsYEnd - (original.from.y - original.to.y),
                          },
                        });
                      } else {
                        edges.updateEdge(edgeId, {
                          from: {
                            type: 'free',
                            x: original.from.x,
                            y: boundsYEnd - (original.from.y - original.to.y),
                          },
                          to: {
                            type: 'free',
                            x: original.to.x,
                            y: boundsYEnd,
                          },
                        });
                      }
                    } else if (original.from.type === 'free') {
                      edges.updateEdge(edgeId, {
                        from: {
                          type: 'free',
                          x: original.from.x,
                          y: boundsYEnd,
                        },
                      });
                    } else if (original.to.type === 'free') {
                      edges.updateEdge(edgeId, {
                        to: {
                          type: 'free',
                          x: original.to.x,
                          y: boundsYEnd,
                        },
                      });
                    }
                    break;
                }
              }
            });
          },
          { autosave }
        );

        history.close();
      });
    },
  };
});
