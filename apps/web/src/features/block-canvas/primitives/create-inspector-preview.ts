import type {
  CommandContext,
  GraphicsDocument,
  GraphicsEditor,
  TextMeasurer,
} from '@macro-inc/graphics';
import { batch, createSignal, onCleanup } from 'solid-js';

export type InspectorNumberScrub = {
  preview: (value: number) => void;
  commit: (value: number) => void;
  cancel: () => void;
};

/** Inspector gestures paint a draft scene; only release changes the document. */
export function createInspectorPreview(
  editor: GraphicsEditor,
  measureText?: TextMeasurer
) {
  const [document, setDocument] = createSignal<GraphicsDocument>();
  let cancelActive: (() => void) | undefined;
  const cancel = () => cancelActive?.();
  onCleanup(cancel);

  function begin(
    render: (
      context: CommandContext,
      value: number
    ) => GraphicsDocument | undefined,
    commit: (value: number) => void,
    restore?: () => void
  ): InspectorNumberScrub {
    cancel();
    const context = {
      document: editor.document,
      selection: [...editor.getSession().selectedIds],
      snapUnit: editor.getSnapUnit(),
      measureText,
    };
    let active = true;
    const end = (revert: boolean) => {
      if (!active) return;
      active = false;
      detachDocument();
      detachSession();
      cancelActive = undefined;
      setDocument(undefined);
      if (revert) restore?.();
    };
    const cancelGesture = () => end(true);
    const detachDocument = editor.subscribeDocument(cancelGesture);
    const detachSession = editor.subscribeSession((session) => {
      if (
        session.snapUnit !== context.snapUnit ||
        session.transform ||
        session.box ||
        session.selectedIds.length !== context.selection.length ||
        session.selectedIds.some((id, index) => id !== context.selection[index])
      )
        cancelGesture();
    });
    cancelActive = cancelGesture;
    return {
      preview(value) {
        if (active) setDocument(render(context, value));
      },
      commit(value) {
        if (!active) return;
        batch(() => {
          end(false);
          commit(value);
        });
      },
      cancel: cancelGesture,
    };
  }

  return { document, begin, cancel };
}

export type CanvasInspectorPreview = ReturnType<typeof createInspectorPreview>;
