import { CodeNode } from '@lexical/code';
import type { CommentNode, ElementName } from '@macro-inc/lexical-core';
import {
  $getId,
  $getPeerId,
  $getSharedPeers,
  CustomCodeNode,
  DocumentMentionNode,
  ImageNode,
  UserMentionNode,
} from '@macro-inc/lexical-core';
import { cn, Layer } from '@ui';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  type EditorState,
  ElementNode,
  type LexicalEditor,
  type LexicalNode,
  RootNode,
  type TextFormatType,
  TextNode,
} from 'lexical';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
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
  root: 'text-accent bg-accent/15 border border-accent/30',
  text: 'text-red bg-red/15 border border-red/30',
  heading1: 'text-orange bg-orange/15 border border-orange/30',
  heading2: 'text-yellow bg-yellow/15 border border-yellow/30',
  heading3: 'text-lime bg-lime/15 border border-lime/30',
  paragraph: 'text-green bg-green/15 border border-green/30',
  'list-bullet': 'text-teal bg-teal/15 border border-teal/30',
  'list-check': 'text-cyan bg-cyan/15 border border-cyan/30',
  'list-number': 'text-blue bg-blue/15 border border-blue/30',
  code: 'text-violet bg-violet/15 border border-violet/30',
  'custom-code': 'text-purple bg-purple/15 border border-purple/30',
  quote: 'text-pink bg-pink/15 border border-pink/30',
  listitem: 'text-red bg-red/15 border border-red/30',
  link: 'text-yellow bg-yellow/15 border border-yellow/30',
  autolink: 'text-lime bg-lime/15 border border-lime/30',
  image: 'text-green bg-green/15 border border-green/30',
  mark: 'text-violet bg-violet/15 border border-violet/30',
  'comment-mark': 'text-purple bg-purple/15 border border-purple/30',
};

const selectionColors = {
  rangeSelection: '',
  nodeSelection: '',
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
    <span class={cn('flex space-x-1 px-1 items-center', props.class)}>
      <Show when={props.anchor}>
        <div class={cn('size-2 rounded-full', selectionColors['anchor'])}></div>
      </Show>
      <Show when={props.focus}>
        <div class={cn('size-2 rounded-full', selectionColors['focus'])}></div>
      </Show>
      <Show when={props.selected}>
        <div
          class={cn('size-2 rounded-full', selectionColors['selected'])}
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
          class={cn(
            'rounded-md border-edge',
            props.class,
            selectionColors['noSelection']
          )}
        >
          No Selection
        </div>
      }
    >
      {(selection) => (
        <div
          class={cn(
            'rounded-md border-edge',
            props.class,
            selectionColors[selection().type]
          )}
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

export function LexicalStateDebugger(props: {
  state: EditorState;
  editor: LexicalEditor;
}) {
  const state = createMemo(() => {
    let nodes = EditorStateToNodeList(props.state);
    const selection = EditorStateToSelection(props.state);
    const selectableNodes = RenderableListToSelectableList(nodes, selection);
    return { nodeList: selectableNodes, selection: selection };
  });

  const [lexicalJson, setLexicalJson] = createSignal('');
  const jsonState = createMemo(() =>
    JSON.stringify(props.state.toJSON(), null, 2)
  );
  return (
    <div class="font-mono text-ink bg-surface text-xs size-full min-h-0 flex flex-row overflow-hidden">
      <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Layer depth={0}>
          <div class="bg-surface m-2 min-h-0 flex-1 overflow-y-auto select-children rounded-md p-1 border border-edge">
            <div class="px-1">
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
                        <span class="bg-red/15 border border-red/30 text-red mx-0.5">
                          Peer ID: {node.peerId}
                        </span>
                      </Show>
                      <Show
                        when={node.sharedPeers && node.sharedPeers.length > 0}
                      >
                        <span class="bg-red/15 border border-red/30 text-red mx-0.5">
                          <For each={node.sharedPeers}>
                            {(id) => <span>{id}</span>}
                          </For>
                        </span>
                      </Show>
                      <span
                        class={cn('inline-block px-1 mx-1', colors[node.type])}
                      >
                        {node.type}
                      </span>
                      <For each={node.styles}>
                        {(style) => (
                          <span class="bg-orange/15 border border-orange/30 text-orange mx-0.5">
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
                        <span class="bg-yellow/15 border border-yellow/30 text-yellow mx-0.5">
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
                                    class="bg-yellow/15 border border-yellow/30 text-yellow mx-0.5"
                                    classList={{
                                      'bg-red/30': commentNode().getIsDraft(),
                                      'bg-red/5': !commentNode().getIsDraft(),
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
          </div>
        </Layer>
        <Layer depth={0}>
          <div class="bg-surface m-2 shrink-0">
            <Selection
              selection={state().selection}
              class="bg-surface p-1 border border-edge rounded-md"
            />
          </div>
        </Layer>
      </div>
      <div class="flex flex-col w-1/2 border-l border-edge overflow-hidden">
        <div class="flex items-center justify-between px-2 py-1 border-b border-edge shrink-0">
          <span class="text-ink-extra-muted">JSON state</span>
          <button
            type="button"
            class="border border-edge rounded-sm px-2 py-0.5 hover:bg-edge active:brightness-75"
            onClick={() => navigator.clipboard.writeText(jsonState())}
          >
            Copy
          </button>
        </div>
        <pre class="flex-1 overflow-auto p-2 text-xs select-all">
          {jsonState()}
        </pre>
        <div class="flex flex-col space-y-1 border-t border-edge p-2 shrink-0">
          <span class="text-ink-extra-muted">Import JSON</span>
          <textarea
            class="bg-surface border border-edge rounded-sm p-1 text-xs h-16 resize-none"
            placeholder='{"root":{"children":[...]}}'
            value={lexicalJson()}
            onInput={(e) => setLexicalJson(e.currentTarget.value)}
          />
          <button
            type="button"
            class="border border-edge rounded-sm px-2 py-0.5 text-xs hover:bg-edge"
            onClick={() => {
              try {
                const state = props.editor.parseEditorState(lexicalJson());
                props.editor.setEditorState(state);
              } catch (e) {
                console.error('Failed to parse editor state JSON:', e);
              }
            }}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
