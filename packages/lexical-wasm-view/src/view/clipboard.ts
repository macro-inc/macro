import {
  EditorInputMsg,
  type IClipboardEntryMsg,
  type IPasteIntentMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type { Span } from '@macro-inc/observability';
import type { EditorView } from './editor-view';
import { startEditorPerformance } from './performance';
import type { EditorPort } from './port';
import { readSelection, sameSelection } from './selection';
import { selectionMessage } from './session-port';
import type { ViewSelection } from './types';

/** Match the pinned source clipboard precheck before choosing its HTML fallback. */
function matchesLexicalNamespace(
  serialized: string,
  namespace: string
): boolean {
  try {
    const payload: unknown = JSON.parse(serialized);
    return (
      payload !== null &&
      typeof payload === 'object' &&
      'namespace' in payload &&
      payload.namespace === namespace &&
      'nodes' in payload &&
      Array.isArray(payload.nodes)
    );
  } catch {
    return false;
  }
}

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
    selection: ViewSelection = readSelection(this.view),
    intent: IPasteIntentMsg = { plainOnly: false }
  ): Promise<boolean> {
    const plainOnly = intent.plainOnly;
    const view = this.view;
    const measurement = startEditorPerformance(view, 'editor.paste');
    const span = measurement.span;
    const facts: ClipboardFacts[] = [];
    let released = false;
    let outcome = 'cancelled';
    let inputPhase: Span | undefined;
    const release = () => {
      if (released) return;
      released = true;
      this.pending.delete(release);
      try {
        for (const fact of facts) fact.release();
      } finally {
        inputPhase?.end();
        measurement.finish(outcome);
      }
    };
    this.pending.add(release);
    let admitted = false;
    try {
      const read = span.span('editor.paste.clipboard_read');
      let html: string;
      let lexical: string;
      let entries: IClipboardEntryMsg[];
      let revision: number;
      let originalSelection: ViewSelection;
      try {
        for (const provider of this.providers) facts.push(provider(clipboard));
        revision = view.revision;
        originalSelection = readSelection(view);
        html = clipboard.getData('text/html');
        lexical = clipboard.getData('application/x-lexical-editor');
        entries = [...clipboard.types].map((mime) => ({
          mime,
          value: clipboard.getData(mime),
        }));
        entries.push(...facts.flatMap((fact) => fact.entries));
        span.setAttr('editor.paste.html_code_units', html.length);
        span.setAttr('editor.paste.lexical_code_units', lexical.length);
        span.setAttr(
          'editor.paste.clipboard_code_units',
          entries.reduce((sum, entry) => sum + entry.value.length, 0)
        );
      } finally {
        read.end();
      }
      const hasFiles = clipboard.files.length > 0;
      let htmlNodes: string[] = [];
      if (html && !matchesLexicalNamespace(lexical, view.options.namespace)) {
        const load = span.span('editor.paste.import_module');
        let importer: typeof import('./html-import');
        try {
          importer = await import('./html-import');
        } finally {
          load.end();
        }
        const phase = span.span('editor.paste.html_import');
        try {
          htmlNodes = importer.importHTML(
            html,
            view.root.ownerDocument,
            view.registry
          );
          phase.setAttr('editor.paste.imported_node_count', htmlNodes.length);
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
      const phase = span.span('editor.paste.session_input');
      inputPhase = phase;
      try {
        const paste = {
          selection: selectionMessage(selection),
          clipboard: entries,
          hasFiles,
          htmlNodes,
        };
        const input = plainOnly
          ? EditorInputMsg.fromEditorPasteWithIntent({
              ...paste,
              intent: { plainOnly },
            })
          : EditorInputMsg.fromEditorPaste(paste);
        phase.run(() =>
          this.port.input(input, (handled) => {
            outcome = handled ? 'success' : 'unhandled';
            release();
          })
        );
      } finally {
        phase.end();
      }
      if (!released) inputPhase = span.span('editor.paste.completion_wait');
      admitted = true;
      return true;
    } catch (error) {
      outcome = 'error';
      span.error('paste failed');
      throw error;
    } finally {
      if (!admitted) release();
    }
  }
}
