import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  type Component,
  createComponent,
  createSignal,
  ErrorBoundary,
  Show,
} from 'solid-js';
import { registerNativeBlockNavigation } from '../plugins/block-decorator-navigation/native';
import { registerNativeCheckboxToTaskShortcut } from '../plugins/checkbox-to-task/native';
import { registerNativeChecklist } from '../plugins/checklist/native';
import { dispatchApplicationCommand } from '../plugins/group-b/command';
import { registerNativeListSwipeIndent } from '../plugins/list-swipe-indent/native';
import { registerNativeTabIndentation } from '../plugins/tab-indentation/native';
import { registerNativeTableKeys } from '../plugins/tables/nativeKeys';
import { registerNativeTableTouchSelection } from '../plugins/tables/nativeTouchSelection';
import { registerNativeTrailingParagraph } from '../plugins/trailing-paragraph/native';
import { registerNativeWordNavigation } from '../plugins/word-navigation/native';
import { createMenuOperations } from '../shared/inlineMenu';
import {
  type NativeActionsOptions,
  NativeActionsOverlay,
} from './NativeActionsOverlay';
import { NativeDraggableBlockOverlay } from './NativeDraggableBlockOverlay';
import { NativeEmojiOverlay } from './NativeEmojiOverlay';
import {
  type NativeSnippetsOptions,
  NativeSnippetsOverlay,
} from './NativeSnippetsOverlay';
import { NativeTableHoverOverlay } from './NativeTableHoverOverlay';
import { type NativeTagsOptions, NativeTagsOverlay } from './NativeTagsOverlay';
import {
  type NativeUserMentionsOptions,
  NativeUserMentionsOverlay,
} from './NativeUserMentionsOverlay';
import type { NativeMarkdownOverlayInstallation } from './nativeOverlayPorts';
import type { NativeActionCommands } from './overlay-hosts/native-actions';
import {
  createNativeComments,
  type NativeComments,
} from './overlay-hosts/native-comments';
import { registerNativeInlineSearch } from './overlay-hosts/native-inline-search';
import { createNativeListenerScope } from './overlay-hosts/native-listeners';
import { registerNativeMentionSearch } from './overlay-hosts/native-mention-search';
import { createNativeSnippetMenuHost } from './overlay-hosts/native-snippets-menu';
import { registerNativeTagsSearch } from './overlay-hosts/native-tags-search';

/** Install only native body capabilities with an actual model action. */
export function installNativeMarkdownOverlays(
  view: EditorView,
  options: {
    readonly canEdit: Accessor<boolean>;
    /** Source checkbox-to-task conversion (Mod+Shift+O). */
    readonly tasks?: {
      readonly currentUserId: Accessor<string | undefined>;
      readonly parentTaskId?: string;
    };
    readonly emoji?: boolean;
    readonly mentions?: NativeUserMentionsOptions;
    readonly snippets?: NativeSnippetsOptions;
    readonly actions?: NativeActionsOptions;
    readonly tags?: NativeTagsOptions;
    readonly formatting?: Component;
    readonly comments?: boolean;
    readonly checklist?: Component;
  }
): NativeMarkdownOverlayInstallation {
  let disposed = false;
  const [renderActive, setRenderActive] = createSignal(true);
  const [mentionsAvailable, setMentionsAvailable] = createSignal(true);
  const alive = () => renderActive() && mentionsAvailable() && view.isMounted;
  let Overlays: Component | undefined;
  const overlays: Component[] = [];
  const [emojiAvailable, setEmojiAvailable] = createSignal(true);
  const emojiAlive = () => renderActive() && emojiAvailable() && view.isMounted;
  const [snippetsAvailable, setSnippetsAvailable] = createSignal(true);
  const snippetsAlive = () =>
    renderActive() && snippetsAvailable() && view.isMounted;
  const [tagsAvailable, setTagsAvailable] = createSignal(true);
  const tagsAlive = () => renderActive() && tagsAvailable() && view.isMounted;
  const [actionsAvailable, setActionsAvailable] = createSignal(true);
  const [actionCommands, setActionCommands] =
    createSignal<NativeActionCommands>();
  let actionsRetired = false;
  const actionsAlive = () =>
    !disposed &&
    !actionsRetired &&
    renderActive() &&
    actionsAvailable() &&
    view.isMounted;
  const listeners = createNativeListenerScope();
  const openMenus: Accessor<boolean>[] = [];
  listeners.add(() => {
    setRenderActive(false);
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    listeners.dispose();
  };
  let comments: NativeComments | undefined;
  try {
    listeners.add(registerNativeBlockNavigation(view));
    listeners.add(registerNativeTabIndentation(view));
    listeners.add(registerNativeWordNavigation(view));
    listeners.add(registerNativeChecklist(view));
    if (options.tasks)
      listeners.add(registerNativeCheckboxToTaskShortcut(view, options.tasks));
    listeners.add(registerNativeListSwipeIndent(view, options.canEdit));
    if (options.comments) {
      const installed = createNativeComments(view);
      comments = installed;
      listeners.add(() => installed.dispose());
    }
    listeners.add(registerNativeTrailingParagraph(view, options.canEdit));
    listeners.add(registerNativeTableKeys(view));
    listeners.add(registerNativeTableTouchSelection(view, options.canEdit));
    const dragListeners = createNativeListenerScope();
    listeners.add(dragListeners.dispose);
    const [dragAvailable, setDragAvailable] = createSignal(true);
    let dragRetired = false;
    const reportDrag = (error: unknown) => {
      try {
        Telemetry.error(error, { surface: 'native-block-drag' });
      } catch {
        // An optional handle failure preserves the document and sibling overlays.
      }
    };
    const retireDrag = (error: unknown) => {
      dragRetired = true;
      reportDrag(error);
      try {
        setDragAvailable(false);
      } catch (retirementError) {
        reportDrag(retirementError);
      } finally {
        try {
          dragListeners.dispose();
        } catch (cleanupError) {
          reportDrag(cleanupError);
        }
      }
    };
    overlays.push(() =>
      createComponent(ErrorBoundary, {
        fallback(error: unknown) {
          retireDrag(error);
          return null;
        },
        get children() {
          return (
            dragAvailable() &&
            createComponent(NativeDraggableBlockOverlay, {
              view,
              canEdit: options.canEdit,
              alive: () =>
                !disposed && !dragRetired && renderActive() && view.isMounted,
              own(cleanup) {
                if (disposed || dragRetired) cleanup();
                else dragListeners.add(cleanup);
              },
            })
          );
        },
      })
    );
    const tableListeners = createNativeListenerScope();
    listeners.add(tableListeners.dispose);
    const [tableAvailable, setTableAvailable] = createSignal(true);
    let tableRetired = false;
    const reportTable = (error: unknown) => {
      try {
        Telemetry.error(error, { surface: 'native-table-hover' });
      } catch {
        // Optional border controls cannot prevent opening the document.
      }
    };
    const retireTable = (error: unknown) => {
      tableRetired = true;
      reportTable(error);
      try {
        setTableAvailable(false);
      } catch (retirementError) {
        reportTable(retirementError);
      } finally {
        try {
          tableListeners.dispose();
        } catch (cleanupError) {
          reportTable(cleanupError);
        }
      }
    };
    overlays.push(() =>
      createComponent(ErrorBoundary, {
        fallback(error: unknown) {
          retireTable(error);
          return null;
        },
        get children() {
          return (
            tableAvailable() &&
            createComponent(NativeTableHoverOverlay, {
              view,
              canEdit: options.canEdit,
              alive: () =>
                !disposed && !tableRetired && renderActive() && view.isMounted,
              own(cleanup) {
                if (disposed || tableRetired) cleanup();
                else tableListeners.add(cleanup);
              },
              onUnavailable: retireTable,
            })
          );
        },
      })
    );
    if (options.emoji) {
      const menu = createMenuOperations();
      openMenus.push(menu.isOpen);
      const unavailable = (error: unknown) => {
        setEmojiAvailable(false);
        try {
          Telemetry.error(error, { surface: 'native-emoji-menu' });
        } catch {
          // Optional menu failure must not tear down the document or its overlays.
        }
      };
      try {
        listeners.add(
          registerNativeInlineSearch(view, menu, 'emojis', ':', unavailable)
        );
        if (emojiAvailable()) {
          overlays.push(() =>
            createComponent(NativeEmojiOverlay, {
              view,
              menu,
              alive: emojiAlive,
            })
          );
        }
      } catch (error) {
        unavailable(error);
      }
    }
    if (options.mentions) {
      const menu = createMenuOperations();
      openMenus.push(menu.isOpen);
      const source = options.mentions;
      const unavailable = (error: unknown) => {
        setMentionsAvailable(false);
        try {
          Telemetry.error(error, { surface: 'native-mention-menu' });
        } catch {
          // Optional menu failure must not tear down the document or its overlays.
        }
      };
      try {
        listeners.add(registerNativeMentionSearch(view, menu, unavailable));
        if (mentionsAvailable()) {
          overlays.push(() =>
            createComponent(NativeUserMentionsOverlay, {
              view,
              menu,
              source,
              alive,
            })
          );
        }
      } catch (error) {
        unavailable(error);
      }
    }
    // MarkdownEditor's tags plugin sits in the afterMentions slot.
    if (options.tags) {
      const menu = createMenuOperations();
      openMenus.push(menu.isOpen);
      const source = options.tags;
      const unavailable = (error: unknown) => {
        setTagsAvailable(false);
        try {
          Telemetry.error(error, { surface: 'native-tags-menu' });
        } catch {
          // Optional menu failure must not tear down the document or its overlays.
        }
      };
      try {
        listeners.add(registerNativeTagsSearch(view, menu, unavailable));
        if (tagsAvailable()) {
          overlays.push(() =>
            createComponent(NativeTagsOverlay, {
              view,
              menu,
              source,
              alive: tagsAlive,
            })
          );
        }
      } catch (error) {
        unavailable(error);
      }
    }
    if (options.snippets) {
      const menu = createMenuOperations();
      openMenus.push(menu.isOpen);
      const source = options.snippets;
      const unavailable = (error: unknown) => {
        setSnippetsAvailable(false);
        try {
          Telemetry.error(error, { surface: 'native-snippets-menu' });
        } catch {
          // Optional menu failure must not tear down the document or its overlays.
        }
      };
      try {
        const snippets = createNativeSnippetMenuHost(view, menu, {
          sourceDocumentId: source.sourceDocumentId,
          alive: snippetsAlive,
        });
        listeners.add(snippets.dispose);
        listeners.add(
          registerNativeInlineSearch(view, menu, 'snippets', ';', unavailable)
        );
        if (snippetsAvailable()) {
          overlays.push(() =>
            createComponent(NativeSnippetsOverlay, {
              host: snippets.host,
              menu,
              source,
              alive: snippetsAlive,
            })
          );
        }
      } catch (error) {
        unavailable(error);
      }
    }
    if (options.actions) {
      const actionsListeners = createNativeListenerScope();
      listeners.add(actionsListeners.dispose);
      const menu = createMenuOperations();
      openMenus.push(menu.isOpen);
      const source = options.actions;
      const report = (error: unknown) => {
        try {
          Telemetry.error(error, { surface: 'native-action-menu' });
        } catch {
          // Optional menu failures preserve the document and sibling overlays.
        }
      };
      const own = (cleanup: () => void) => {
        if (disposed || actionsRetired) cleanup();
        else actionsListeners.add(cleanup);
      };
      const unavailable = (error: unknown) => {
        actionsRetired = true;
        report(error);
        try {
          try {
            setActionsAvailable(false);
          } catch (retirementError) {
            report(retirementError);
          }
          menu.setIsOpen(false);
        } catch (retirementError) {
          report(retirementError);
        } finally {
          try {
            actionsListeners.dispose();
          } catch (cleanupError) {
            report(cleanupError);
          }
        }
      };
      try {
        own(
          registerNativeInlineSearch(view, menu, 'actions', '/', unavailable)
        );
        if (actionsAvailable()) {
          overlays.push(() =>
            createComponent(ErrorBoundary, {
              fallback(error: unknown) {
                unavailable(error);
                return null;
              },
              get children() {
                return createComponent(NativeActionsOverlay, {
                  view,
                  menu,
                  source,
                  canEdit: options.canEdit,
                  alive: actionsAlive,
                  own,
                  onUnavailable: unavailable,
                  publish: (commands) => setActionCommands(() => commands),
                });
              },
            })
          );
        }
      } catch (error) {
        unavailable(error);
      }
    }
    if (options.formatting) {
      const Formatting = options.formatting;
      overlays.push(() =>
        createComponent(Show, {
          keyed: true,
          get when() {
            return renderActive();
          },
          get children() {
            return createComponent(Formatting, {});
          },
        })
      );
    }
    if (options.checklist) {
      const Checklist = options.checklist;
      overlays.push(() =>
        createComponent(Show, {
          keyed: true,
          get when() {
            return renderActive();
          },
          get children() {
            return createComponent(Checklist, {});
          },
        })
      );
    }
    if (overlays.length)
      Overlays = () => overlays.map((Overlay) => createComponent(Overlay, {}));
  } catch (error) {
    disposed = true;
    listeners.fail(error);
  }
  const canFocus = () =>
    !disposed &&
    view.isMounted &&
    options.canEdit() &&
    view.root.contentEditable === 'true';
  const focusAfter = (command: string) => {
    if (!canFocus()) return;
    dispatchApplicationCommand(view, command, {}, undefined, () => {
      if (canFocus()) view.focus();
    });
  };
  return {
    ...(Overlays ? { Overlays } : {}),
    ...(comments ? { comments } : {}),
    focusAtEnd: () => focusAfter('group-b.focus-end'),
    titleHandoff: {
      atStart: () => focusAfter('group-b.focus-start'),
      prependParagraph: () => focusAfter('group-b.prepend-paragraph'),
    },
    menuOpen: () => openMenus.some((isOpen) => isOpen()),
    actions: () => (actionsAlive() ? actionCommands() : undefined),
    dispose,
  };
}
