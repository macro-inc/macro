import { registerRichText } from '@lexical/rich-text';
import {
  $addUpdateTag,
  $createTabNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  createEditor,
  type LexicalEditor,
  type LexicalNode,
  LineBreakNode,
  ParagraphNode,
  REDO_COMMAND,
  type SerializedEditorState,
  TabNode,
  TextNode,
  UNDO_COMMAND,
} from 'lexical';
import { $reconcileLexicalState } from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/collaboration/reconcile';
import { registerLoroHistory } from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/collaboration/undo';
import { LoroManager } from '../../../collaboration/src/collab/manager';
import { MARKDOWN_LORO_SCHEMA } from '../../../lexical-core/markdown-loro-schema';
import {
  $updateAllNodeIds,
  type NodeIdMappings,
  nodeIdPlugin,
} from '../../../lexical-core/plugins/nodeIdPlugin';
import type { Edit, Observation } from './native';

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
export class Upstream {
  readonly manager: LoroManager<typeof MARKDOWN_LORO_SCHEMA>;
  readonly editor: LexicalEditor;
  private readonly mappings: NodeIdMappings = {
    idToNodeKeyMap: new Map(),
    nodeKeyToIdMap: new Map(),
  };
  private readonly cleanups: Array<() => void> = [];
  private readonly root: HTMLDivElement;
  private readonly frame: HTMLIFrameElement;
  private history = { undo: false, redo: false };
  private readonly writes = new Set<Promise<void>>();
  private failure: Error | undefined;
  private async settled() {
    for (let round = 0; round < 100; round++) {
      await settle();
      if (this.failure) throw this.failure;
      if (!this.writes.size) return;
      await Promise.all([...this.writes]);
    }
    throw new Error('upstream binding did not settle');
  }
  private constructor(peer: number) {
    this.manager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
      documentId: 'collab-differential',
    });
    this.manager.doc.setPeerId(BigInt(peer));
    this.manager.doc.setRecordTimestamp(false);
    this.editor = createEditor({
      namespace: `collab-${peer}`,
      nodes: [],
      onError(error) {
        throw error;
      },
    });
    // Each browser peer owns its own DOM selection and selectionchange target.
    this.frame = document.createElement('iframe');
    document.body.append(this.frame);
    const owner = this.frame.contentDocument!;
    const range = (this.frame.contentWindow! as Window & typeof globalThis)
      .Range.prototype;
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(),
    });
    Object.defineProperty(range, 'getClientRects', {
      configurable: true,
      value: () => [],
    });
    this.root = owner.createElement('div');
    this.root.contentEditable = 'true';
    owner.body.append(this.root);
    this.editor.setRootElement(this.root);
    this.cleanups.push(registerRichText(this.editor));
    this.cleanups.push(
      this.editor.registerCommand(
        CAN_UNDO_COMMAND,
        (value) => {
          this.history.undo = value;
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    );
    this.cleanups.push(
      this.editor.registerCommand(
        CAN_REDO_COMMAND,
        (value) => {
          this.history.redo = value;
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    );
    this.cleanups.push(
      nodeIdPlugin({
        nodes: [ParagraphNode, TextNode, LineBreakNode, TabNode],
        mappings: this.mappings,
      })(this.editor)
    );
    this.cleanups.push(
      registerLoroHistory(this.editor, this.manager, 400, 100)
    );
  }
  static async create(peer: number, snapshot: Uint8Array) {
    const self = new Upstream(peer);
    const result = await self.manager.initializeFromSnapshot(snapshot);
    if (result.isErr()) throw new Error(JSON.stringify(result.error));
    const initial =
      self.manager.mirror!.getState() as unknown as SerializedEditorState;
    self.editor.setEditorState(self.editor.parseEditorState(initial));
    await settle();
    self.editor.update(() => $updateAllNodeIds(self.mappings), {
      discrete: true,
      tag: 'collab-selection',
    });
    self.editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    await settle();
    self.cleanups.push(
      self.manager.onStateChange(({ state, metadata }) => {
        if (metadata.direction !== 'FROM_LORO') return;
        self.reconcile(state as unknown as SerializedEditorState);
      })
    );
    // Same update gate as CollabProvider.syncLexicalToLoro. The core/rich
    // profile has no completion, draft, ownership or search-text fields to filter.
    self.cleanups.push(
      self.editor.registerUpdateListener(
        ({ editorState, mutatedNodes, tags }) => {
          if (
            tags.has('from-loro') ||
            tags.has('collaboration') ||
            tags.has('local-status') ||
            tags.has('code-highlight-ids')
          )
            return;
          if (!mutatedNodes || mutatedNodes.size === 0) return;
          const task = self.manager
            .syncToLoro(editorState.toJSON() as never)
            .then((result) => {
              if (result.isErr())
                self.failure = new Error(JSON.stringify(result.error));
            })
            .catch((error) => {
              self.failure = error as Error;
            });
          self.writes.add(task);
          void task.finally(() => self.writes.delete(task));
        }
      )
    );
    return self;
  }
  private reconcile(state: SerializedEditorState) {
    this.editor.update(
      () => {
        $addUpdateTag('collaboration');
        $addUpdateTag('skip-dom-selection');
        $setSelection(null);
        $reconcileLexicalState(
          this.editor.getEditorState().toJSON(),
          state,
          this.mappings,
          () => this.manager.doc.peerIdStr
        );
        // Match CollabProvider's follow-up scheduling; it shares the pending ID
        // mutation-listener update instead of forcing a second synchronous commit.
        queueMicrotask(() =>
          this.editor.update(() => {
            $addUpdateTag('collab-selection');
            $updateAllNodeIds(this.mappings);
          })
        );
      },
      { discrete: true, tag: 'from-loro' }
    );
  }
  async remote(bytes: number[]) {
    const before = this.manager.doc.version();
    const result = this.manager.importUpdate(Uint8Array.from(bytes));
    if (result.isErr()) throw new Error(JSON.stringify(result.error));
    await this.settled();
    const changed =
      (this.manager.doc.version().get(this.manager.doc.peerId) ?? 0) >
      (before.get(this.manager.doc.peerId) ?? 0);
    return this.observe(
      changed
        ? Array.from(this.manager.doc.export({ mode: 'update', from: before }))
        : []
    );
  }
  async edit(edit: Edit) {
    const before = this.manager.doc.version();
    this.manager.doc.setNextCommitTimestamp(Math.floor(edit.now / 1000));
    if (edit.kind === 'undo' || edit.kind === 'redo') {
      this.editor.dispatchCommand(
        edit.kind === 'undo' ? UNDO_COMMAND : REDO_COMMAND,
        undefined
      );
      await this.settled();
    } else {
      this.editor.update(
        () => {
          let node: LexicalNode = $getRoot();
          for (const index of edit.path) {
            if (!$isElementNode(node)) throw new Error('invalid element path');
            node = node.getChildren()[index];
            if (!node) throw new Error('missing node');
          }
          if ($isTextNode(node)) node.select(edit.from, edit.to);
          else if ($isElementNode(node)) node.select(edit.from, edit.to);
          else throw new Error('selection target must be text or element');
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) throw new Error('range required');
          switch (edit.kind) {
            case 'insert':
              selection.insertText(edit.text);
              break;
            case 'remove':
              selection.removeText();
              break;
            case 'paragraph':
              selection.insertParagraph();
              break;
            case 'linebreak':
              selection.insertLineBreak();
              break;
            case 'tab':
              selection.insertNodes([$createTabNode()]);
              break;
            case 'format':
              selection.formatText('bold');
              break;
          }
        },
        { discrete: true }
      );
      await this.settled();
    }
    return this.observe(
      Array.from(this.manager.doc.export({ mode: 'update', from: before }))
    );
  }
  observe(bytes: number[] = []): Observation {
    return {
      value: this.manager.doc.toJSON(),
      editor: this.editor
        .getEditorState()
        .toJSON() as unknown as Observation['editor'],
      bytes,
      history: { ...this.history },
    };
  }
  close() {
    for (const cleanup of this.cleanups.reverse()) cleanup();
    this.editor.setRootElement(null);
    this.root.remove();
    this.frame.remove();
    this.manager.dispose();
  }
}
