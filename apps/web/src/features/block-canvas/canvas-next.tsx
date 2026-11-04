import { useSplitLayout } from '@components/app/split-layout/layout';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { resolvePastedMacroAppUrl } from '@core/component/LexicalMarkdown/plugins/text-paste/textPastePlugin';
import {
  fileTypeToBlockName,
  resolveBlockAlias,
} from '@core/constant/allBlocks';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { fireAndForget } from '@core/util/fireAndForget';
import type { GraphicsEditor, TextMeasurer } from '@macro-inc/graphics';
import {
  createGraphicsEditor,
  createGraphicsEditorFromBackend,
  screenToWorld,
} from '@macro-inc/graphics';
import {
  createLoroGraphicsBackendFromDoc,
  type GraphicsPresence,
} from '@macro-inc/graphics/loro';
import { fetchDocumentMetadata } from '@queries/storage/document-metadata';
import type { LoroDoc } from 'loro-crdt';
import { onCleanup, Show } from 'solid-js';
import { CanvasBlockEmbed } from './block-embed-adapter';
import { createCanvasClipboard } from './clipboard';
import { readSharedCanvas } from './core/collaboration';
import type { CanvasFile } from './core/document-format';
import { registerCanvasNextHotkeys } from './hotkeys';
import { createAssetState } from './primitives/create-asset-state';
import { createCanvasPresence } from './primitives/create-canvas-presence';
import { createCanvasState } from './primitives/create-canvas-state';
import { createCanvasInsertState } from './primitives/create-insert-state';
import { observeObjectSnapping } from './primitives/observe-object-snapping';
import { importTextClipboard } from './primitives/text-lexical';
import { canvasAssetSource } from './queries/assets';
import type { CanvasSession } from './queries/canvas-session';
import { CanvasReadOnlyView } from './views/canvas-read-only-view';
import { CanvasView } from './views/canvas-view';
import { createCanvasTextMeasurer } from './views/text-content';

export function CanvasNextEditor(props: {
  documentId: string;
  initial: CanvasFile;
  doc?: LoroDoc;
  session?: CanvasSession;
  displayName?: (userId: string | undefined) => string;
  canEdit: boolean;
  isEmbedded?: boolean;
  fitOnLoad?: boolean;
  onReady?: (editor: GraphicsEditor, finishText: () => void) => void;
}) {
  const measurement = createCanvasTextMeasurer();
  onCleanup(measurement.dispose);
  const options = { measureText: measurement.measure };
  const backend = props.doc
    ? createLoroGraphicsBackendFromDoc(
        props.doc,
        readSharedCanvas(props.doc).document.rootId,
        () => {
          const state = props.session?.state();
          return (
            props.canEdit &&
            !props.isEmbedded &&
            (!state || (state.t === 'ready' && state.doc === props.doc))
          );
        }
      )
    : undefined;
  if (backend) onCleanup(backend.dispose);
  const editor = backend
    ? createGraphicsEditorFromBackend(backend, options)
    : createGraphicsEditor(props.initial.document, options);
  onCleanup(editor.dispose);
  const presence =
    backend && props.session
      ? createCanvasPresence(
          editor,
          props.session,
          backend.getClock,
          props.displayName ?? (() => 'Someone')
        )
      : undefined;
  let finishText = () => {};
  props.onReady?.(editor, () => finishText());
  return (
    <StaticMarkdownContext>
      <Show
        when={props.canEdit && !props.isEmbedded}
        fallback={
          <CanvasReadOnlyView
            editor={editor}
            fitOnLoad={props.fitOnLoad}
            presence={presence}
          />
        }
      >
        <EditableCanvasNext
          documentId={props.documentId}
          editor={editor}
          presence={presence}
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
  documentId: string;
  editor: GraphicsEditor;
  presence?: GraphicsPresence;
  measureText: TextMeasurer;
  fitOnLoad?: boolean;
  canEdit: () => boolean;
  onFinishReady: (finish: () => void) => void;
}) {
  const editor = props.editor;
  const state = createCanvasState(editor, props.measureText);
  observeObjectSnapping(editor, props.documentId);
  const assets = createAssetState(state, canvasAssetSource);
  const insert = createCanvasInsertState(editor.getCamera);
  const { openWithSplit } = useSplitLayout();
  const resolveAppLink = useMacroMentionLinkResolver();
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
      const link = resolvePastedMacroAppUrl(text, resolveAppLink);
      if (link?.id && link.block) {
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
      fireAndForget(assets.files(files, center()), 'canvas-assets');
    },
    { canvasId: props.documentId, center }
  );
  const [attachScope, scopeId] = useHotkeyDOMScope('canvas-next');
  registerCanvasNextHotkeys(
    scopeId,
    state,
    clipboard,
    props.canEdit,
    insert.open
  );
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
      presence={props.presence}
      scopeId={scopeId}
      embedView={CanvasBlockEmbed}
      assets={assets}
      insert={insert}
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
