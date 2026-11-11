import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  type Component,
  createComponent,
  createSignal,
  ErrorBoundary,
} from 'solid-js';
import { registerNativeChecklist } from '../plugins/checklist/native';
import { dispatchApplicationCommand } from '../plugins/group-b/command';
import { registerNativeTableTouchSelection } from '../plugins/tables/nativeTouchSelection';
import { registerNativeTrailingParagraph } from '../plugins/trailing-paragraph/native';
import { createMenuOperations } from '../shared/inlineMenu';
import {
  type NativeActionsOptions,
  NativeActionsOverlay,
} from './NativeActionsOverlay';
import {
  type NativeUserMentionsOptions,
  NativeUserMentionsOverlay,
} from './NativeUserMentionsOverlay';
import type { NativeMarkdownOverlayInstallation } from './nativeOverlayPorts';
import { registerNativeInlineSearch } from './overlay-hosts/native-inline-search';
import { createNativeListenerScope } from './overlay-hosts/native-listeners';
import { registerNativeMentionSearch } from './overlay-hosts/native-mention-search';

/** Install only native body capabilities with an actual model action. */
export function installNativeMarkdownOverlays(
  view: EditorView,
  options: {
    readonly canEdit: Accessor<boolean>;
    readonly mentions?: NativeUserMentionsOptions;
    readonly actions?: NativeActionsOptions;
  }
): NativeMarkdownOverlayInstallation {
  let disposed = false;
  const [renderActive, setRenderActive] = createSignal(true);
  const [mentionsAvailable, setMentionsAvailable] = createSignal(true);
  const alive = () => renderActive() && mentionsAvailable() && view.isMounted;
  let Overlays: Component | undefined;
  const overlays: Component[] = [];
  const [actionsAvailable, setActionsAvailable] = createSignal(true);
  let actionsRetired = false;
  const actionsAlive = () =>
    !disposed &&
    !actionsRetired &&
    renderActive() &&
    actionsAvailable() &&
    view.isMounted;
  const listeners = createNativeListenerScope();
  listeners.add(() => {
    setRenderActive(false);
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    listeners.dispose();
  };
  try {
    listeners.add(registerNativeChecklist(view));
    listeners.add(registerNativeTrailingParagraph(view, options.canEdit));
    listeners.add(registerNativeTableTouchSelection(view, options.canEdit));
    if (options.mentions) {
      const menu = createMenuOperations();
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
    if (options.actions) {
      const actionsListeners = createNativeListenerScope();
      listeners.add(actionsListeners.dispose);
      const menu = createMenuOperations();
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
                });
              },
            })
          );
        }
      } catch (error) {
        unavailable(error);
      }
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
  return {
    ...(Overlays ? { Overlays } : {}),
    focusAtEnd() {
      if (!canFocus()) return;
      dispatchApplicationCommand(
        view,
        'group-b.focus-end',
        {},
        undefined,
        () => {
          if (canFocus()) view.focus();
        }
      );
    },
    dispose,
  };
}
