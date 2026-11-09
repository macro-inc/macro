/// <reference lib="esnext.disposable" preserve="true" />
import type {
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedEditorState,
  SerializedLexicalNode,
  StateConfig,
} from 'lexical';
import type {
  DocumentLexicalConflict,
  DocumentLexicalInvalid,
  DocumentLexicalNodeConflict,
} from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { MacroApiError, unwrap } from '../../utils/unwrap';
import { EditOutcomeUnknownError } from './ai-edit';
import type { Document } from './document';
import { diffBlocks } from './lexical-diff';
import { requestLexicalCommit, requestLexicalState } from './lexical-requests';

type LexicalCore = typeof import('lexical');

/** What the handle uses of `@macro-inc/sdk/lexical`. */
interface LexicalEntry {
  createDocumentEditor(): LexicalEditor;
  $getId(node: LexicalNode): string | null;
  $updateAllNodeIds(mappings: {
    idToNodeKeyMap: Map<string, NodeKey>;
    nodeKeyToIdMap: Map<NodeKey, string>;
  }): void;
  idState: StateConfig<'id', string | null>;
}

/**
 * Imported by name, not path, so bundlers keep it a separate module that a
 * program's own `@macro-inc/sdk/lexical` import shares; a variable keeps type
 * checkers of the main entry out of the vendored sources.
 */
const lexicalEntrySpecifier = '@macro-inc/sdk/lexical';

interface LexicalModules {
  core: LexicalCore;
  entry: LexicalEntry;
}

/** A node the commit could not merge, and why. */
export interface DocumentEditConflict {
  /** The conflicting node's id; null when the revision itself can't be rebuilt. */
  id: string | null;
  reason: DocumentLexicalNodeConflict['reason'];
}

/** Options for `DocumentLexical.commit`. */
export interface DocumentLexicalCommitOptions {
  /**
   * Rejects with `AbortError`. Aborted before the server starts the commit,
   * nothing applies; after that it lands whole or not at all, and the outcome
   * is unknown to the caller.
   */
  signal?: AbortSignal;
}

/** What a commit left. */
export interface DocumentLexicalCommitResult {
  /** The document's version the handle now holds (base64 Loro version vector). */
  revision: string;
  /** Link to the document in the Macro web app. */
  webUrl: string;
}

/**
 * Someone changed, removed or moved a block the commit also changed (HTTP
 * 409); nothing was applied. Read again with `document.lexical()` and redo
 * the edit on the fresh state.
 */
export class DocumentEditConflictError extends MacroApiError {
  /** Each node the commit could not merge, and why. */
  readonly conflicts: DocumentEditConflict[];

  constructor(conflict: DocumentLexicalConflict) {
    super(409, conflict);
    this.name = 'DocumentEditConflictError';
    this.conflicts = conflict.conflicts.map(({ id, reason }) => ({
      id: id ?? null,
      reason,
    }));
    this.message = `The commit conflicts with concurrent edits (${this.conflicts
      .map(({ id, reason }) => `${id ?? 'revision'}: ${reason}`)
      .join(', ')}); read the document again and redo the edit.`;
  }
}

/**
 * The server rejected the committed state (HTTP 422): an unknown node type,
 * malformed node JSON or duplicate ids.
 * Nothing changed; `reason` names the problem.
 */
export class DocumentEditInvalidError extends MacroApiError {
  /** What is wrong with the commit. */
  readonly reason: string;

  constructor(invalid: DocumentLexicalInvalid) {
    super(422, invalid);
    this.name = 'DocumentEditInvalidError';
    this.reason = invalid.message;
    this.message = invalid.message;
  }
}

const lexicalPackages =
  'lexical, @lexical/code, @lexical/headless, @lexical/link, @lexical/list, @lexical/mark, @lexical/markdown, @lexical/rich-text, @lexical/table and @lexical/utils';

async function loadLexical(): Promise<LexicalModules> {
  try {
    const [core, entry]: [LexicalCore, LexicalEntry] = await Promise.all([
      import('lexical'),
      import(lexicalEntrySpecifier),
    ]);
    return { core, entry };
  } catch (cause) {
    throw new Error(
      `Document.lexical() needs the optional peer dependencies ${lexicalPackages} at 0.45.0; install them beside @macro-inc/sdk.`,
      { cause },
    );
  }
}

/**
 * A markdown document or task body loaded into a headless Lexical editor,
 * edited with the ordinary Lexical API and committed as a merge. Get one from
 * `document.lexical()`.
 */
export class DocumentLexical {
  /**
   * A headless editor with every Macro node registered and the document
   * loaded. Anything Lexical does headless works on it; nothing needs a DOM.
   */
  readonly editor: LexicalEditor;

  #revision: string;

  #base: SerializedEditorState;

  readonly #client: MacroClient;

  readonly #document: Document;

  readonly #modules: LexicalModules;

  private constructor(
    client: MacroClient,
    document: Document,
    modules: LexicalModules,
    state: SerializedEditorState,
    revision: string,
  ) {
    this.#client = client;
    this.#document = document;
    this.#modules = modules;
    this.editor = modules.entry.createDocumentEditor();
    this.#base = this.#adopt(state);
    this.#revision = revision;
  }

  /** @internal Read the document; `Document.lexical` calls this. */
  static async open(
    client: MacroClient,
    document: Document,
  ): Promise<DocumentLexical> {
    const modules = await loadLexical();
    const { state, revision } = unwrap(
      await requestLexicalState(client, document),
    );
    return new DocumentLexical(
      client,
      document,
      modules,
      serializedState(state),
      revision,
    );
  }

  /**
   * The document version the base state was read at, or the one the last
   * commit returned. It can be behind the document; commits merge regardless.
   */
  get revision(): string {
    return this.#revision;
  }

  /**
   * Change the state with Lexical's `$` functions; the change is in the state
   * when `update` returns. Nothing is sent until `commit()`.
   */
  update(fn: () => void): void {
    this.editor.update(fn, { discrete: true });
  }

  /** Read the state with Lexical's `$` functions and return what `fn` returns. */
  read<Result>(fn: () => Result): Result {
    return this.editor.read(fn);
  }

  /**
   * Send the blocks changed since the base state; a commit merges with
   * concurrent edits by block and resolves with the new revision.
   *
   * The SDK diffs top-level blocks by node id and sends each new, changed or
   * moved block whole; blocks left alone are never written, so collaborators
   * typing elsewhere are kept. Nodes without an id get one first. The server
   * merges inside lists and tables, so edits to different items or cells
   * merge; the same node changed on both sides, a block removed by one side
   * and changed by the other, or one moved by both to different places is a
   * conflict, and nothing is applied. On success the handle adopts the merged
   * state and revision, so a program can update and commit again. An empty
   * diff sends nothing and resolves with the current revision. Retrying a
   * commit that landed is safe: it applies nothing.
   *
   * Throws `DocumentEditConflictError` (read again with `document.lexical()`
   * and redo the edit), `DocumentEditInvalidError` (nothing changed),
   * `EditOutcomeUnknownError` (read before retrying), and `AbortError` when
   * `options.signal` aborts.
   *
   * @example Check every task item, retrying once on a conflict.
   * ```js
   * import { $getRoot } from 'lexical';
   * import { $isListItemNode, $isTaskListNode } from '@macro-inc/sdk/lexical';
   *
   * async function checkAll() {
   *   const lexical = await document.lexical();
   *   lexical.update(() => {
   *     for (const block of $getRoot().getChildren()) {
   *       if (!$isTaskListNode(block)) continue;
   *       for (const item of block.getChildren())
   *         if ($isListItemNode(item)) item.setChecked(true);
   *     }
   *   });
   *   return lexical.commit();
   * }
   * try {
   *   return { data: await checkAll() };
   * } catch (error) {
   *   if (error.name !== 'DocumentEditConflictError') throw error;
   *   return { data: await checkAll() };
   * }
   * ```
   */
  async commit(
    options: DocumentLexicalCommitOptions = {},
  ): Promise<DocumentLexicalCommitResult> {
    options.signal?.throwIfAborted();
    this.#assignIds();
    const { blocks, removed } = diffBlocks(
      this.#base,
      this.editor.getEditorState().toJSON(),
    );
    const webUrl = this.#document.webUrl();
    if (blocks.length === 0 && removed.length === 0)
      return { revision: this.#revision, webUrl };

    const result = await requestLexicalCommit(
      this.#client,
      this.#document,
      { revision: this.#revision, blocks, removed },
      options.signal,
    );
    // The client reports a cancelled fetch as an error result; surface the abort.
    options.signal?.throwIfAborted();

    const status = result.response?.status;
    if (status === 409 && isConflict(result.error))
      throw new DocumentEditConflictError(result.error);
    if (status === 422 && isInvalid(result.error))
      throw new DocumentEditInvalidError(result.error);
    if (status === 502 || status === 504)
      throw new EditOutcomeUnknownError(result.error, status);
    if (result.error !== undefined && result.response === undefined)
      throw new EditOutcomeUnknownError(result.error, 0);

    const { state, revision } = unwrap(result);
    this.#base = this.#adopt(serializedState(state));
    this.#revision = revision;
    return { revision, webUrl };
  }

  /** Load `state` into the editor and return it as the editor serializes it. */
  #adopt(state: SerializedEditorState): SerializedEditorState {
    this.editor.setEditorState(this.editor.parseEditorState(state));
    return this.editor.getEditorState().toJSON();
  }

  /** Give every node a unique id: copies of an id after the first get fresh ones. */
  #assignIds(): void {
    const { core, entry } = this.#modules;
    this.update(() => {
      const seen = new Set<string>();
      const visit = (node: LexicalNode) => {
        const id = entry.$getId(node);
        if (id !== null && seen.has(id))
          core.$setState(node, entry.idState, null);
        else if (id !== null) seen.add(id);
        if (core.$isElementNode(node))
          for (const child of node.getChildren()) visit(child);
      };
      visit(core.$getRoot());
      entry.$updateAllNodeIds({
        idToNodeKeyMap: new Map(),
        nodeKeyToIdMap: new Map(),
      });
    });
  }
}

function serializedState(state: unknown): SerializedEditorState {
  if (
    typeof state !== 'object' ||
    state === null ||
    !('root' in state) ||
    typeof state.root !== 'object' ||
    state.root === null ||
    !('children' in state.root) ||
    !Array.isArray(state.root.children)
  )
    throw new MacroApiError(502, {
      message: 'the server returned a malformed Lexical state',
    });
  return state as SerializedEditorState<SerializedLexicalNode>;
}

function isConflict(error: unknown): error is DocumentLexicalConflict {
  return (
    typeof error === 'object' &&
    error !== null &&
    'conflicts' in error &&
    Array.isArray(error.conflicts)
  );
}

function isInvalid(error: unknown): error is DocumentLexicalInvalid {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  );
}
