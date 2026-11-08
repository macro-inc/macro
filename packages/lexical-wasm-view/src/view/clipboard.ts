import { EditorInputMsg } from '@macro-inc/collaboration/session/abi.generated';
import { Telemetry } from '@macro-inc/observability';
import type { EditorView } from './editor-view';
import type { EditorPort } from './port';
import { readSelection, sameSelection } from './selection';
import { selectionMessage } from './session-port';
import type { ViewSelection } from './types';

export class ClipboardAccess {
  constructor(
    private readonly view: EditorView,
    private readonly port: EditorPort
  ) {}
  formats(kind: 0 | 1 = 0) {
    return this.port.clipboard(kind);
  }
  async paste(
    clipboard: DataTransfer,
    selection: ViewSelection = readSelection(this.view)
  ): Promise<boolean> {
    const view = this.view;
    const revision = view.revision,
      originalSelection = readSelection(view);
    const html = clipboard.getData('text/html');
    const lexical = clipboard.getData('application/x-lexical-editor');
    const entries = [...clipboard.types].map((mime) => ({
      mime,
      value: clipboard.getData(mime),
    }));
    const hasFiles = clipboard.files.length > 0;
    const span =
      view.options.parentSpan?.span('editor.paste') ??
      Telemetry.span('editor.paste');
    try {
      let htmlNodes: string[] = [];
      if (html && !lexical) {
        const phase = span.span('html_import');
        phase.setAttr('bytes', new TextEncoder().encode(html).byteLength);
        try {
          const importer = await import('./html-import');
          htmlNodes = importer.importHTML(
            html,
            view.root.ownerDocument,
            view.registry
          );
          phase.setAttr('nodes', htmlNodes.length);
        } finally {
          phase.end();
        }
      }
      if (
        !view.root.isConnected ||
        !view.isMounted ||
        view.revision !== revision ||
        !sameSelection(originalSelection, readSelection(view))
      )
        return false;
      const phase = span.span('session.input');
      try {
        phase.run(() =>
          this.port.input(
            EditorInputMsg.fromEditorPaste({
              selection: selectionMessage(selection),
              clipboard: entries,
              hasFiles,
              htmlNodes,
            })
          )
        );
      } finally {
        phase.end();
      }
      return true;
    } catch (error) {
      span.error('paste failed');
      throw error;
    } finally {
      span.end();
    }
  }
}
