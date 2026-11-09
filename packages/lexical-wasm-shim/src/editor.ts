import type { EditorThemeClasses } from 'lexical';
import { createBackend } from './backend/factory';
import { DEFAULT_EDITOR_DOM_CONFIG } from './editor-dom-config';
import type { NodeClass } from './foreign/registry';
import { ElementNode, LexicalNode, nativeNode, RootNode } from './nodes';
import type {
  EditorConfig,
  EditorDOMRenderConfig,
} from './nodes/editor-config';
import { NodeRuntime, withNodeRuntime } from './nodes/runtime';
import { UpdateController, type UpdateOptions } from './update';

let activeEditor: LexicalEditor | undefined;
let activeStateEditor: LexicalEditor | undefined;
let readOnlyMode = false;

export function isCurrentlyReadOnlyMode(): boolean {
  return readOnlyMode;
}

export function getActiveEditor(): LexicalEditor {
  if (activeEditor === undefined)
    throw new Error(
      'Unable to find an active editor. This method can only be used synchronously during the callback of editor.update() or editor.read().'
    );
  return activeEditor;
}

export function getActiveStateEditor(): LexicalEditor {
  if (activeStateEditor === undefined)
    throw new Error(
      'Unable to find an active editor state. State helpers or node methods can only be used synchronously during the callback of editor.update(), editor.read(), or editorState.read().'
    );
  return activeStateEditor;
}

export interface CreateEditorArgs {
  readonly namespace?: string;
  readonly theme?: EditorThemeClasses;
  readonly disableEvents?: boolean;
  readonly dom?: Partial<EditorDOMRenderConfig>;
  readonly parentEditor?: LexicalEditor | null;
  readonly nodes?: readonly NodeClass[];
  readonly onError?: (error: unknown, editor: LexicalEditor) => void;
}

export class EditorState {
  private readonly ownership: object;
  private readonly snapshot: unknown;

  constructor(
    private readonly editor: LexicalEditor,
    private readonly version: number
  ) {
    this.ownership = editor.runtime.handles.pinVersion(version);
    this.snapshot = editor.runtime.backend.readState(String(version), () =>
      editor.runtime.backend.call('LexicalEditor.getEditorState', [])
    );
  }

  read<T>(body: () => T, options?: { editor?: LexicalEditor }): T {
    if (options?.editor !== undefined && options.editor !== this.editor)
      throw new Error('state belongs to another editor');
    // The closure pins the version owner through callbacks and synchronous GC.
    const owner = this.ownership;
    let result: { value: T } | undefined;
    this.editor.runtime.backend.readState(String(this.version), () => {
      result = {
        value: this.editor.scope(body, options?.editor !== undefined, true),
      };
      return owner;
    });
    if (result === undefined) throw new Error('state read did not run');
    return result.value;
  }

  isEmpty(): boolean {
    return this.read(() => {
      const root = this.editor.runtime.call('lexical.$getRoot', []);
      if (!(root instanceof RootNode)) throw new Error('expected model root');
      return (
        root.getChildrenSize() === 0 &&
        this.editor.runtime.call('lexical.$getSelection', []) === null
      );
    });
  }

  toJSON(): unknown {
    return this.read(() =>
      this.editor.runtime.backend.call('EditorState.toJSON', [], this.snapshot)
    );
  }
}

export class LexicalEditor {
  readonly _config: EditorConfig;
  readonly _parentEditor: LexicalEditor | null;
  readonly _keyToDOMMap = new Map<string, HTMLElement>();
  readonly runtime: NodeRuntime;
  get _dirtyLeaves(): Set<string> {
    return this.runtime.backend.getUpdateMetadata().dirtyLeaves;
  }
  get _dirtyElements(): Map<string, boolean> {
    return this.runtime.backend.getUpdateMetadata().dirtyElements;
  }
  get _dirtyType(): number {
    return this.runtime.backend.getUpdateMetadata().dirtyType;
  }
  private readonly updates: UpdateController;
  private state: EditorState;

  constructor(editorConfig?: CreateEditorArgs) {
    const config = editorConfig || {};
    this._parentEditor =
      editorConfig === undefined
        ? (activeEditor ?? null)
        : config.parentEditor || null;
    this._config = {
      namespace:
        config.namespace ||
        this._parentEditor?._config.namespace ||
        Math.random()
          .toString(36)
          .replace(/[^a-z]+/g, '')
          .substring(0, 5),
      theme: config.theme || {},
      disableEvents: config.disableEvents || false,
      dom: { ...DEFAULT_EDITOR_DOM_CONFIG, ...config.dom },
    };
    const onError = config.onError;
    const backend = createBackend(config, this._config);
    this.runtime = new NodeRuntime(backend, nativeNode);
    this.state = new EditorState(this, backend.initialVersion);
    this.updates = new UpdateController({
      backend,
      scope: (body) => this.scope(body),
      apply: (packet) => {
        const metadata: unknown = JSON.parse(packet.metadata_json);
        if (
          metadata === null ||
          typeof metadata !== 'object' ||
          !('version' in metadata) ||
          typeof metadata.version !== 'number'
        )
          throw new Error('invalid committed model version');
        this.state = new EditorState(this, metadata.version);
      },
      onError: (error) => {
        if (onError !== undefined) onError(error, this);
        else throw error;
      },
    });
  }

  scope<T>(body: () => T, associated = true, readOnly = false): T {
    const previous = activeEditor;
    const previousState = activeStateEditor;
    const previousReadOnly = readOnlyMode;
    readOnlyMode = readOnly;
    activeEditor = associated ? this : undefined;
    activeStateEditor = this;
    try {
      return withNodeRuntime(this.runtime, body);
    } finally {
      activeEditor = previous;
      activeStateEditor = previousState;
      readOnlyMode = previousReadOnly;
    }
  }

  update(body: () => void, options?: UpdateOptions): void {
    this.updates.update(body, options);
  }
  read<T>(body: () => T): T {
    this.updates.flush();
    return this.state.read(body, { editor: this });
  }
  getElementByKey(key: string): HTMLElement | null {
    return this._keyToDOMMap.get(key) ?? null;
  }
  getEditorState(): EditorState {
    return this.state;
  }
  registerUpdateListener(
    listener: (payload: {
      editorState: EditorState;
      prevEditorState: EditorState;
    }) => void
  ): () => void {
    let previous = this.state;
    return this.updates.addUpdateListener(() => {
      const prevEditorState = previous;
      previous = this.state;
      listener({ editorState: this.state, prevEditorState });
    });
  }
  registerNodeTransform(
    klass: { getType(): string },
    listener: (node: LexicalNode) => void
  ): () => void {
    const id = this.runtime.backend.registerTransform(klass.getType(), (raw) =>
      this.scope(() => {
        const node = this.runtime.decode(raw);
        if (!(node instanceof LexicalNode))
          throw new Error('expected transform node');
        listener(node);
      })
    );
    return () => this.runtime.backend.unregister(id);
  }
  dispose(): void {
    this.updates.dispose();
  }
}

export function createEditor(config?: CreateEditorArgs): LexicalEditor {
  return new LexicalEditor(config);
}

export function $getRoot(): RootNode {
  const node = getActiveStateEditor().runtime.call('lexical.$getRoot', []);
  if (!(node instanceof RootNode)) throw new Error('expected model root');
  return node;
}
export function $getNodeByKey(key: string): LexicalNode | null {
  const node = getActiveStateEditor().runtime.call('lexical.$getNodeByKey', [
    key,
  ]);
  if (node === null || node instanceof LexicalNode) return node;
  throw new Error('expected model node');
}
export function $isElementNode(node: unknown): node is ElementNode {
  return node instanceof ElementNode;
}

export {
  DEFAULT_EDITOR_DOM_CONFIG,
  getEditorDOMRenderConfig,
} from './editor-dom-config';
export type {
  EditorConfig,
  EditorDOMRenderConfig,
} from './nodes/editor-config';
