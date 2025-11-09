import { blockElementSignal } from '@core/signal/blockElement';
import Collapse from '@icon/regular/arrow-down-right.svg';
import Expand from '@icon/regular/arrow-up-left.svg';
import { CodeNode } from '@lexical/code';
import type { CommentNode, ElementName } from '@lexical-core';
import {
  $getId,
  $getPeerId,
  $getSharedPeers,
  CustomCodeNode,
  DocumentMentionNode,
  ImageNode,
  UserMentionNode,
} from '@lexical-core';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  type EditorState,
  ElementNode,
  type LexicalNode,
  RootNode,
  type TextFormatType,
  TextNode,
} from 'lexical';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { Portal } from 'solid-js/web';
import { nodeType } from '../../plugins';
import { markNodeKeysToIDs } from '../../plugins/comments/commentPlugin';

type DebugNodeType =
  | 'root'
  | 'text'
  | 'listitem'
  | 'autolink'
  | 'image'
  | 'mark'
  | 'comment-mark'
  | ElementName;

type NodeRenderable = {
  key: string;
  type: DebugNodeType;
  depth: number;
  text: string;
  styles: string[];
  id: string | null;
  peerId: string | null;
  sharedPeers: string[] | null;
};

function textNodeToFormats(node: TextNode): string[] {
  const formats = [
    'code',
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'highlight',
    'subscript',
    'superscript',
  ];
  return formats.reduce((acc, v) => {
    if (node.hasFormat(v as TextFormatType)) {
      acc.push(v);
    }
    return acc;
  }, [] as string[]);
}

const colors: Record<DebugNodeType, string> = {
  root: 'text-accent bg-accent/15 border-1 border-accent/30',
  text: 'text-accent-30 bg-accent-30/15 border-1 border-accent-30/30',
  heading1: 'text-accent-60 bg-accent-60/15 border-1 border-accent-60/30',
  heading2: 'text-accent-90 bg-accent-90/15 border-1 border-accent-90/30',
  heading3: 'text-accent-120 bg-accent-120/15 border-1 border-accent-120/30',
  paragraph: 'text-accent-150 bg-accent-150/15 border-1 border-accent-150/30',
  'list-bullet':
    'text-accent-180 bg-accent-180/15 border-1 border-accent-180/30',
  'list-check':
    'text-accent-210 bg-accent-210/15 border-1 border-accent-210/30',
  'list-number':
    'text-accent-240 bg-accent-240/15 border-1 border-accent-240/30',
  code: 'text-accent-270 bg-accent-270/15 border-1 border-accent-270/30',
  'custom-code':
    'text-accent-300 bg-accent-300/15 border-1 border-accent-300/30',
  quote: 'text-accent-330 bg-accent-330/15 border-1 border-accent-330/30',
  listitem: 'text-accent-30 bg-accent-30/15 border-1 border-accent-30/30',
  link: 'text-accent-90 bg-accent-90/15 border-1 border-accent-90/30',
  autolink: 'text-accent-120 bg-accent-120/15 border-1 border-accent-120/30',
  image: 'text-accent-150 bg-accent-150/15 border-1 border-accent-150/30',
  mark: 'text-accent-270 bg-accent-270/15 border-1 border-accent-270/30',
  'comment-mark':
    'text-accent-300 bg-accent-300/15 border-1 border-accent-300/30',
};

const selectionColors = {
  rangeSelection: 'bg-accent-270',
  nodeSelection: 'bg-accent-240',
  noSelection: '',
  anchor: 'bg-[hotpink]',
  focus: 'bg-[gold]',
  selected: 'bg-accent/20',
};

function SelectionIndicator(props: {
  selected: boolean;
  anchor: boolean;
  focus: boolean;
  class?: string;
}) {
  return (
    <span class={`flex space-x-1 px-1 items-center ${props.class}`}>
      <Show when={props.anchor}>
        <div class={`h-2 w-2 rounded-full ${selectionColors['anchor']}`}></div>
      </Show>
      <Show when={props.focus}>
        <div class={`h-2 w-2 rounded-full ${selectionColors['focus']}`}></div>
      </Show>
      <Show when={props.selected}>
        <div
          class={`h-2 w-2 rounded-full ${selectionColors['selected']}`}
        ></div>
      </Show>
    </span>
  );
}

function getNodeText(node: LexicalNode): string {
  if (node instanceof DocumentMentionNode)
    return JSON.stringify(node.exportJSON());

  if (node instanceof UserMentionNode) return JSON.stringify(node.exportJSON());

  if (node instanceof ImageNode)
    return JSON.stringify({
      srcType: node.__srcType,
      idOrUrl: node.__id || node.__url,
    });

  if (node instanceof TextNode) {
    return node.getTextContent();
  }
  if (node instanceof CodeNode || node instanceof CustomCodeNode) {
    return node.getLanguage() ?? 'unknown language';
  }
  return '';
}

function nodeToRenderable(node: LexicalNode, depth: number): NodeRenderable {
  return {
    key: node.getKey(),
    type:
      node.getType() === 'root'
        ? 'root'
        : node.getType() === 'text'
          ? 'text'
          : nodeType(node as ElementNode),
    depth,
    text: getNodeText(node),
    styles: node instanceof TextNode ? textNodeToFormats(node) : [],
    id: $getId(node),
    peerId: $getPeerId(node),
    sharedPeers: $getSharedPeers(node),
  };
}

function traverse(
  node: LexicalNode,
  nodeList: NodeRenderable[],
  depth: number
) {
  nodeList.push(nodeToRenderable(node, depth));
  if (node instanceof ElementNode || node instanceof RootNode) {
    node.getChildren().forEach((child) => {
      traverse(child, nodeList, depth + 1);
    });
  }
}

function EditorStateToNodeList(state: EditorState): NodeRenderable[] {
  const nodeList: NodeRenderable[] = [];
  state.read(() => {
    const root = $getRoot();
    traverse(root, nodeList, 0);
  });
  return nodeList;
}

type SelectableNodeRenderable = {
  selected: boolean;
  isAnchor: boolean;
  isFocus: boolean;
} & NodeRenderable;

type SelectionRenderable =
  | {
      type: 'rangeSelection';
      anchor: { key: string; offset: number };
      focus: { key: string; offset: number };
      nodes: string[];
    }
  | {
      type: 'nodeSelection';
      nodes: string[];
    };

function RenderableListToSelectableList(
  nodes: NodeRenderable[],
  selection: SelectionRenderable | undefined
): SelectableNodeRenderable[] {
  if (!selection)
    return nodes.map((node) => ({
      ...node,
      selected: false,
      isAnchor: false,
      isFocus: false,
    }));
  if (selection.type === 'rangeSelection')
    return nodes.map((node) => ({
      ...node,
      selected: selection.nodes.includes(node.key),
      isAnchor: selection.anchor.key === node.key,
      isFocus: selection.focus.key === node.key,
    }));
  return nodes.map((node) => ({
    ...node,
    selected: selection.nodes.includes(node.key),
    isAnchor: false,
    isFocus: false,
  }));
}

function EditorStateToSelection(
  state: EditorState
): SelectionRenderable | undefined {
  return state.read(() => {
    const selection = $getSelection();
    if (!selection) return;
    if ($isRangeSelection(selection)) {
      const keys = selection.getNodes().map((node) => node.getKey());
      return {
        type: 'rangeSelection',
        anchor: { key: selection.anchor.key, offset: selection.anchor.offset },
        focus: { key: selection.focus.key, offset: selection.focus.offset },
        nodes: keys,
      };
    } else if ($isNodeSelection(selection)) {
      const keys = selection.getNodes().map((node) => node.getKey());
      return {
        type: 'nodeSelection',
        nodes: keys,
      };
    }
  });
}

function Selection(props: { selection?: SelectionRenderable; class?: string }) {
  return (
    <Show
      when={props.selection}
      fallback={
        <div
          class={`rounded-md border-edge ${props.class} ${selectionColors['noSelection']}`}
        >
          No Selection
        </div>
      }
    >
      {(selection) => (
        <div
          class={`rounded-md border-edge ${props.class} ${selectionColors[selection().type]}`}
        >
          {selection().type === 'rangeSelection'
            ? 'Range Selection'
            : 'Node Selection'}
          <div class="px-4">
            <Switch>
              <Match
                when={
                  props.selection?.type === 'rangeSelection' && props.selection
                }
              >
                {(selection) => {
                  return (
                    <div>
                      <div>selected nodes - {selection().nodes.length}</div>
                      <div>anchor offset - {selection().anchor.offset}</div>
                      <div>focus offset - {selection().focus.offset}</div>
                    </div>
                  );
                }}
              </Match>
              <Match
                when={selection().type === 'nodeSelection' && props.selection}
              >
                {(selection) => (
                  <div>selected nodes - {selection().nodes.length}</div>
                )}
              </Match>
            </Switch>
          </div>
        </div>
      )}
    </Show>
  );
}

export function LexicalStateDebugger(props: { state: EditorState }) {
  const [blockElement] = blockElementSignal;

  const state = createMemo(() => {
    let nodes = EditorStateToNodeList(props.state);
    const selection = EditorStateToSelection(props.state);
    const selectableNodes = RenderableListToSelectableList(nodes, selection);
    return { nodeList: selectableNodes, selection: selection };
  });

  const [collapsed, setCollapsed] = createSignal(true);
  return (
    <Show when={blockElement()}>
      <Portal mount={blockElement()}>
        <div
          class="absolute font-mono bottom-6 right-6 h-1/2 w-1/2 p-2 text-ink bg-panel text-xs rounded-sm border-1 border-edge opacity-95 z-30 flex flex-col space-y-1"
          classList={{
            'w-12 h-12 overflow-hidden overflow-y-hidden': collapsed(),
          }}
          style={{
            transition: 'width 0.1s ease, height 0.1s ease',
          }}
        >
          <div
            class="top-2 left-2 size-4 flex items-center justify-center bg-panel rounded-sm shadow-sm"
            role="button"
            onClick={() => {
              setCollapsed((prev) => !prev);
            }}
            tabIndex={0}
          >
            <Show
              when={collapsed()}
              fallback={<Collapse width={12} height={12} />}
            >
              <Expand width={12} height={12} />
            </Show>
          </div>
          <Show when={!collapsed()}>
            <div class="overflow-y-auto h-full bg-panel rounded-sm border-edge border-1 select-children">
              <For each={state().nodeList}>
                {(node) => {
                  return (
                    <div
                      style={{ 'margin-left': `${node.depth * 24}px` }}
                      class="flex relative"
                    >
                      <span>
                        {' '}
                        {node.depth > 0 ? '↳' : ''}[{node.key}]
                      </span>
                      <Show when={node.id}>
                        <span class="px-1 text-ink-extra-muted">{node.id}</span>
                      </Show>
                      <Show when={node.peerId}>
                        <span class="bg-accent-30/15 border-1 border-accent-30/30 text-accent-30 mx-0.5">
                          Peer ID: {node.peerId}
                        </span>
                      </Show>
                      <Show
                        when={node.sharedPeers && node.sharedPeers.length > 0}
                      >
                        <span class="bg-accent-30/15 border-1 border-accent-30/30 text-accent-30 mx-0.5">
                          <For each={node.sharedPeers}>
                            {(id) => <span>{id}</span>}
                          </For>
                        </span>
                      </Show>
                      <span
                        class={`inline-block ${colors[node.type]} px-1 mx-1`}
                      >
                        {node.type}
                      </span>
                      <For each={node.styles}>
                        {(style) => (
                          <span class="bg-accent-60/15 border-1 border-accent-60/30 text-accent-60 mx-0.5">
                            {style}
                          </span>
                        )}
                      </For>
                      <span class="inline-block">{node.text}</span>
                      <SelectionIndicator
                        anchor={node.isAnchor}
                        focus={node.isFocus}
                        selected={node.selected}
                        class=""
                      />
                      <Show
                        when={
                          node.type === 'mark' || node.type === 'comment-mark'
                        }
                      >
                        <span class="bg-accent-90/15 border-1 border-accent-90/30 text-accent-90 mx-0.5">
                          {markNodeKeysToIDs.get(node.key)?.join(', ') ?? ''}
                        </span>
                        <Show when={node.type === 'comment-mark'}>
                          {(_) => {
                            const commentNode = () =>
                              $getNodeByKey(
                                node.key,
                                props.state
                              ) as CommentNode | null;
                            return (
                              <Show when={commentNode()}>
                                {(commentNode) => (
                                  <span
                                    class="bg-accent-90/15 border-1 border-accent-90/30 text-accent-90 mx-0.5"
                                    classList={{
                                      'bg-accent-30/30':
                                        commentNode().getIsDraft(),
                                      'bg-accent-30/5':
                                        !commentNode().getIsDraft(),
                                    }}
                                  >
                                    {commentNode().getThreadId() ?? 'NO # ID'}
                                  </span>
                                )}
                              </Show>
                            );
                          }}
                        </Show>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
          <Selection
            selection={state().selection}
            class="bg-edge/10 p-1 border-1 border-edge"
          />
        </div>
      </Portal>
    </Show>
  );
}
