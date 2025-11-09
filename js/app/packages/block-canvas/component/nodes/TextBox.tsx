import { type Vector2, vec2 } from '@block-canvas/util/vector2';
import { useBlockId } from '@core/block';
import { DecoratorRenderer } from '@core/component/LexicalMarkdown/component/core/DecoratorRenderer';
import { NodeAccessoryRenderer } from '@core/component/LexicalMarkdown/component/core/NodeAccessoryRenderer';
import { MentionsMenu } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  codePlugin,
  createAccessoryStore,
  DefaultShortcuts,
  keyboardShortcutsPlugin,
  mentionsPlugin,
  tabIndentationPlugin,
  textPastePlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  initializeEditorEmpty,
  setEditorStateFromMarkdown,
} from '@core/component/LexicalMarkdown/utils';
import { ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
import { useCanEdit } from '@core/signal/permissions';
import { normalizeEnterPlugin } from 'core/component/LexicalMarkdown/plugins/normalize-enter';
import {
  $getRoot,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
} from 'lexical';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  type Setter,
  Show,
  untrack,
} from 'solid-js';
import {
  DRAG_THRESHOLD,
  type RenderMode,
  RenderModes,
  type Tool,
  Tools,
} from '../../constants';
import type { TextNode } from '../../model/CanvasModel';
import { useCanvasHistory } from '../../signal/canvasHistory';
import { useSelection } from '../../signal/selection';
import { useToolManager } from '../../signal/toolManager';
import { useCanvasNodes } from '../../store/canvasData';
import { useTextNodeEditors } from '../../store/textNodeEditors';
import { getTailwindColor } from '../../util/style';
import { BaseCanvasRectangle } from './BaseCanvasRectangle';

false && clickOutside;

function TextBoxEditor(props: {
  node: TextNode;
  editable: Accessor<boolean>;
  setter: Setter<LexicalEditor | undefined>;
  onFocus?: () => void;
  onBlur?: () => void;
  onTextChange?: (value: string) => void;
  onHeightChange?: (height: number) => void;
  onWidthChange?: (width: number) => void;
  focusOnMount?: boolean;
  blockId?: string;
}) {
  const { registerEditor, unregisterEditor } = useTextNodeEditors();
  const canEdit = useCanEdit();
  let mountRef!: HTMLDivElement;

  const toolManager = useToolManager();

  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'canvas-text-box',
    isInteractable: createMemo(() => {
      return canEdit() ?? false;
    }),
  });

  const { editor, plugins, cleanup } = lexicalWrapper;
  props.setter(editor);

  const [markdownState, setMarkdownState] = createSignal<string>(
    props.node.text
  );

  const resizeObserver = new ResizeObserver((entries) => {
    const height = entries[0].borderBoxSize[0].blockSize;
    const width = entries[0].borderBoxSize[0].inlineSize;
    props.onHeightChange && props.onHeightChange(height);
    props.onWidthChange && props.onWidthChange(width);
  });

  onMount(() => {
    resizeObserver.observe(mountRef, { box: 'border-box' });
    editor.setRootElement(mountRef);
    if (props.focusOnMount) {
      setTimeout(() => editor.focus());
    }
    // Register the editor for this text node
    registerEditor(props.node.id, editor);
  });

  const text = createMemo(() => props.node.text);

  // TODO: trim text?
  if (text() && text() !== '') {
    setEditorStateFromMarkdown(editor, text());
  } else {
    initializeEditorEmpty(editor);
  }

  onCleanup(() => {
    // Unregister the editor before cleanup
    unregisterEditor(props.node.id);
    editor.setRootElement(null);
    resizeObserver.disconnect();
    cleanup();
  });

  const mentionsMenuOperations = createMenuOperations();

  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .state<string>(setMarkdownState, 'markdown-internal')
    .history(400)
    .use(tabIndentationPlugin())
    .use(
      mentionsPlugin({
        menu: mentionsMenuOperations,
        sourceDocumentId: props.blockId,
      })
    )
    .use((editor) => {
      return editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          editor.getRootElement()?.blur();
          return true;
        },
        COMMAND_PRIORITY_LOW
      );
    })
    .use(
      keyboardShortcutsPlugin({
        shortcuts: DefaultShortcuts,
      })
    )
    .use(textPastePlugin())
    .use(normalizeEnterPlugin());

  const textwrapStyles = createMemo(() => {
    return {
      'white-space': props.node.followTextWidth ? 'pre' : 'pre-wrap',
      width: props.node.followTextWidth ? 'max-content' : '100%',
    };
  });

  if (props.focusOnMount) {
    plugins.use((editor: LexicalEditor) => {
      return editor.registerRootListener((root) => {
        if (root === null) return;
        Object.assign(root.style, textwrapStyles());
      });
    });
  }

  createEffect(() => {
    const val = markdownState();
    if (props.editable()) {
      props.onTextChange?.(val);
    }
  });

  createEffect(() => {
    const val = text();
    if (val && val !== untrack(markdownState)) {
      setEditorStateFromMarkdown(editor, val);
      setMarkdownState(val);
    }
  });

  onMount(() => {
    // Lexical sets user-select in its mount so we have to set it again.
    mountRef.style.userSelect = props.editable() ? 'text' : 'none';
  });

  const [accessoryStore, setAccessoryStore] = createAccessoryStore();
  plugins.use(
    codePlugin({
      setAccessories: setAccessoryStore,
      accessories: accessoryStore,
    })
  );

  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      <div
        class="w-full absolute m-0 top-0 left-0"
        classList={{
          'bg-edge/15': props.editable(),
        }}
        style={{
          ...textwrapStyles(),
          'pointer-events': props.editable() ? 'auto' : 'none',
          'user-select': props.editable() ? 'text' : 'none',
        }}
        ref={mountRef}
        onfocus={() => {
          props.onFocus?.();
        }}
        onblur={() => {
          editor.update(() => $setSelection(null));
          props.onBlur?.();
        }}
        onmousedown={(e) => {
          e.stopPropagation();
          toolManager.setSelectedTool(Tools.Typing);
        }}
        ontouchstart={(e) => {
          e.stopPropagation();
          toolManager.setSelectedTool(Tools.Typing);
        }}
        onkeydown={() => {
          toolManager.setSelectedTool(Tools.Typing);
        }}
        contentEditable={props.editable()}
      />
      <ScopedPortal>
        <MentionsMenu
          editor={editor}
          menu={mentionsMenuOperations}
          useBlockBoundary={true}
          emails={() => []}
        />
      </ScopedPortal>
      <DecoratorRenderer editor={editor} />
      <NodeAccessoryRenderer editor={editor} store={accessoryStore} />
    </LexicalWrapperContext.Provider>
  );
}

export function TextBox(props: { node: TextNode; mode: RenderMode }) {
  const canEdit = useCanEdit();
  const activeTool = useToolManager().activeTool;
  const history = useCanvasHistory();
  const selection = useSelection();
  const nodes = useCanvasNodes();
  const toolManager = useToolManager();
  const blockId = useBlockId();

  const style = createMemo((): Partial<JSX.CSSProperties> => {
    return {
      color: props.node.style?.strokeColor ?? getTailwindColor('gray-700'),
      'font-size': `${props.node.style?.textSize ?? 24}px`,
    };
  });

  const [editor, setEditor] = createSignal<LexicalEditor>();

  let focusOnMount = props.node.id === nodes.lastCreated();

  const [editable, setEditable] = createSignal(focusOnMount);

  const [selfMouseDownPosition, setSelfMouseDownPosition] =
    createSignal<Vector2 | null>(null);

  /* let touchTimer: Timer | null = null;

  const touchStart = (e: TouchEvent) => {
    if (touchTimer == null) {
      touchTimer = setTimeout(() => {
        touchTimer = null;
      }, 500);
    } else {
      if (!userCanEdit()) return;
      e.preventDefault();
      e.stopPropagation();

      if (activeTool() !== Tools.Select && activeTool() !== Tools.Text) return;

      toolManager.abortAll();

      setEditable(true);

      editor()?.update(() => {
        const root = $getRoot();
        root.selectEnd();
      });

      clearTimeout(touchTimer);
      touchTimer = null;
    }
  }; */

  const doubleClick = (e: MouseEvent) => {
    if (!canEdit()) return;
    e.stopPropagation();

    if (activeTool() !== Tools.Select && activeTool() !== Tools.Text) return;

    toolManager.abortAll();

    setEditable(true);

    editor()?.update(() => {
      const root = $getRoot();
      root.selectEnd();
    });
  };

  const onClick = (e: MouseEvent | TouchEvent) => {
    const pos = selfMouseDownPosition();
    const upPos =
      e instanceof MouseEvent
        ? vec2(e.pageX, e.pageY)
        : vec2(e.changedTouches[0].pageX, e.changedTouches[0].pageY);

    if (pos && pos.distance(upPos) > DRAG_THRESHOLD) {
      return;
    }
    if (!canEdit()) return;
    if (activeTool() !== Tools.Text) return;
    e.stopPropagation();
    toolManager.abortAll();
    setEditable(true);
  };

  const [_lastSelectedTool, setLastSelectedTool] = createSignal<Tool>(
    Tools.Select
  );

  const showClickBlocker = createMemo(() => {
    if (toolManager.isDragging()) return true;
    const pos = selfMouseDownPosition();
    if (!pos) return false;
    if (toolManager.mousePosition().distance(pos) > DRAG_THRESHOLD) {
      return true;
    }
  });

  return (
    <BaseCanvasRectangle
      node={props.node}
      mode={props.mode}
      showEdgeHandles={false}
      clickable={!editable()}
      useSimpleSelectionBox={true}
    >
      <Show when={props.mode === RenderModes.Basic}>
        <div
          class="h-full w-full absolute top-0 left-0 bg-transparent"
          style={{
            'pointer-events': 'auto',
            'user-select': 'none',
            ...style(),
            overflow: 'hidden',
          }}
          on:pointerdown={(e) => {
            setSelfMouseDownPosition(vec2(e.pageX, e.pageY));
          }}
          on:dblclick={doubleClick}
          on:click={onClick}
          //on:touchstart={touchStart}
          on:touchend={onClick}
          on:pointerup={() => {
            setSelfMouseDownPosition(null);
          }}
        >
          <TextBoxEditor
            node={props.node}
            editable={editable}
            setter={setEditor}
            blockId={blockId}
            onFocus={() => {
              setLastSelectedTool(toolManager.selectedTool());
              toolManager.setSelectedTool(Tools.Typing);
              toolManager.setActiveTextEditor(true);
              selection.deselectAll();
              selection.selectNode(props.node.id);
              history.open();
            }}
            onBlur={() => {
              toolManager.setSelectedTool(Tools.Select);
              toolManager.setActiveTextEditor(false);
              setEditable(false);
              batch(() => {
                if (props.node.followTextWidth) {
                  nodes.updateNode(props.node.id, { followTextWidth: false });
                }
                if (props.node.text === `\n \n`) {
                  // Empty case. See LexicalMarkdown/transformers.ts.
                  selection.deselectNode(props.node.id);
                  nodes.delete(props.node.id);
                }
              });
              history.close();
              nodes.save();
              nodes.setLastCreated();
            }}
            onTextChange={(val) =>
              nodes.updateNode(props.node.id, { text: val })
            }
            focusOnMount={focusOnMount}
            onHeightChange={(height: number) => {
              nodes.updateNode(props.node.id, { height: height });
            }}
            onWidthChange={(width: number) => {
              if (props.node.followTextWidth) {
                nodes.updateNode(props.node.id, { width: width + 2 });
              }
            }}
          />
          {/* click blocker */}
          <div
            class="w-full h-full absolute top-0 left-0 invisible"
            classList={{
              visible: showClickBlocker(),
            }}
          />
        </div>
      </Show>
    </BaseCanvasRectangle>
  );
}
