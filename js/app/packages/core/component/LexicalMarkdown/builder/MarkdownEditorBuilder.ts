import type { LexicalEditor } from 'lexical';
import type { Store } from 'solid-js/store';
import type { PluginManager, SelectionData } from '../plugins';
import { buildHandleFromConfig } from './materialize';
import type {
  ActionsOptions,
  EditorBuilder,
  EditorCallbacks,
  EditorConfig,
  EditorControls,
  EditorHandle,
  EmojisOptions,
  FilePasteOptions,
  FocusLeaveCallbacks,
  HistoryOptions,
  LinksOptions,
  MediaOptions,
  MentionsOptions,
} from './types';
import type { EditorType } from '@lexical-core';

export class MarkdownEditorBuilder implements EditorBuilder {
  private state: EditorConfig;
  private _handle?: EditorHandle;
  private _queuedPlugins: Array<(editor: LexicalEditor) => () => void> = [];

  constructor(type: EditorType = 'markdown') {
    this.state = {
      type,
      namespace: 'builder-editor',
      singleLine: false,
      handlers: {},
      media: false,
      code: false,
      checkboxToTask: false,
      restoreFocus: false,
      withIds: false,
      selectionData: false,
      actions: false as const,
    };
  }

  namespace(name: string): this {
    this.state.namespace = name;
    return this;
  }

  withMentions(config: MentionsOptions = {}): this {
    this.state.mentions = {
      sources: ['users', 'documents'],
      ...config,
    };
    return this;
  }

  withEmojis(config: EmojisOptions = {}): this {
    this.state.emojis = config;
    return this;
  }

  withLinks(config: LinksOptions = {}): this {
    this.state.links = {
      floatingMenu: true,
      ...config,
    };
    return this;
  }

  withHistory(config: HistoryOptions = {}): this {
    this.state.history = {
      timeGap: 400,
      ...config,
    };
    return this;
  }

  withMedia(config?: MediaOptions): this {
    this.state.media = config ?? true;
    return this;
  }

  withCode(): this {
    this.state.code = true;
    return this;
  }

  withCheckboxToTask(): this {
    this.state.checkboxToTask = true;
    return this;
  }

  withFilePaste(config: FilePasteOptions): this {
    this.state.filePaste = config;
    return this;
  }

  withRestoreFocus(): this {
    this.state.restoreFocus = true;
    return this;
  }

  withIds(): this {
    this.state.withIds = true;
    return this;
  }

  withSelectionData(): this {
    this.state.selectionData = true;
    return this;
  }

  withActions(config: ActionsOptions = {}): this {
    this.state.actions = config;
    return this;
  }

  singleLine(): this {
    this.state.singleLine = true;
    return this;
  }

  onEnter(handler: EditorCallbacks['onEnter']): this {
    this.state.handlers.onEnter = handler;
    return this;
  }

  onEscape(handler: EditorCallbacks['onEscape']): this {
    this.state.handlers.onEscape = handler;
    return this;
  }

  onTab(handler: EditorCallbacks['onTab']): this {
    this.state.handlers.onTab = handler;
    return this;
  }

  onChange(handler: EditorCallbacks['onChange']): this {
    this.state.handlers.onChange = handler;
    return this;
  }

  onFocusLeave(config: FocusLeaveCallbacks): this {
    this.state.focusLeave = config;
    return this;
  }

  /**
   * Register a custom Lexical plugin as part of the builder chain.
   * Plugins are queued here and applied during `_materialize()` after all
   * built-in plugins have been registered.
   */
  use(pluginFn: (editor: LexicalEditor) => () => void): this {
    this._queuedPlugins.push(pluginFn);
    return this;
  }

  /**
   * @internal — called once by `<MarkdownEditor>` to instantiate reactive
   * state. Subsequent calls return the cached handle.
   */
  _materialize(): EditorHandle {
    if (this._handle) return this._handle;
    this._handle = buildHandleFromConfig(this.state);
    for (const plugin of this._queuedPlugins) {
      this._handle.plugins.use(plugin);
    }
    return this._handle;
  }

  /** Imperative controls (focus, blur, clear, get/set content). Available after `<MarkdownEditor>` mounts. */
  get controls(): EditorControls {
    if (!this._handle)
      throw new Error(
        'editor.controls accessed before <MarkdownEditor> mounted'
      );
    return this._handle.controls;
  }

  /** The underlying Lexical editor instance. Available after `<MarkdownEditor>` mounts. */
  get lexical(): LexicalEditor {
    if (!this._handle)
      throw new Error(
        'editor.lexical accessed before <MarkdownEditor> mounted'
      );
    return this._handle.lexical;
  }

  /** The plugin manager. Available after `<MarkdownEditor>` mounts. */
  get plugins(): PluginManager {
    if (!this._handle)
      throw new Error(
        'editor.plugins accessed before <MarkdownEditor> mounted'
      );
    return this._handle.plugins;
  }

  /** Reactive selection state, if `.withSelectionData()` was enabled. Available after `<MarkdownEditor>` mounts. */
  get selection(): Store<SelectionData> | undefined {
    return this._handle?.selection;
  }
}

/**
 * Creates a fluent builder for configuring a markdown editor.
 *
 * Chain feature methods to opt into capabilities, then pass the builder to
 * directly to `<MarkdownEditor editor={...} />`.
 *
 * Use the builder variable to access `controls`, `lexical`, `plugins`, and
 * `selection` after the component has mounted.
 *
 * @param type - Lexical editor mode. Defaults to `'markdown'` (full rich-text).
 *   Use `'chat'` for a mode that supports mention nodes but omits heading
 *   shortcuts, or `'plain-text'` for a plain-text-only editor.
 *
 * @example
 * ```tsx
 * const editor = buildMarkdownEditor()
 *   .namespace('my-editor')
 *   .withMentions()
 *   .withEmojis()
 *   .withLinks()
 *   .withHistory()
 *   .withMedia({ fileDrop: true })
 *   .onChange((markdown) => setValue(markdown))
 *   .onEscape(() => { containerRef()?.focus(); return true; });
 *
 * // In JSX — no .build() needed:
 * <MarkdownEditor editor={editor} placeholder="Write something..." />
 *
 * // Access controls after mount (e.g. in event handlers):
 * editor.controls.focus();
 * editor.controls.clear();
 * ```
 */
export function buildMarkdownEditor(
  type: EditorType = 'markdown'
): MarkdownEditorBuilder {
  return new MarkdownEditorBuilder(type);
}
