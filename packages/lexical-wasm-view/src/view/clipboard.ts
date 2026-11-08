import {
  EditorInputMsg,
  type IClipboardEntryMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { Telemetry } from '@macro-inc/observability';
import type { EditorView } from './editor-view';
import type { EditorPort } from './port';
import { readSelection, sameSelection } from './selection';
import { selectionMessage } from './session-port';
import type { ViewSelection } from './types';

/** Ephemeral host facts retained until the matching native admission completes. */
export interface ClipboardFacts {
  readonly entries: readonly IClipboardEntryMsg[];
  release(): void;
}
export class ClipboardAccess {
  private readonly providers = new Set<
    (clipboard: DataTransfer) => ClipboardFacts
  >();
  private readonly pending = new Set<() => void>();
  registerFacts(
    provider: (clipboard: DataTransfer) => ClipboardFacts
  ): () => void {
    this.providers.add(provider);
    return () => this.providers.delete(provider);
  }
  dispose(): void {
    this.providers.clear();
    for (const release of this.pending) release();
  }
  constructor(
    private readonly view: EditorView,
    private readonly port: EditorPort
  ) {}
  formats(kind: 0 | 1 | 2 = 0) {
    return this.port.clipboard(kind);
  }
  async paste(
    clipboard: DataTransfer,
    selection: ViewSelection = readSelection(this.view)
  ): Promise<boolean> {
    const view = this.view;
    const facts: ClipboardFacts[] = [];
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.pending.delete(release);
      for (const fact of facts) fact.release();
    };
    this.pending.add(release);
    try {
      for (const provider of this.providers) facts.push(provider(clipboard));
    } catch (error) {
      release();
      throw error;
    }
    const revision = view.revision,
      originalSelection = readSelection(view);
    const html = clipboard.getData('text/html');
    const lexical = clipboard.getData('application/x-lexical-editor');
    const entries = [...clipboard.types].map((mime) => ({
      mime,
      value: clipboard.getData(mime),
    }));
    entries.push(...facts.flatMap((fact) => fact.entries));
    const hasFiles = clipboard.files.length > 0;
    const span =
      view.options.parentSpan?.span('editor.paste') ??
      Telemetry.span('editor.paste');
    let admitted = false;
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
            }),
            release
          )
        );
      } finally {
        phase.end();
      }
      admitted = true;
      return true;
    } catch (error) {
      span.error('paste failed');
      throw error;
    } finally {
      if (!admitted) release();
      span.end();
    }
  }
}
