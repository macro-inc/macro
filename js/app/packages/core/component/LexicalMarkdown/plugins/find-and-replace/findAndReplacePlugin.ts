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

interface HighlightNodes {
  node: LexicalNode;
  text: string;
  length: number;
  startIndex: number;
}

interface ReplacePayload {
  replaceString: string;
  nodeKeyOffsetList: NodekeyOffset[];
}

interface StringLocation {
  searchStart: number;
  searchLength: number;
}

interface MatchedAndLocations {
  matched: string;
  location: number;
}

interface NoneBreakNode {
  node: LexicalNode;
  realLocations: MatchedAndLocations[];
}

export type FindAndReplaceProps = {
  setListOffset: (listOffset: NodekeyOffset[]) => void;
};

function isBetween(target: number, a: number, b: number) {
  return (a - target) * (b - target) <= 0;
}

function shouldIgnoreNodeType(type: string) {
  const ignoredTypes = [
    'document-mention',
    'user-mention',
    'horizontalrule',
    'equation',
  ];
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

function getPlusLength(child: LexicalNode): number {
  let plus = 0;
  if ($isElementNode(child)) {
    plus = 1;
  } else {
    if (!child.getNextSibling()) {
      plus = 1;
    }
  }
  return plus;
}

function ciIndexOf(string: string, subString: string) {
  return string.toUpperCase().indexOf(subString.toUpperCase());
}

function ciLastIndexOf(string: string, subString: string) {
  return string.toUpperCase().lastIndexOf(subString.toUpperCase());
}

function preg_quote(str: string, delimiter: string) {
  return (str + '').replace(
    new RegExp(
      '[.\\\\+*?\\[\\^\\]$(){}=!<>|:\\' + (delimiter || '') + '-]',
      'g'
    ),
    '\\$&'
  );
}

function locations(
  searchStr: string,
  str: string,
  caseSensitive: boolean = false
) {
  var searchStrLen = searchStr.length;
  if (searchStrLen === 0) {
    return [];
  }
  var startIndex = 0,
    index: number = -1,
    indices: number[] = [];
  if (!caseSensitive) {
    str = str.toLowerCase();
    searchStr = searchStr.toLowerCase();
  }
  index = str.indexOf(searchStr, startIndex);
  while (index > -1) {
    indices.push(index);
    startIndex = index + searchStrLen;
    index = str.indexOf(searchStr, startIndex);
  }
  return indices;
}

function traverseNodeGetText(root: ElementNode | LexicalNode): string {
  if (!$isElementNode(root)) {
    if (shouldIgnoreNodeType(root.__type)) {
      return '';
    }
    return root.getTextContent();
  }
  let textContent = '';
  const children = root.getChildren();
  const childrenLength = children.length;
  for (let i = 0; i < childrenLength; i++) {
    const child = children[i];
    if ($isElementNode(child)) {
      textContent += traverseNodeGetText(child);
      if (i !== childrenLength - 1 && !child.isInline()) {
        textContent += '\n\n';
      }
    } else {
      if (shouldIgnoreNodeType(child.__type)) {
        continue;
      }
      textContent += child.getTextContent();
      if (notReallyInlineTypes(child.__type)) {
        textContent += '\n\n';
      }
    }
  }
  return textContent;
}

function highlightMultipleNode(
  targetNode: LexicalNode,
  searchString: string,
  params: { startIndex: number; totalLength: number }
): HighlightNodes[] {
  const results: HighlightNodes[] = [];
  if (shouldIgnoreNodeType(targetNode.__type)) {
    return results;
  }

  if ($isElementNode(targetNode)) {
    let children = targetNode.getChildren();
    for (let i = 0; i < children.length; i++) {
      let child = children[i];
      if (shouldIgnoreNodeType(child.__type)) {
        continue;
      }
      if ($isElementNode(child)) {
        const subNodes = highlightMultipleNode(child, searchString, params);
        results.push(...subNodes);
      } else {
        results.push({
          node: child,
          text: child.getTextContent(),
          length: child.getTextContent().length,
          startIndex: params.startIndex,
        });
        params.startIndex += child.getTextContent().length;
      }
    }
  } else {
    results.push({
      node: targetNode,
      text: targetNode.getTextContent(),
      length: targetNode.getTextContent().length,
      startIndex: params.startIndex,
    });
    params.startIndex += targetNode.getTextContent().length;
  }
  return results;
}

function getNoneBreakNodes(
  root: ElementNode,
  searchString: string,
  indexes: Array<number>,
  paramsObj: { currentMatchIndex: number; previousLength: number }
): NoneBreakNode[] {
  const nodes: NoneBreakNode[] = [];
  let child: LexicalNode | null = root.getFirstChild();
  const endPartial: string[] = [];
  const beginPartial: string[] = [];
  let consummedSearchLength = 0;
  let skipLineBreak = false;
  let plus = 0;
  let isFirstChild = child !== null;
  while (
    child !== null &&
    (paramsObj.currentMatchIndex < indexes.length || endPartial.length > 0)
  ) {
    if (child && shouldIgnoreNodeType(child.__type)) {
      child = child.getNextSibling();
      isFirstChild = false;
      continue;
    }

    const childTxt: string = traverseNodeGetText(child);
    if (childTxt) {
      const match = /\r|\n/.exec(childTxt);
      if (!match) {
        let containedIndexes: number[] = [];
        if (endPartial.length > 0) {
          const beginMatched = searchString.substring(
            endPartial[0].length + consummedSearchLength,
            searchString.length
          );
          if (
            ciIndexOf(childTxt, beginMatched) === 0 ||
            ciIndexOf(beginMatched, childTxt) === 0
          ) {
            if (beginMatched.length === childTxt.length) {
              endPartial.push(beginMatched);
              consummedSearchLength += endPartial[0].length;
            } else if (beginMatched.length > childTxt.length) {
              endPartial.push(childTxt);
              consummedSearchLength += endPartial[0].length;
            } else {
              if (beginMatched.length > 0) {
                beginPartial.push(beginMatched);
              }
              consummedSearchLength = 0;
            }
          } else {
            consummedSearchLength = 0;
          }
          endPartial.splice(0, 1);
        } else {
          consummedSearchLength = 0;
        }
        while (
          isBetween(
            indexes[paramsObj.currentMatchIndex],
            paramsObj.previousLength,
            paramsObj.previousLength + childTxt.length - 1
          )
        ) {
          consummedSearchLength = 0;
          if (
            isBetween(
              indexes[paramsObj.currentMatchIndex] + searchString.length - 1,
              paramsObj.previousLength,
              paramsObj.previousLength + childTxt.length - 1
            )
          ) {
            containedIndexes.push(paramsObj.currentMatchIndex);
          } else {
            const matchedPart = childTxt.substring(
              indexes[paramsObj.currentMatchIndex] - paramsObj.previousLength,
              childTxt.length
            );
            endPartial.push(matchedPart);
          }
          paramsObj.currentMatchIndex += 1;
        }
        if (
          containedIndexes.length > 0 ||
          endPartial.length > 0 ||
          beginPartial.length > 0
        ) {
          const matchedAndLocations: MatchedAndLocations[] = [];
          locations(searchString, childTxt).map(function (idx) {
            matchedAndLocations.push({ matched: searchString, location: idx });
          });
          endPartial.map(function (mStr) {
            const lastIdx = ciLastIndexOf(childTxt, mStr);
            matchedAndLocations.push({ matched: mStr, location: lastIdx });
          });
          beginPartial.map(function (mStr) {
            const firstIdx = ciIndexOf(childTxt, mStr);
            matchedAndLocations.push({ matched: mStr, location: firstIdx });
          });
          beginPartial.splice(0, beginPartial.length);
          nodes.push({ node: child, realLocations: matchedAndLocations });
        }
        plus = getPlusLength(child);
        paramsObj.previousLength += childTxt.length + plus;
        skipLineBreak = false;
      } else {
        if ($isElementNode(child)) {
          const subChildrenNodes = getNoneBreakNodes(
            child,
            searchString,
            indexes,
            paramsObj
          );
          nodes.push(...subChildrenNodes);
        } else {
          skipLineBreak =
            skipLineBreak || isFirstChild || paramsObj.previousLength === 0;
          if (!skipLineBreak) {
            paramsObj.previousLength += 1;
            skipLineBreak = true;
          }
        }
        consummedSearchLength = 0;
      }
    } else {
      consummedSearchLength = 0;
    }
    child = child.getNextSibling();
    isFirstChild = false;
  }
  return nodes;
}

function updatedNodeOffset(
  node: HighlightNodes,
  stringLocations: StringLocation[],
  nodeOffsets: SplitOffset[],
  additionLocations: StringLocation[],
  mainIndex: null | { currentIndex: number } = null
) {
  const relativeStart = node.startIndex;
  const relativeEnd = node.startIndex + node.length - 1;

  if (mainIndex === null) {
    const relativeSearchStringStart = stringLocations[0].searchStart;
    const relativeSearchStringEnd =
      relativeSearchStringStart + stringLocations[0].searchLength - 1;
    if (isBetween(relativeSearchStringStart, relativeStart, relativeEnd)) {
      const realStart = relativeSearchStringStart - relativeStart;
      let realEnd: number;
      if (!isBetween(relativeSearchStringEnd, relativeStart, relativeEnd)) {
        const newLocation = relativeEnd + 1;
        const remainSearchLength = relativeSearchStringEnd - relativeEnd;
        additionLocations.push({
          searchStart: newLocation,
          searchLength: remainSearchLength,
        });
        realEnd =
          realStart + stringLocations[0].searchLength - remainSearchLength;
      } else {
        realEnd = realStart + stringLocations[0].searchLength;
      }
      additionLocations.splice(0, 1);
      nodeOffsets.push({ start: realStart, end: realEnd, isReplace: false });
    }
  } else {
    while (
      mainIndex.currentIndex < stringLocations.length &&
      isBetween(
        stringLocations[mainIndex.currentIndex].searchStart,
        relativeStart,
        relativeEnd
      )
    ) {
      const relativeSearchStringStart =
        stringLocations[mainIndex.currentIndex].searchStart;
      const realStart = relativeSearchStringStart - relativeStart;
      const relativeSearchStringEnd =
        relativeSearchStringStart +
        stringLocations[mainIndex.currentIndex].searchLength -
        1;
      if (!isBetween(relativeSearchStringEnd, relativeStart, relativeEnd)) {
        const remainSearchLength = relativeSearchStringEnd - relativeEnd;
        const realEnd =
          realStart +
          stringLocations[mainIndex.currentIndex].searchLength -
          remainSearchLength;
        nodeOffsets.push({ start: realStart, end: realEnd, isReplace: true });
        const newLocation = relativeEnd + 1;
        additionLocations.push({
          searchStart: newLocation,
          searchLength: remainSearchLength,
        });
        mainIndex.currentIndex += 1;
        return;
      } else {
        const realEnd = realStart + stringLocations[0].searchLength;
        nodeOffsets.push({ start: realStart, end: realEnd, isReplace: true });
      }
      mainIndex.currentIndex += 1;
    }
  }
}

function buildNodeKeyOffsetList(
  hNode: HighlightNodes,
  additionLocations: StringLocation[],
  originalLocations: StringLocation[],
  mainIndex: { currentIndex: number },
  nodeKeyOffsetList: NodekeyOffset[]
) {
  const nodeOffsets: SplitOffset[] = [];
  if (additionLocations.length > 0) {
    updatedNodeOffset(hNode, additionLocations, nodeOffsets, additionLocations);
  }
  updatedNodeOffset(
    hNode,
    originalLocations,
    nodeOffsets,
    additionLocations,
    mainIndex
  );
  if (nodeOffsets.length > 0) {
    nodeOffsets.map((offset) => {
      nodeKeyOffsetList.push({
        key: hNode.node.__key,
        offset: offset,
        pairKey: undefined,
      });
    });
  }
}

function selectNextKey(key: NodeKey) {
  const nodeSelection = $createNodeSelection();
  nodeSelection.add(key);
  $setSelection(nodeSelection);
}

function registerFindAndReplacePlugin(
  editor: LexicalEditor,
  props: FindAndReplaceProps
) {
  const updateListOffset = (nodeKeyOffsetList: NodekeyOffset[]) => {
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
        editor.getEditorState().read(() => {
          const root = $getRoot();
          const regex = new RegExp(preg_quote(searchString, '/'), 'gi');
          var rootText = traverseNodeGetText(root);
          rootText = rootText.replace(/\n+/g, '\n').replace(/^(\n)+/, '');

          const indexes: number[] = [];
          let found = regex.exec(rootText);
          while (found) {
            indexes.push(found.index);
            found = regex.exec(rootText);
          }
          const nodes = getNoneBreakNodes(root, searchString, indexes, {
            currentMatchIndex: 0,
            previousLength: 0,
          });

          const nodeKeyOffsetList: NodekeyOffset[] = [];
          nodes.map((node) => {
            const hightlightTarget = highlightMultipleNode(
              node.node,
              searchString,
              { startIndex: 0, totalLength: node.node.getTextContent().length }
            );
            const originalLocations: StringLocation[] = node.realLocations.map(
              (rLocation) => {
                return {
                  searchStart: rLocation.location,
                  searchLength: rLocation.matched.length,
                };
              }
            );
            const additionLocations: StringLocation[] = [];
            const mainIndex = { currentIndex: 0 };
            hightlightTarget.map((hNode) => {
              buildNodeKeyOffsetList(
                hNode,
                additionLocations,
                originalLocations,
                mainIndex,
                nodeKeyOffsetList
              );
            });
          });
          let previousPairKey = 0;
          nodeKeyOffsetList.map(function (item) {
            if (item.offset.isReplace) {
              previousPairKey += 1;
              item.pairKey = previousPairKey;
            } else {
              item.pairKey = previousPairKey;
            }
          });
          updateListOffset(nodeKeyOffsetList);
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH
    )
  );
}

export function findAndReplacePlugin(props: FindAndReplaceProps) {
  return (editor: LexicalEditor) => registerFindAndReplacePlugin(editor, props);
}
