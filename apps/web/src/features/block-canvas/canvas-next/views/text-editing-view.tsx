import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import {
  cssMatrix,
  type GraphicsEditor,
  multiply,
  worldMatrix,
} from '@macro-inc/graphics';
import { textLayoutStyle } from '@macro-inc/graphics/browser';
import { FORMAT_ELEMENT_COMMAND, type SerializedEditorState } from 'lexical';
import { For, onCleanup } from 'solid-js';
import type { CanvasTextState } from '../primitives/create-text-state';
import {
  createCanvasTextConfig,
  serializeCanvasText,
} from '../primitives/text-lexical';
import './text.css';

export function TextEditingView(props: {
  text: CanvasTextState;
  editor: GraphicsEditor;
  camera: () => { x: number; y: number; scale: number };
  onFinish: () => void;
}) {
  const draft = () => props.text.draft()!;
  const initialState: SerializedEditorState = JSON.parse(
    draft().geometry.content
  );
  const config = createCanvasTextConfig(props.text.change)
    .onEscape((event) => {
      event.preventDefault();
      props.onFinish();
      return true;
    })
    .onEnter((event) => {
      if (!event.metaKey && !event.ctrlKey) return false;
      props.onFinish();
      return true;
    });
  onCleanup(() => props.text.setFlush(undefined));
  const matrix = () => {
    const { x, y, scale } = props.camera();
    return multiply(
      [scale, 0, 0, scale, x, y],
      multiply(
        worldMatrix(props.editor.document, draft().placement.parentId),
        draft().transform
      )
    );
  };
  return (
    <>
      <div
        data-canvas-text-editor
        class="canvas-lexical-text"
        style={{
          position: 'absolute',
          left: '0',
          top: '0',
          'transform-origin': '0 0',
          transform: cssMatrix(matrix()),
          'z-index': 2,
          ...textLayoutStyle(draft().geometry),
          'min-width': '8px',
          color: draft().appearance.stroke,
          opacity: draft().appearance.opacity ?? 1,
          'user-select': 'text',
          'touch-action': 'auto',
          cursor: 'text',
        }}
        on:pointerdown={(event) => event.stopPropagation()}
        on:dblclick={(event) => event.stopPropagation()}
      >
        <MarkdownShell
          config={config}
          initialState={initialState}
          autofocus
          placeholder=""
          class="canvas-text-shell"
          refFn={(element) => {
            element.setAttribute('role', 'textbox');
            element.setAttribute(
              'aria-label',
              props.text.isLabel() ? 'Shape label' : 'Canvas text'
            );
          }}
          onConnect={() => {
            props.text.setFlush(() =>
              props.text.change(serializeCanvasText(config.lexical))
            );
            config.lexical.getRootElement()?.focus({ preventScroll: true });
            config.lexical.focus();
          }}
        />
      </div>
      <div
        data-canvas-text-toolbar
        role="toolbar"
        aria-label="Text formatting"
        class="absolute left-1/2 top-20 z-30 flex -translate-x-1/2 gap-1 rounded-lg border border-edge-muted bg-panel p-1.5 shadow-lg"
        on:pointerdown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        on:mousedown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <For each={['left', 'center', 'right'] as const}>
          {(align) => (
            <button
              type="button"
              aria-label={`Text align ${align}`}
              class="rounded px-2 py-1 text-xs capitalize hover:bg-hover"
              onClick={() =>
                config.lexical.dispatchCommand(FORMAT_ELEMENT_COMMAND, align)
              }
            >
              {align}
            </button>
          )}
        </For>
        <button
          type="button"
          class="rounded bg-accent-bg px-3 py-1 text-xs text-accent"
          onClick={props.onFinish}
        >
          Done
        </button>
      </div>
    </>
  );
}
