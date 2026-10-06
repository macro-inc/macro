import { useSplitLayout } from '@components/app/split-layout/layout';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { parseMacroAppUrl } from '@core/component/LexicalMarkdown/plugins';
import {
  fileTypeToBlockName,
  resolveBlockAlias,
} from '@core/constant/allBlocks';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { GraphicsEditor, TextMeasurer } from '@macro-inc/graphics';
import { createGraphicsEditor, screenToWorld } from '@macro-inc/graphics';
import { fetchDocumentMetadata } from '@queries/storage/document-metadata';
import { onCleanup, Show } from 'solid-js';
import { CanvasBlockEmbed } from './block-embed-adapter';
import { createCanvasClipboard } from './clipboard';
import type { CanvasFile } from './core/document-format';
import { registerCanvasNextHotkeys } from './hotkeys';
import { createAssetState } from './primitives/create-asset-state';
import { createCanvasState } from './primitives/create-canvas-state';
import { importTextClipboard } from './primitives/text-lexical';
import { canvasAssetSource } from './queries/assets';
import { CanvasReadOnlyView } from './views/canvas-read-only-view';
import { CanvasView } from './views/canvas-view';
import { createCanvasTextMeasurer } from './views/text-content';

export function CanvasNextEditor(props: {
  initial: CanvasFile;
  canEdit: boolean;
  fitOnLoad?: boolean;
  onReady?: (editor: GraphicsEditor, finishText: () => void) => void;
}) {
  const measurement = createCanvasTextMeasurer();
  onCleanup(measurement.dispose);
  const editor = createGraphicsEditor(props.initial.document, {
    measureText: measurement.measure,
  });
  onCleanup(editor.dispose);
  let finishText = () => {};
  props.onReady?.(editor, () => finishText());
  return (
    <StaticMarkdownContext>
      <Show
        when={props.canEdit}
        fallback={
          <CanvasReadOnlyView editor={editor} fitOnLoad={props.fitOnLoad} />
        }
      >
        <EditableCanvasNext
          editor={editor}
          measureText={measurement.measure}
          fitOnLoad={props.fitOnLoad}
          canEdit={() => props.canEdit}
          onFinishReady={(finish) => {
            finishText = finish;
          }}
        />
      </Show>
    </StaticMarkdownContext>
  );
}

function EditableCanvasNext(props: {
  editor: GraphicsEditor;
  measureText: TextMeasurer;
  fitOnLoad?: boolean;
  canEdit: () => boolean;
  onFinishReady: (finish: () => void) => void;
}) {
  const editor = props.editor;
  const state = createCanvasState(editor, props.measureText);
  const assets = createAssetState(state, canvasAssetSource);
  const { openWithSplit } = useSplitLayout();
  let viewport: HTMLElement | undefined;
  const center = () =>
    screenToWorld(editor.getCamera(), {
      x: (viewport?.clientWidth ?? 800) / 2,
      y: (viewport?.clientHeight ?? 600) / 2,
    });
  const clipboard = createCanvasClipboard(
    editor,
    state.setNotice,
    (text, html) => {
      const link = parseMacroAppUrl(text);
      if (link.isValid && link.id && link.block) {
        assets.document(
          { id: link.id, name: 'Document', fileType: link.block },
          center()
        );
        return;
      }
      state.text.insert(importTextClipboard(text, html), center());
      state.chooseTool('select');
    },
    (files) => {
      void assets.files(files, center());
    }
  );
  const [attachScope, scopeId] = useHotkeyDOMScope('canvas-next');
  registerCanvasNextHotkeys(scopeId, state, clipboard, props.canEdit);
  props.onFinishReady(state.text.finish);
  onCleanup(() => {
    state.text.finish();
    state.inspector.cancel();
    state.text.cancel();
    state.eraser.cancel();
    state.connector.interaction.cancel();
    state.embeds.exit();
    assets.cancelPending();
    editor.cancelShape();
    editor.cancelTransform();
    props.onFinishReady(() => {});
  });
  return (
    <CanvasView
      fitOnLoad={props.fitOnLoad}
      state={state}
      scopeId={scopeId}
      embedView={CanvasBlockEmbed}
      assets={assets}
      onViewport={(element) => {
        viewport = element;
      }}
      onOpenDocument={async (item) => {
        try {
          const fileType =
            item.fileType === 'unknown'
              ? (await fetchDocumentMetadata(item.documentId)).fileType
              : item.fileType;
          openWithSplit(
            {
              id: item.documentId,
              type: resolveBlockAlias(fileTypeToBlockName(fileType)),
            },
            { activate: true }
          );
        } catch {
          state.setNotice('Could not open this document');
        }
      }}
      clipboard={clipboard}
      attachScope={attachScope}
    />
  );
}
