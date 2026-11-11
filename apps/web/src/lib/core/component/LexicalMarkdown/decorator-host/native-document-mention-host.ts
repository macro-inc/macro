import { createViewCommand } from '@macro-inc/lexical-wasm-view/view/commands';
import type { DecoratorProps } from '@macro-inc/lexical-wasm-view/view/registry';
import type { EditorThemeClasses } from 'lexical';
import { dispatchApplicationCommandIfSessionEdit } from '../plugins/group-b/command';
import type { DocumentMentionHost } from './document-mention-host';
import type { NativeDecoratorContext } from './native-adapter';
import { createNativeSelectionDecoratorContext } from './native-selection-host';

/** The owner supplies actual surface interaction policy; native admission remains authoritative. */
export function createNativeDocumentMentionContext(
  theme: EditorThemeClasses,
  options: {
    isInteractable(): boolean;
    readonly skipPreviewFetch?: boolean;
  }
): NativeDecoratorContext<DocumentMentionHost> & { dispose(): void } {
  const selection = createNativeSelectionDecoratorContext(theme);
  let view: DecoratorProps['view'] | undefined;
  let generation: number | null = null;
  let alive = true;
  const releases = new Set<() => void>();
  const current = () =>
    alive && view?.isMounted && view.mirror.keyGeneration === generation
      ? view
      : undefined;
  function releaseWithOwner(release: () => void) {
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      releases.delete(dispose);
      release();
    };
    releases.add(dispose);
    return dispose;
  }
  function edit(
    key: string,
    action: 'remove' | 'to-text' | 'to-card' | 'collapse',
    fields: { text?: string; collapsed?: boolean } = {}
  ) {
    const currentView = current();
    const index = Number(key);
    if (
      !currentView ||
      !Number.isSafeInteger(index) ||
      String(index) !== key ||
      !currentView.node(index) ||
      !currentView.getElementByKey(index)
    )
      return;
    // Readers can collapse a preview locally; only session edit access writes it.
    dispatchApplicationCommandIfSessionEdit(
      currentView,
      'group-b.document-mention',
      { key: index, action, ...fields }
    );
  }
  return {
    theme,
    host: {
      isSelected: selection.host.isSelected,
      isEditable: () => current()?.isEditable ?? false,
      isInteractable: () => !!current() && options.isInteractable(),
      canEmbed: () =>
        !!current()?.mirror.hasType('document-card') &&
        !!current()?.registry.has('document-card') &&
        options.isInteractable(),
      get skipPreviewFetch() {
        return options.skipPreviewFetch ?? false;
      },
      registerEditableListener(listener) {
        const v = current();
        if (!v) throw new Error('Document decorator requires a live view');
        return releaseWithOwner(v.onEditableChange(listener));
      },
      registerNormalEnter(listener) {
        const currentView = current();
        if (!currentView?.port.nativeEnter)
          throw new Error(
            'Document mention requires the actual native Normal Enter slot'
          );
        const KeyboardEvent =
          currentView.root.ownerDocument.defaultView?.KeyboardEvent;
        if (!KeyboardEvent)
          throw new Error(
            'Document mention requires its owner event constructor'
          );
        const Enter = createViewCommand(
          'Key(Enter)',
          (value): value is KeyboardEvent | null =>
            value === null || value instanceof KeyboardEvent
        );
        return releaseWithOwner(
          currentView.registerViewCommand(Enter, listener, 2)
        );
      },
      updateDocumentNames(names) {
        const currentView = current();
        if (currentView)
          dispatchApplicationCommandIfSessionEdit(
            currentView,
            'group-b.document-names',
            { names }
          );
      },
      remove: (key) => edit(key, 'remove'),
      convertToText: (key, text) => edit(key, 'to-text', { text }),
      convertToCard: (key) => edit(key, 'to-card'),
      setCollapsed: (key, collapsed) => edit(key, 'collapse', { collapsed }),
    },
    bindView(incoming) {
      selection.bindView(incoming);
      view = incoming;
      generation = incoming.mirror.keyGeneration;
    },
    dispose() {
      if (!alive) return;
      alive = false;
      let failure: { error: unknown } | undefined;
      const cleanup = (call: () => void) => {
        try {
          call();
        } catch (error) {
          failure ??= { error };
        }
      };
      for (const release of [...releases]) cleanup(release);
      cleanup(selection.dispose);
      view = undefined;
      generation = null;
      if (failure) throw failure.error;
    },
  };
}
