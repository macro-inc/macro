import { mergeRegister } from '@lexical/utils';
import type { ElementNode, LexicalNode, NodeKey } from 'lexical';
import {
  $createNodeSelection,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical';

export const DO_REPLACE_COMMAND: LexicalCommand<ReplacePayload> =
  createCommand('DO_REPLACE_COMMAND');

export const DO_REPLACE_ONCE_COMMAND: LexicalCommand<ReplacePayload> =
  createCommand('DO_REPLACE_ONCE_COMMAND');

export const DO_SEARCH_COMMAND: LexicalCommand<string> =
  createCommand('DO_SEARCH_COMMAND');

export interface NodekeyOffset {
  key: string;
  offset: SplitOffset;
  pairKey: number | undefined;
}

export interface SplitOffset {
  start: number;
  end: number;
  isReplace: boolean;
}

interface ReplacePayload {
  replaceString: string;
  nodeKeyOffsetList: NodekeyOffset[];
}

interface TextSegment {
  key: NodeKey;
  start: number;
  end: number;
}

type FindAndReplaceProps = {
  getListOffset: () => NodekeyOffset[];
  setListOffset: (listOffset: NodekeyOffset[]) => void;
};

function shouldIgnoreNodeType(type: string) {
  // Document mentions (task chips, doc/channel refs, …) stay searchable via
  // getTextContent() so Ctrl+F matches their visible titles. Replace still
  // no-ops on them because they are not TextNodes.
  const ignoredTypes = ['user-mention', 'horizontalrule', 'equation'];
  return ignoredTypes.includes(type);
}

function notReallyInlineTypes(type: string) {
  const excludedTypes = ['image', 'inline-image', 'excalidraw'];
  for (let i = 0; i < excludedTypes.length; i++) {
    if (excludedTypes[i] === type) {
      return true;
    }
  }
  return false;
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Flattens the tree into one string and records where each leaf node's text
 * sits in it. Blocks, including ones nested after inline text such as a
 * sublist, are separated by a newline that belongs to no node, so a
 * match can never span two blocks.
 */
function collectTextSegments(root: ElementNode): {
  text: string;
  segments: TextSegment[];
} {
  let text = '';
  const segments: TextSegment[] = [];
  const visit = (node: LexicalNode) => {
    if (shouldIgnoreNodeType(node.getType())) return;
    if ($isElementNode(node)) {
      const isBlock = !node.isInline();
      if (isBlock && text.length > 0 && !text.endsWith('\n')) text += '\n';
      for (const child of node.getChildren()) visit(child);
      if (isBlock) text += '\n';
      return;
    }
    const content = node.getTextContent();
    if (content.length > 0) {
      segments.push({
        key: node.getKey(),
        start: text.length,
        end: text.length + content.length,
      });
      text += content;
    }
    if (notReallyInlineTypes(node.getType())) text += '\n';
  };
  visit(root);
  return { text, segments };
}

/**
 * Case-insensitive, non-overlapping matches mapped onto the nodes they cover.
 * The first piece of each match is the one a replace rewrites; the remaining
 * pieces of a match split across nodes are deleted.
 */
function findMatchOffsets(
  root: ElementNode,
  searchString: string
): NodekeyOffset[] {
  const { text, segments } = collectTextSegments(root);
  const regex = new RegExp(escapeRegExp(searchString), 'gi');
  const offsets: NodekeyOffset[] = [];
  let segmentIndex = 0;
  let pairKey = 0;
  for (const found of text.matchAll(regex)) {
    const matchStart = found.index;
    const matchEnd = matchStart + found[0].length;
    if (matchEnd === matchStart) break;
    pairKey += 1;
    while (
      segmentIndex < segments.length &&
      segments[segmentIndex].end <= matchStart
    ) {
      segmentIndex += 1;
    }
    let isReplace = true;
    for (
      let i = segmentIndex;
      i < segments.length && segments[i].start < matchEnd;
      i++
    ) {
      const segment = segments[i];
      offsets.push({
        key: segment.key,
        offset: {
          start: Math.max(matchStart, segment.start) - segment.start,
          end: Math.min(matchEnd, segment.end) - segment.start,
          isReplace,
        },
        pairKey,
      });
      isReplace = false;
    }
  }
  return offsets;
}

function selectNextKey(key: NodeKey) {
  if (!key) return;
  const nodeSelection = $createNodeSelection();
  nodeSelection.add(key);
  $setSelection(nodeSelection);
}

function areListOffsetsEqual(left: NodekeyOffset[], right: NodekeyOffset[]) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const leftItem = left[i];
    const rightItem = right[i];
    if (leftItem.key !== rightItem.key) return false;
    if (leftItem.pairKey !== rightItem.pairKey) return false;
    if (leftItem.offset.start !== rightItem.offset.start) return false;
    if (leftItem.offset.end !== rightItem.offset.end) return false;
    if (leftItem.offset.isReplace !== rightItem.offset.isReplace) {
      return false;
    }
  }
  return true;
}

function registerFindAndReplacePlugin(
  editor: LexicalEditor,
  props: FindAndReplaceProps
) {
  const updateListOffset = (nodeKeyOffsetList: NodekeyOffset[]) => {
    if (areListOffsetsEqual(props.getListOffset(), nodeKeyOffsetList)) {
      return;
    }
    props.setListOffset(nodeKeyOffsetList);
  };

  return mergeRegister(
    editor.registerCommand(
      DO_REPLACE_COMMAND,
      (payload: ReplacePayload) => {
        editor.update(() => {
          let previousNodeKey = '';
          let lengthDiff = 0;
          let replaceStart: number,
            replaceEnd: number = 0;
          payload.nodeKeyOffsetList.map((item) => {
            if (previousNodeKey === item.key) {
              replaceStart = item.offset.start - lengthDiff;
              replaceEnd = item.offset.end - lengthDiff;
            } else {
              replaceStart = item.offset.start;
              replaceEnd = item.offset.end;
              lengthDiff = 0; //reset lengthDiff
            }
            const targetNode = $getNodeByKey(item.key);
            if (targetNode) {
              let newText = '';
              const text = targetNode.getTextContent();
              if (item.offset.isReplace) {
                newText =
                  text.substring(0, replaceStart) +
                  payload.replaceString +
                  text.substring(replaceEnd);
              } else {
                newText =
                  text.substring(0, replaceStart) + text.substring(replaceEnd);
              }
              if ($isTextNode(targetNode)) {
                if (newText.length > 0) {
                  targetNode.setTextContent(newText);
                } else {
                  targetNode.remove();
                }
              }
              lengthDiff += text.length - newText.length;
            }
            previousNodeKey = item.key;
          });
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      DO_REPLACE_ONCE_COMMAND,
      (payload: ReplacePayload) => {
        editor.update(() => {
          let previousNodeKey = '';
          let lengthDiff = 0;
          let replaceStart: number,
            replaceEnd: number = 0;
          let replacedCount = 0;
          let nextKey = '';
          payload.nodeKeyOffsetList.map((item) => {
            if (previousNodeKey === item.key) {
              replaceStart = item.offset.start - lengthDiff;
              replaceEnd = item.offset.end - lengthDiff;
            } else {
              replaceStart = item.offset.start;
              replaceEnd = item.offset.end;
              lengthDiff = 0; //reset lengthDiff
            }
            const targetNode = $getNodeByKey(item.key);
            if (targetNode) {
              let newText = '';
              const text = targetNode.getTextContent();
              if (item.offset.isReplace) {
                if (replacedCount > 0) {
                  nextKey = item.key;
                  return true;
                }
                newText =
                  text.substring(0, replaceStart) +
                  payload.replaceString +
                  text.substring(replaceEnd);
                replacedCount += 1;
              } else {
                newText =
                  text.substring(0, replaceStart) + text.substring(replaceEnd);
              }
              if ($isTextNode(targetNode)) {
                if (newText.length > 0) {
                  targetNode.setTextContent(newText);
                } else {
                  targetNode.remove();
                }
              }
              lengthDiff += text.length - newText.length;
            }
            previousNodeKey = item.key;
          });
          selectNextKey(nextKey);
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      DO_SEARCH_COMMAND,
      (searchString: string) => {
        const nodeKeyOffsetList = findMatchOffsets($getRoot(), searchString);
        updateListOffset(nodeKeyOffsetList);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    )
  );
}

export function findAndReplacePlugin(props: FindAndReplaceProps) {
  return (editor: LexicalEditor) => registerFindAndReplacePlugin(editor, props);
}
