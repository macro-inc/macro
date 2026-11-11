import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import {
  type Accessor,
  type Component,
  createComponent,
  createSignal,
} from 'solid-js';
import { registerNativeChecklist } from '../plugins/checklist/native';
import { dispatchApplicationCommand } from '../plugins/group-b/command';
import { registerNativeTableTouchSelection } from '../plugins/tables/nativeTouchSelection';
import { registerNativeTrailingParagraph } from '../plugins/trailing-paragraph/native';
import { createMenuOperations } from '../shared/inlineMenu';
import {
  type NativeUserMentionsOptions,
  NativeUserMentionsOverlay,
} from './NativeUserMentionsOverlay';
import type { NativeMarkdownOverlayInstallation } from './nativeOverlayPorts';
import { createNativeListenerScope } from './overlay-hosts/native-listeners';
import { registerNativeMentionSearch } from './overlay-hosts/native-mention-search';

/** Install only native body capabilities with an actual model action. */
export function installNativeMarkdownOverlays(
  view: EditorView,
  options: {
    readonly canEdit: Accessor<boolean>;
    readonly mentions?: NativeUserMentionsOptions;
  }
): NativeMarkdownOverlayInstallation {
  let disposed = false;
  const [renderActive, setRenderActive] = createSignal(true);
  const [mentionsAvailable, setMentionsAvailable] = createSignal(true);
  const alive = () => renderActive() && mentionsAvailable() && view.isMounted;
  let Overlays: Component | undefined;
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
          Overlays = () =>
            createComponent(NativeUserMentionsOverlay, {
              view,
              menu,
              source,
              alive,
            });
        }
      } catch (error) {
        unavailable(error);
      }
    }
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
