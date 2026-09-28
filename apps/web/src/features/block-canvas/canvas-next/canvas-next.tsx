import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { parseMacroAppUrl } from '@core/component/LexicalMarkdown/plugins';
import {
  fileTypeToBlockName,
  resolveBlockAlias,
} from '@core/constant/allBlocks';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { createGraphicsEditor, screenToWorld } from '@macro-inc/graphics';
import { onCleanup } from 'solid-js';
import { CanvasBlockEmbed } from './block-embed-adapter';
import { createCanvasClipboard } from './clipboard';
import { createCanvasNextScene } from './core/seed-scene';
import { registerCanvasNextHotkeys } from './hotkeys';
import { createAssetState } from './primitives/create-asset-state';
import { createCanvasState } from './primitives/create-canvas-state';
import { importTextClipboard } from './primitives/text-lexical';
import { canvasAssetSource } from './queries/assets';
import { CanvasView } from './views/canvas-view';
import { createCanvasTextMeasurer } from './views/text-content';

/** Local composition root. Real document loading/saving is a later checkpoint. */
export default function CanvasNext() {
  const measurement = createCanvasTextMeasurer();
  onCleanup(measurement.dispose);
  const editor = createGraphicsEditor(createCanvasNextScene(), {
    measureText: measurement.measure,
  });
  onCleanup(editor.dispose);
  const state = createCanvasState(editor, measurement.measure);
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
  registerCanvasNextHotkeys(scopeId, state, clipboard);
  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Canvas Next" />
      </SplitHeaderLeft>
      <StaticMarkdownContext>
        <CanvasView
          state={state}
          embedView={CanvasBlockEmbed}
          assets={assets}
          onViewport={(element) => {
            viewport = element;
          }}
          onOpenDocument={(item) =>
            openWithSplit(
              {
                id: item.documentId,
                type: resolveBlockAlias(fileTypeToBlockName(item.fileType)),
              },
              { activate: true }
            )
          }
          clipboard={clipboard}
          attachScope={attachScope}
        />
      </StaticMarkdownContext>
    </>
  );
}
